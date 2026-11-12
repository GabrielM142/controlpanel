from odoo.tests import tagged

from odoo.addons.nova_connector.tests.common import NovaCase


@tagged("post_install", "-at_install", "nova")
class TestNovaMasterData(NovaCase):

    def _events(self, model, res_id):
        return self.env["nova.change.event"].search([("model_name", "=", model), ("res_id", "=", res_id)])

    def test_datasets_match_odoo16_fields(self):
        for key in ("res_partner", "product_product", "product_template", "res_company", "uom_uom",
                    "res_currency", "res_currency_rate", "res_country_state", "res_users", "product_category"):
            ds = self.env["nova.export.dataset"].search([("key", "=", key)])
            self.assertTrue(ds.available, key)
            self.assertFalse(ds.missing_required, "%s: %s" % (key, ds.missing_required))

    def test_capture_create_write_unlink(self):
        partner = self.env["res.partner"].create({"name": "Cliente NOVA", "company_id": self.company.id})
        self.assertEqual(self._events("res.partner", partner.id).mapped("op"), ["upsert"])
        partner.write({"comment": "irrelevante"})  # not a trigger field
        self.assertEqual(len(self._events("res.partner", partner.id)), 1)
        partner.write({"city": "Cuenca"})
        self.assertEqual(len(self._events("res.partner", partner.id)), 2)
        pid = partner.id
        partner.unlink()
        delete = self._events("res.partner", pid).filtered(lambda e: e.op == "delete")
        self.assertTrue(delete.refs and str(self.company.id) in delete.refs)

    def test_business_rollback_leaves_no_event(self):
        before = self.env["nova.change.event"].search_count([])
        try:
            with self.env.cr.savepoint():
                self.env["res.partner"].create({"name": "Revertido"})
                raise ValueError("rollback")
        except ValueError:
            pass
        self.assertEqual(self.env["nova.change.event"].search_count([]), before)

    def test_backfill_then_delta_with_change_and_delete(self):
        partner = self.env["res.partner"].create({"name": "Delta", "company_id": self.company.id})
        _run, manifest, records = self.full_cycle()  # backfill (+ events)
        self.assertTrue(any(r["dataset"] == "res_partner" and r["id"] == partner.id for r in records))
        ds = {d["key"]: d for d in manifest["datasets"]}
        self.assertTrue(ds["res_partner"]["backfill_complete"])
        partner.write({"city": "Loja"})
        other = self.env["res.partner"].create({"name": "Borrar"})
        other_id = other.id
        other.unlink()
        _run2, _m2, records2 = self.full_cycle()
        mine = [r for r in records2 if r["dataset"] == "res_partner"]
        upd = [r for r in mine if r["id"] == partner.id and r["op"] == "upsert"]
        self.assertTrue(upd and upd[-1]["data"]["city"] == "Loja")
        self.assertTrue(any(r["id"] == other_id and r["op"] == "delete" for r in mine))
        self.assertFalse(self.env["nova.change.event"].search([("state", "!=", "acked"), ("res_id", "=", partner.id),
                                                               ("model_name", "=", "res.partner")]))

    def test_scan_terminates_with_same_write_date(self):
        """Regression: rows created in one transaction share write_date (with
        microseconds); a second-precision keyset used to return the same page forever."""
        import time
        self.conn.write({"max_rows_per_part": 2, "time_budget_seconds": 20})
        partners = self.env["res.partner"].create(
            [{"name": "Mismo instante %s" % i, "company_id": self.company.id} for i in range(7)])
        started = time.monotonic()
        run = self.prepare()
        self.assertEqual(run.state, "ready")
        self.assertLess(time.monotonic() - started, 60, "scan did not terminate quickly")
        manifest, records = self.read_run(run)
        ids = {r["id"] for r in records if r["dataset"] == "res_partner"}
        self.assertTrue(set(partners.ids) <= ids)
        self.ack(run, manifest)
        run2 = self.prepare()  # next run: scan with overlap re-reads them
        self.assertEqual(run2.state, "ready")
        ds = {d["key"]: d for d in self.read_run(run2)[0]["datasets"]}
        self.assertTrue(ds["res_partner"]["complete"])

    def test_run_is_split_in_background_jobs(self):
        run = self.prepare()
        self.assertEqual(run.state, "ready")
        usable = self.env["nova.export.dataset"].search([])._nova_usable()
        self.assertEqual(set(run.job_ids.mapped("dataset_key")), set(usable.mapped("key")))
        self.assertTrue(all(j.state == "done" for j in run.job_ids))
        self.assertEqual(sum(run.job_ids.mapped("parts")), len(run.part_ids))

    def test_jobs_are_chunked(self):
        self.conn.write({"max_rows_per_part": 50, "max_parts_per_invocation": 1})
        self.env["res.partner"].create(
            [{"name": "Trozo %s" % i, "company_id": self.company.id} for i in range(120)])
        run = self.prepare()
        self.assertEqual(run.state, "ready")
        chunks = run.job_ids.filtered(lambda j: j.dataset_key == "res_partner")
        self.assertGreater(len(chunks), 1)
        self.assertEqual(sorted(chunks.mapped("chunk")), list(range(1, len(chunks) + 1)))

    def test_failed_job_is_retried_without_losing_data(self):
        from unittest.mock import patch
        Dataset = type(self.env["nova.export.dataset"])
        original = Dataset._nova_serialize
        calls = {"n": 0}

        def flaky(ds, records, reason):
            if ds.key == "res_partner" and not calls["n"]:
                calls["n"] += 1
                raise ValueError("fallo simulado")
            return original(ds, records, reason)

        partner = self.env["res.partner"].create({"name": "Reintento", "company_id": self.company.id})
        with patch.object(Dataset, "_nova_serialize", flaky):
            run = self.prepare()
        self.assertEqual(run.state, "ready")
        jobs = run.job_ids.filtered(lambda j: j.dataset_key == "res_partner")
        self.assertTrue(any(j.attempts >= 2 for j in jobs))
        manifest, records = self.read_run(run)
        ds = {d["key"]: d for d in manifest["datasets"]}
        self.assertTrue(ds["res_partner"]["complete"])
        self.assertTrue(any(r["dataset"] == "res_partner" and r["id"] == partner.id for r in records))

    def test_integrity_check(self):
        self.full_cycle()
        self.conn.action_check_integrity()
        self.assertIn(self.conn.integrity_status, ("ok", "warn"))
        self.assertTrue(self.conn.integrity_report)
        self.assertIn("Checksum", self.conn.integrity_report)

    def test_private_addresses_and_portal_users_not_exported(self):
        private = self.env["res.partner"].create({"name": "Domicilio empleado", "type": "private"})
        public = self.env["res.partner"].create({"name": "Cliente visible", "company_id": self.company.id})
        portal = self.env["res.users"].create({"name": "Portal NOVA", "login": "nova_portal_test",
                                                "groups_id": [(6, 0, [self.env.ref("base.group_portal").id])]})
        _run, _manifest, records = self.full_cycle()
        partner_ids = {r["id"] for r in records if r["dataset"] == "res_partner" and r["op"] == "upsert"}
        user_ids = {r["id"] for r in records if r["dataset"] == "res_users" and r["op"] == "upsert"}
        self.assertIn(public.id, partner_ids)
        self.assertNotIn(private.id, partner_ids)
        self.assertNotIn(portal.id, user_ids)
        self.assertIn(self.integration.id, user_ids)

    def test_flag_resync_with_keys_then_cleared_by_ack(self):
        self.full_cycle()
        self.conn._nova_flag_resync("prueba", ["res_partner"])  # used to crash (bad domain)
        self.assertTrue(self.conn.resync_required)
        self.full_cycle()
        self.assertFalse(self.conn.resync_required)

    def test_event_committed_after_claim_goes_to_next_run(self):
        self.full_cycle()
        run = self.prepare()  # claims nothing new
        late = self.env["res.partner"].create({"name": "Tardío"})  # pending, not in run
        manifest, records = self.read_run(run)
        self.assertFalse(any(r["id"] == late.id and r["reason"] == "event" for r in records))
        self.ack(run, manifest)
        ev = self._events("res.partner", late.id)
        self.assertEqual(ev.mapped("state"), ["pending"])  # ACK of older run never consumes it
        _r, _m, records2 = self.full_cycle()
        self.assertTrue(any(r["id"] == late.id for r in records2))

    def test_archived_product_keeps_flowing(self):
        product = self.env["product.product"].create({"name": "Archivado"})
        self.full_cycle()
        product.write({"active": False})
        _r, _m, records = self.full_cycle()
        rec = [r for r in records if r["dataset"] == "product_product" and r["id"] == product.id]
        self.assertTrue(rec and rec[-1]["op"] == "upsert" and rec[-1]["data"]["active"] is False)

    def test_out_of_scope_company_becomes_delete(self):
        other_company = self.env["res.company"].create({"name": "No autorizada"})
        partner = self.env["res.partner"].create({"name": "Movido", "company_id": self.company.id})
        self.full_cycle()
        partner.write({"company_id": other_company.id})
        _r, _m, records = self.full_cycle()
        rec = [r for r in records if r["dataset"] == "res_partner" and r["id"] == partner.id]
        self.assertEqual(rec[-1]["op"], "delete")
        self.assertEqual(rec[-1]["reason"], "out_of_scope")

    def test_pii_excluded_by_default(self):
        partner = self.env["res.partner"].create({"name": "PII", "email": "x@example.com", "vat": "123"})
        _r, _m, records = self.full_cycle()
        rec = [r for r in records if r["dataset"] == "res_partner" and r["id"] == partner.id][-1]
        self.assertNotIn("email", rec["data"])
        self.assertNotIn("vat", rec["data"])

    def test_part_limits_respected(self):
        self.conn.write({"max_rows_per_part": 5, "max_bytes_per_part": 16 * 1024})
        self.env["res.partner"].create([{"name": "Lote %s" % i} for i in range(23)])
        run = self.prepare()
        for part in run.part_ids:
            self.assertLessEqual(part.records_count, 5)
            self.assertLessEqual(part.bytes, 16 * 1024 + 4096)
