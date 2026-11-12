import uuid

from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import NovaCase


@tagged("post_install", "-at_install", "nova")
class TestNovaConnector(NovaCase):

    def test_capabilities_require_integration_group(self):
        with self.assertRaises(AccessError):
            self.api(self.plain_user).get_capabilities()
        caps = self.api().get_capabilities()
        self.assertEqual(caps["installation_uuid"], self.conn.installation_uuid)
        self.assertEqual(caps["contract"], "nova.export.v1")
        self.assertTrue(caps["odoo_version"].startswith("16."))
        self.assertEqual([c["id"] for c in caps["companies"]], [self.company.id])

    def test_source_identity_is_checked(self):
        with self.assertRaises(AccessError):
            self.api().list_ready_runs({"installation_uuid": str(uuid.uuid4()), "generation": 1})
        with self.assertRaises(AccessError):
            self.api().list_ready_runs({"installation_uuid": self.conn.installation_uuid,
                                        "generation": self.conn.source_generation + 1})
        self.assertIn("runs", self.api().list_ready_runs(self.source))

    def test_link_token_single_use_and_expiry(self):
        conn = self.conn
        conn.sudo().write({"state": "draft", "central_source_ref": False})
        action = conn.action_generate_link_token()
        token = self.env["nova.link.wizard"].browse(action["res_id"]).token
        with self.assertRaises(UserError):
            self.api().confirm_link("wrong-token", "src-1")
        self.api().confirm_link(token, "src-1")
        self.assertEqual(conn.state, "linked")
        self.assertEqual(conn.central_source_ref, "src-1")
        conn.sudo().write({"state": "draft"})
        with self.assertRaises(UserError):
            self.api().confirm_link(token, "src-1")  # hash cleared after use

    def test_clone_detection_suspends_sync(self):
        self.conn.sudo().write({"db_fingerprint": "f" * 64})
        with self.assertRaises(UserError):
            self.api().list_ready_runs(self.source)  # every API call refuses the copied database
        # The refused RPC rolls back its own transaction, so the 'suspended' state is
        # persisted by the next preparation (cron), which checks without raising.
        self.assertFalse(self.env["nova.sync.run"]._nova_prepare(self.conn, force=True))
        self.assertEqual(self.conn.state, "suspended")
        generation = self.conn.source_generation
        self.conn.action_relink_after_clone()
        self.assertEqual(self.conn.source_generation, generation + 1)
        self.assertEqual(self.conn.state, "draft")
        self.assertTrue(self.conn.resync_required)

    def test_empty_run_is_confirmed_not_invented(self):
        self.full_cycle()  # drain initial backfill
        run, manifest, records = self.full_cycle()
        self.assertEqual(run.state, "acknowledged")
        self.assertEqual(manifest["schema"], "nova.export.v1")
        self.assertEqual(manifest["consistency"], "captured_interval")
        self.assertTrue(manifest["observed_from"] <= manifest["observed_to"])
        self.assertEqual(len([r for r in records if r["reason"] == "event"]), 0)

    def test_ack_requires_every_checksum_and_is_idempotent(self):
        run = self.prepare()
        manifest, _records = self.read_run(run)
        if manifest["parts"]:
            bad = {"receipt_uuid": str(uuid.uuid4()),
                   "parts": [{"part_no": p["part_no"], "sha256": "0" * 64} for p in manifest["parts"]]}
            with self.assertRaises(UserError):
                self.api().ack_run(self.source, run.run_uuid, bad)
        first = self.ack(run, manifest)
        self.assertEqual(first["status"], "acknowledged")
        again = self.ack(run, manifest)
        self.assertEqual(again["status"], "already_acknowledged")

    def test_parts_are_immutable(self):
        run = self.prepare()
        if run.part_ids:
            with self.assertRaises(UserError):
                run.part_ids[0].write({"sha256": "x"})

    def test_quota_stops_preparation(self):
        self.full_cycle()
        self.conn.sudo().write({"max_pending_bytes": -1})
        before = self.env["nova.sync.run"].search_count([])
        self.assertFalse(self.env["nova.sync.run"]._nova_prepare(self.conn, force=True))
        self.assertTrue(self.conn.last_error)
        # A run may have been created but no part may exceed the quota.
        self.assertLessEqual(self.env["nova.sync.run"].search_count([]) - before, 1)

    def test_no_generic_orm_surface(self):
        from odoo.addons.nova_connector.models.nova_connector_api import NovaConnectorApi
        public = {n for n, v in vars(NovaConnectorApi).items() if callable(v) and not n.startswith("_")}
        self.assertEqual(public, {"get_capabilities", "confirm_link", "list_ready_runs", "get_manifest",
                                  "read_part", "ack_run", "request_resync"})
