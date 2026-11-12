import json
import logging

from odoo import api, fields, models

_logger = logging.getLogger(__name__)


class NovaChangeEvent(models.Model):
    """Durable, immutable outbox row written in the *same transaction* as the
    business change (rollback removes it). Consumption is by state + exact
    ``run_id`` assignment, never by ``id > last_id``: sequence ids are assigned
    before commit and an older transaction may commit later."""

    _name = "nova.change.event"
    _description = "NOVA change event (outbox)"
    _order = "id"
    _log_access = False

    captured_at = fields.Datetime(default=fields.Datetime.now, readonly=True, index=True)
    dataset_key = fields.Char(required=True, index=True, readonly=True)
    model_name = fields.Char(required=True, readonly=True)
    res_id = fields.Integer(required=True, readonly=True)
    company_id = fields.Many2one("res.company", readonly=True, index=True, ondelete="set null")
    op = fields.Selection([("upsert", "Alta/cambio"), ("delete", "Baja")], required=True, readonly=True)
    refs = fields.Text(readonly=True, help="Referencias mínimas previas al borrado (JSON).")
    state = fields.Selection([("pending", "Pendiente"), ("exported", "En lote"), ("acked", "Confirmado")],
                             default="pending", required=True, index=True, readonly=True)
    run_id = fields.Many2one("nova.sync.run", readonly=True, index=True, ondelete="set null")

    def init(self):
        self.env.cr.execute(
            "CREATE INDEX IF NOT EXISTS nova_change_event_pending_idx "
            "ON nova_change_event (dataset_key, id) WHERE state = 'pending' AND run_id IS NULL")

    @api.model
    def _nova_record(self, records, op, refs_by_id=None, dataset_keys=None):
        """Called by ``nova.capture.mixin``. Never raises into business code:
        a failure inside the savepoint flags the connection for resync, so a
        lost event can never be reported as a complete synchronization."""
        if not records or not self.env["nova.connection"]._nova_capture_flag():
            return
        from ..nova_lib import registry
        specs = [s for s in registry.specs_for_model(records._name)
                 if dataset_keys is None or s["key"] in dataset_keys]
        if not specs:
            return
        has_company = "company_id" in records._fields
        vals_list = []
        for rec in records:
            company = False
            if has_company:
                company = rec.company_id.id
            elif records._name == "res.company":
                company = rec.id
            refs = (refs_by_id or {}).get(rec.id)
            for spec in specs:
                vals_list.append({
                    "dataset_key": spec["key"], "model_name": records._name, "res_id": rec.id,
                    "company_id": company or False, "op": op,
                    "refs": json.dumps(refs, default=str, sort_keys=True) if refs else False,
                })
        try:
            with self.env.cr.savepoint():
                self.sudo().create(vals_list)
        except Exception:  # noqa: BLE001 - ERP continuity has priority
            _logger.exception("NOVA: change capture failed for %s", records._name)
            conn = self.env["nova.connection"]._nova_get()
            if conn:
                conn._nova_flag_resync("Fallo de captura en %s" % records._name,
                                       [s["key"] for s in specs])

    @api.model
    def _nova_claim(self, run, dataset_key, limit):
        """Assign up to ``limit`` committed pending events of a dataset to ``run``.
        Events committed later (even with lower ids) stay pending for the next run."""
        self.env.cr.execute(
            """
            UPDATE nova_change_event SET run_id = %s, state = 'exported'
             WHERE id IN (SELECT id FROM nova_change_event
                           WHERE state = 'pending' AND run_id IS NULL AND dataset_key = %s
                           ORDER BY id LIMIT %s FOR UPDATE SKIP LOCKED)
            RETURNING id, res_id, op, refs, company_id
            """,
            (run.id, dataset_key, limit))
        rows = self.env.cr.fetchall()
        self.invalidate_model(["run_id", "state"])
        return rows
