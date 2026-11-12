import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta

from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError
from odoo.tools import ormcache

from odoo.addons.base.models.res_partner import _tz_get

LINK_TOKEN_TTL_MINUTES = 30


class NovaConnection(models.Model):
    _name = "nova.connection"
    _description = "NOVA connection"

    name = fields.Char(required=True, default="NOVA")
    active = fields.Boolean(default=True)
    state = fields.Selection(
        [("draft", "Sin vincular"), ("linking", "Esperando vinculación"), ("linked", "Vinculada"),
         ("paused", "Pausada"), ("suspended", "Suspendida (clon/restauración)")],
        default="draft", required=True, readonly=True)
    installation_uuid = fields.Char(readonly=True, copy=False, default=lambda s: str(uuid.uuid4()))
    source_generation = fields.Integer(default=1, readonly=True, copy=False)
    db_fingerprint = fields.Char(readonly=True, copy=False)
    central_source_ref = fields.Char(readonly=True, copy=False,
                                     help="Identificador de la fuente asignado por NOVA al vincular.")
    linked_at = fields.Datetime(readonly=True, copy=False)
    link_token_hash = fields.Char(copy=False, groups="nova_connector.group_nova_admin")
    link_token_expires_at = fields.Datetime(copy=False, readonly=True)
    company_ids = fields.Many2many("res.company", string="Compañías autorizadas")
    timezone = fields.Selection(_tz_get, default=lambda s: s.env.user.tz or "America/Guayaquil",
                                required=True)
    window_start_hour = fields.Integer(default=0, help="Hora local de inicio de preparación (0-23).")
    window_end_hour = fields.Integer(default=6, help="Hora local límite para iniciar nuevos bloques.")
    max_rows_per_part = fields.Integer(default=250)
    max_bytes_per_part = fields.Integer(default=512 * 1024, help="Bytes sin comprimir por parte.")
    max_parts_per_invocation = fields.Integer(default=20)
    time_budget_seconds = fields.Integer(
        default=180, help="Duración máxima de cada trabajo de la cola. Se acota al límite real del "
                          "worker (limit_time_real_cron / limit_time_real) menos 30 s.")
    job_pause_seconds = fields.Integer(default=10, help="Pausa entre trabajos para no saturar el servidor.")
    job_max_attempts = fields.Integer(default=3, help="Reintentos de un trabajo fallido (espera 1, 5, 15 min).")
    query_timeout_ms = fields.Integer(default=30000)
    max_pending_bytes = fields.Integer(default=200 * 1024 * 1024,
                                       help="Bytes de partes sin ACK que detienen la preparación.")
    max_pending_events = fields.Integer(default=2000000)
    retention_days = fields.Integer(default=7, help="Días de retención de partes ya reconocidas.")
    scan_overlap_minutes = fields.Integer(default=120)
    capture_enabled = fields.Boolean(default=True, readonly=True)
    resync_required = fields.Boolean(readonly=True)
    resync_reason = fields.Char(readonly=True)
    last_error = fields.Text(readonly=True)
    last_prepared_at = fields.Datetime(readonly=True)
    next_run_seq = fields.Integer(default=1, readonly=True, copy=False)
    run_ids = fields.One2many("nova.sync.run", "connection_id")
    pending_bytes = fields.Integer(compute="_compute_pending")
    pending_events = fields.Integer(compute="_compute_pending")

    @api.constrains("active")
    def _check_single(self):
        if self.search_count([("active", "=", True)]) > 1:
            raise ValidationError(_("Solo puede existir una conexión NOVA activa por base de datos."))

    @api.constrains("window_start_hour", "window_end_hour", "max_rows_per_part", "max_bytes_per_part",
                    "time_budget_seconds", "retention_days", "job_pause_seconds", "job_max_attempts")
    def _check_limits(self):
        for rec in self:
            if not (0 <= rec.window_start_hour < rec.window_end_hour <= 24):
                raise ValidationError(_("Ventana horaria inválida."))
            if not (1 <= rec.max_rows_per_part <= 5000):
                raise ValidationError(_("Filas por parte fuera de rango (1-5000)."))
            if not (16 * 1024 <= rec.max_bytes_per_part <= 8 * 1024 * 1024):
                raise ValidationError(_("Bytes por parte fuera de rango (16 KiB - 8 MiB)."))
            if not (5 <= rec.time_budget_seconds <= 600):
                raise ValidationError(_("Presupuesto de tiempo fuera de rango (5-600 s)."))
            if not (0 <= rec.job_pause_seconds <= 600):
                raise ValidationError(_("Pausa entre trabajos fuera de rango (0-600 s)."))
            if not (1 <= rec.job_max_attempts <= 10):
                raise ValidationError(_("Reintentos fuera de rango (1-10)."))
            if rec.retention_days < 1:
                raise ValidationError(_("La retención debe ser de al menos un día."))

    def _compute_pending(self):
        Part = self.env["nova.sync.part"].sudo()
        Event = self.env["nova.change.event"].sudo()
        for rec in self:
            groups = Part.read_group(
                [("run_id.connection_id", "=", rec.id), ("purged", "=", False),
                 # cancelled/failed runs will never be ACKed: they must not block the quota
                 ("run_id.state", "in", ["preparing", "ready"])], ["compressed_bytes:sum"], [])
            rec.pending_bytes = (groups[0]["compressed_bytes"] or 0) if groups else 0
            # Same predicate as the partial index nova_change_event_pending_idx.
            rec.pending_events = Event.search_count([("state", "=", "pending"), ("run_id", "=", False)])

    # ------------------------------------------------------------------ helpers
    @api.model
    def _nova_ensure_connection(self):
        conn = self.sudo().search([], limit=1)
        if not conn:
            conn = self.sudo().create({"name": "NOVA", "company_ids": [(6, 0, self.env["res.company"].sudo().search([]).ids)]})
        if not conn.db_fingerprint:
            conn.db_fingerprint = conn._nova_current_fingerprint()
        return conn

    @api.model
    def _nova_current_fingerprint(self):
        ICP = self.env["ir.config_parameter"].sudo()
        raw = "|".join([self.env.cr.dbname, ICP.get_param("database.uuid", ""),
                        ICP.get_param("database.create_date", "")])
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @api.model
    def _nova_get(self):
        return self.sudo().search([("active", "=", True)], limit=1)

    @api.model
    @ormcache()
    def _nova_capture_flag(self):
        conn = self._nova_get()
        # No capture before linking (nothing would consume it) nor on a suspended clone.
        return bool(conn and conn.capture_enabled and conn.state in ("linked", "paused"))

    def _nova_check_fingerprint(self):
        """A copied/restored database keeps uuid and tokens: suspend until relinked."""
        self.ensure_one()
        current = self._nova_current_fingerprint()
        if self.db_fingerprint and self.db_fingerprint != current and self.state != "suspended":
            self.sudo().write({"state": "suspended",
                               "last_error": _("Base copiada o restaurada detectada: sincronización "
                                               "suspendida hasta re-vincular.")})
            return False
        return self.state != "suspended"

    def write(self, vals):
        res = super().write(vals)
        if {"capture_enabled", "active", "state"} & set(vals):
            self.env.registry.clear_caches()
        return res

    # ------------------------------------------------------------------ actions
    def action_generate_link_token(self):
        self.ensure_one()
        if self.state == "suspended":
            raise UserError(_("Primero ejecute 'Re-vincular tras copia/restauración'."))
        if not self.company_ids:
            raise UserError(_("Seleccione al menos una compañía autorizada."))
        token = secrets.token_urlsafe(24)
        self.sudo().write({
            "link_token_hash": hashlib.sha256(token.encode()).hexdigest(),
            "link_token_expires_at": fields.Datetime.now() + timedelta(minutes=LINK_TOKEN_TTL_MINUTES),
            "state": "linking" if self.state == "draft" else self.state,
        })
        wizard = self.env["nova.link.wizard"].create({"connection_id": self.id, "token": token})
        return {"type": "ir.actions.act_window", "res_model": "nova.link.wizard", "res_id": wizard.id,
                "view_mode": "form", "target": "new", "name": _("Código de vinculación")}

    def _nova_confirm_link(self, token, central_source_ref):
        self.ensure_one()
        stored = self.sudo().link_token_hash
        if not stored or not self.link_token_expires_at or self.link_token_expires_at < fields.Datetime.now():
            raise UserError(_("Código de vinculación inexistente o vencido."))
        digest = hashlib.sha256((token or "").encode()).hexdigest()
        if not hmac.compare_digest(digest, stored):
            raise UserError(_("Código de vinculación inválido."))
        if not central_source_ref or len(central_source_ref) > 64:
            raise UserError(_("Referencia de fuente inválida."))
        self.sudo().write({"state": "linked", "central_source_ref": central_source_ref,
                           "linked_at": fields.Datetime.now(), "link_token_hash": False,
                           "link_token_expires_at": False, "last_error": False,
                           "db_fingerprint": self._nova_current_fingerprint()})

    def action_pause(self):
        self.filtered(lambda c: c.state == "linked").sudo().write({"state": "paused"})

    def action_resume(self):
        for rec in self.filtered(lambda c: c.state == "paused"):
            rec.sudo().write({"state": "linked" if rec.central_source_ref else "draft"})

    def action_relink_after_clone(self):
        """Clone/restore procedure: new generation, sync disabled until NOVA relinks.
        Central data is never deleted by this action."""
        for rec in self:
            rec.run_ids.filtered(lambda r: r.state in ("pending", "preparing", "ready"))._nova_cancel(
                _("Cancelado por re-vinculación tras copia/restauración"))
            rec.sudo().write({
                "state": "draft", "central_source_ref": False, "linked_at": False,
                "source_generation": rec.source_generation + 1,
                "db_fingerprint": rec._nova_current_fingerprint(),
                "last_error": False,
            })
            rec._nova_flag_resync(_("Nueva generación de fuente"))

    def action_disable_capture(self):
        """Emergency only (disk/queue): ERP continuity first; guarantee lost -> resync."""
        self.sudo().write({"capture_enabled": False})
        self._nova_flag_resync(_("Captura de cambios desactivada manualmente"))

    def action_enable_capture(self):
        self.sudo().write({"capture_enabled": True})

    def action_request_resync(self):
        self._nova_flag_resync(_("Resincronización solicitada por operador"))

    def _nova_flag_resync(self, reason, dataset_keys=None):
        cursors = self.env["nova.sync.cursor"].sudo()
        domain = [] if not dataset_keys else [("key", "in", list(dataset_keys))]
        # Only usable delta datasets have a cursor that an ACK can complete again;
        # resetting disabled/unavailable/snapshot ones left resync_required on forever.
        datasets = self.env["nova.export.dataset"].sudo().search(domain)._nova_usable()
        for dataset in datasets.filtered(lambda d: d.mode == "delta"):
            cursors._nova_for(dataset)._nova_start_resync()
        self.sudo().write({"resync_required": True, "resync_reason": reason})
