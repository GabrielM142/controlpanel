import json
import re
import uuid

from odoo import _, api, models, release
from odoo.exceptions import AccessError, UserError

from .nova_sync import CONNECTOR_VERSION

_REF_RE = re.compile(r"^[A-Za-z0-9_\-:.]{1,64}$")
MAX_LIST = 50


class NovaConnectorApi(models.AbstractModel):
    """The only RPC surface for NOVA (``execute_kw`` over HTTPS with a
    dedicated user + API key). Every method re-checks the group, the connection
    state and the source identity; it only reads/acknowledges connector
    artifacts. There is intentionally no generic model/ORM/SQL method."""

    _name = "nova.connector"
    _description = "NOVA connector RPC API"

    # ------------------------------------------------------------ guards
    @api.model
    def _check_caller(self, need_link=True):
        user = self.env.user
        if not (user.has_group("nova_connector.group_nova_integration")
                or user.has_group("nova_connector.group_nova_admin")):
            raise AccessError(_("Usuario sin permiso de integración NOVA."))
        conn = self.env["nova.connection"]._nova_get()
        if not conn:
            raise UserError(_("Conexión NOVA no configurada."))
        if need_link:
            if conn.state not in ("linked", "paused"):
                raise UserError(_("Conexión NOVA no vinculada (estado: %s).") % conn.state)
            if not conn._nova_check_fingerprint():
                raise UserError(_("Fuente suspendida: copia o restauración detectada."))
        return conn

    @api.model
    def _check_source(self, conn, source):
        if not isinstance(source, dict):
            raise UserError(_("Identidad de fuente requerida."))
        if source.get("installation_uuid") != conn.installation_uuid:
            raise AccessError(_("La instalación no coincide."))
        if int(source.get("generation") or 0) != conn.source_generation:
            raise AccessError(_("Generación de fuente distinta: re-vincular."))

    @api.model
    def _get_run(self, conn, run_uuid):
        try:
            uuid.UUID(str(run_uuid))
        except ValueError:
            raise UserError(_("run_uuid inválido."))
        run = self.env["nova.sync.run"].sudo().search(
            [("run_uuid", "=", str(run_uuid)), ("connection_id", "=", conn.id)], limit=1)
        if not run:
            raise UserError(_("Lote inexistente."))
        return run

    # ------------------------------------------------------------ public
    @api.model
    def get_capabilities(self):
        conn = self._check_caller(need_link=False)
        conn._nova_check_fingerprint()
        datasets = self.env["nova.export.dataset"].sudo().search([])
        modules = self.env["ir.module.module"].sudo().search(
            [("name", "=like", "nova_%"), ("state", "=", "installed")])
        caps = {
            "installation_uuid": conn.installation_uuid,
            "generation": conn.source_generation,
            "state": conn.state,
            "central_source_ref": conn.central_source_ref or None,
            "odoo_version": release.version,
            "connector_version": CONNECTOR_VERSION,
            "contract": "nova.export.v1",
            "timezone": conn.timezone,
            "window": {"start_hour": conn.window_start_hour, "end_hour": conn.window_end_hour},
            "limits": {"max_rows_per_part": conn.max_rows_per_part, "max_bytes_per_part": conn.max_bytes_per_part},
            "modules": {m.name: m.latest_version or m.installed_version for m in modules},
            "companies": [{"id": c.id, "name": c.name, "currency": c.currency_id.name}
                          for c in conn.company_ids.sudo()],
            "datasets": [{"key": d.key, "version": d.version, "mode": d.mode, "enabled": d.enabled,
                          "available": d.available,
                          "missing_required": [f.strip() for f in (d.missing_required or "").split(",") if f.strip()],
                          "missing_optional": [f.strip() for f in (d.missing_optional or "").split(",") if f.strip()],
                          "extra_fields": d.extra_field_ids.mapped("name")} for d in datasets],
            "resync_required": conn.resync_required,
            "capture_enabled": conn.capture_enabled,
            "pending_events": conn.pending_events,
            "attribute_map": self._nova_attribute_map(),
        }
        return caps

    @api.model
    def _nova_attribute_map(self):
        """Hook for client adapters (e.g. nova_juj) to publish semantic attributes."""
        return []

    @api.model
    def confirm_link(self, link_token, central_source_ref):
        conn = self._check_caller(need_link=False)
        if conn.state == "suspended":
            raise UserError(_("Fuente suspendida: ejecutar el procedimiento de re-vinculación."))
        if not isinstance(central_source_ref, str) or not _REF_RE.match(central_source_ref):
            raise UserError(_("Referencia de fuente inválida."))
        conn._nova_confirm_link(link_token, central_source_ref)
        return {"installation_uuid": conn.installation_uuid, "generation": conn.source_generation,
                "state": conn.state}

    @api.model
    def list_ready_runs(self, source, limit=10):
        conn = self._check_caller()
        self._check_source(conn, source)
        limit = max(1, min(int(limit or 10), MAX_LIST))
        Run = self.env["nova.sync.run"].sudo()
        ready = Run.search([("connection_id", "=", conn.id), ("state", "=", "ready")],
                           order="run_seq asc", limit=limit)
        # Recent acknowledged runs let NOVA detect a lost ACK response (idempotent re-ACK).
        recent = Run.search([("connection_id", "=", conn.id), ("state", "=", "acknowledged")],
                            order="run_seq desc", limit=5)

        def _row(run):
            return {"run_uuid": run.run_uuid, "run_seq": run.run_seq, "state": run.state,
                    "business_date": str(run.business_date), "parts": run.parts_count,
                    "records": run.records_count, "bytes": run.bytes_total,
                    "receipt_uuid": run.receipt_uuid or None}

        return {"runs": [_row(r) for r in ready], "acknowledged_recent": [_row(r) for r in recent]}

    @api.model
    def get_manifest(self, source, run_uuid):
        conn = self._check_caller()
        self._check_source(conn, source)
        run = self._get_run(conn, run_uuid)
        if run.state not in ("ready", "acknowledged"):
            raise UserError(_("El lote aún no está listo."))
        return json.loads(run.manifest)

    @api.model
    def read_part(self, source, run_uuid, part_no):
        conn = self._check_caller()
        self._check_source(conn, source)
        run = self._get_run(conn, run_uuid)
        if run.state not in ("ready", "acknowledged"):
            raise UserError(_("El lote aún no está listo."))
        part = run.part_ids.filtered(lambda p: p.part_no == int(part_no))
        if not part:
            raise UserError(_("Parte inexistente."))
        return {"run_uuid": run.run_uuid, "part_no": part.part_no, "dataset": part.dataset_key,
                "encoding": "gzip+base64", "sha256": part.sha256, "bytes": part.bytes,
                "records": part.records_count, "content": part._nova_content_b64()}

    @api.model
    def ack_run(self, source, run_uuid, receipt):
        conn = self._check_caller()
        self._check_source(conn, source)
        run = self._get_run(conn, run_uuid)
        if not isinstance(receipt, dict):
            raise UserError(_("Recibo inválido."))
        return run._nova_ack(receipt)

    @api.model
    def request_resync(self, source, dataset_keys):
        conn = self._check_caller()
        self._check_source(conn, source)
        if not isinstance(dataset_keys, list) or not dataset_keys or len(dataset_keys) > 50:
            raise UserError(_("Lista de datasets inválida."))
        known = set(self.env["nova.export.dataset"].sudo().search([]).mapped("key"))
        keys = [k for k in dataset_keys if isinstance(k, str) and k in known]
        if not keys:
            raise UserError(_("Datasets desconocidos."))
        conn._nova_flag_resync(_("Resincronización solicitada por NOVA"), keys)
        return {"status": "scheduled", "datasets": keys}
