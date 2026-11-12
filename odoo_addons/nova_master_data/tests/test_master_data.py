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
