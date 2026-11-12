import base64
import gzip
import json
import uuid

from odoo.tests.common import TransactionCase, new_test_user


class NovaCase(TransactionCase):
    """Shared fixture: a linked connection on the main company, an integration
    user and helpers to prepare/read/ack runs exactly like NOVA does over RPC."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.conn = cls.env["nova.connection"]._nova_ensure_connection()
        cls.conn.write({"company_ids": [(6, 0, [cls.company.id])], "max_rows_per_part": 200,
                        "max_parts_per_invocation": 500, "time_budget_seconds": 120})
        cls.conn.sudo().write({"state": "linked", "central_source_ref": "test-source",
                               "db_fingerprint": cls.conn._nova_current_fingerprint()})
        cls.env.registry.clear_caches()
        cls.env["nova.export.dataset"]._nova_sync_registry()
        cls.integration = new_test_user(cls.env, login="nova_integration_test",
                                        groups="base.group_user,nova_connector.group_nova_integration")
        cls.plain_user = new_test_user(cls.env, login="nova_plain_test", groups="base.group_user")

    def setUp(self):
        super().setUp()
        # ormcache (capture flag) is registry-level and is not rolled back between tests.
        self.env.registry.clear_caches()

    @property
    def source(self):
        return {"installation_uuid": self.conn.installation_uuid, "generation": self.conn.source_generation}

    def api(self, user=None):
        return self.env["nova.connector"].with_user(user or self.integration)

    def prepare(self, max_invocations=200):
        """Successive bounded invocations, exactly like the cron re-trigger loop."""
        Run = self.env["nova.sync.run"]
        for _i in range(max_invocations):
            Run._nova_prepare(self.conn, force=True)
            run = Run.search([("connection_id", "=", self.conn.id)], order="run_seq desc", limit=1)
            if run.state != "preparing":
                return run
        return run

    def read_run(self, run):
        manifest = self.api().get_manifest(self.source, run.run_uuid)
        records = []
        for desc in manifest["parts"]:
            part = self.api().read_part(self.source, run.run_uuid, desc["part_no"])
            content = gzip.decompress(base64.b64decode(part["content"]))
            self.assertEqual(len(content), desc["bytes"])
            import hashlib
            self.assertEqual(hashlib.sha256(content).hexdigest(), desc["sha256"])
            doc = json.loads(content)
            for rec in doc["records"]:
                rec["dataset"] = doc["dataset"]
                records.append(rec)
        return manifest, records

    def ack(self, run, manifest):
        receipt = {"receipt_uuid": str(uuid.uuid4()),
                   "parts": [{"part_no": p["part_no"], "sha256": p["sha256"]} for p in manifest["parts"]]}
        return self.api().ack_run(self.source, run.run_uuid, receipt)

    def full_cycle(self):
        run = self.prepare()
        self.assertEqual(run.state, "ready")
        manifest, records = self.read_run(run)
        self.ack(run, manifest)
        return run, manifest, records
