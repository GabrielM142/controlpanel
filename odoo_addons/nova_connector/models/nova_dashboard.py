"""Control panel and local integrity audit of the NOVA connector.

The integrity audit only reads technical NOVA tables and the stored parts: it
never exports business data and can run during business hours (bounded sample).
"""
import gzip
import hashlib
from datetime import timedelta
from html import escape

from odoo import _, api, fields, models

STATUS_ORDER = {"ok": 0, "warn": 1, "fail": 2}
STATUS_LABEL = {"ok": "Correcto", "warn": "Revisar", "fail": "Error"}
STATUS_CLASS = {"ok": "text-success", "warn": "text-warning", "fail": "text-danger"}
PART_SAMPLE = 50


class NovaConnectionDashboard(models.Model):
    _inherit = "nova.connection"

    integrity_status = fields.Selection([("ok", "Correcto"), ("warn", "Revisar"), ("fail", "Error")],
                                        readonly=True, string="Integridad")
    integrity_checked_at = fields.Datetime(readonly=True, string="Integridad revisada")
    integrity_report = fields.Html(readonly=True, sanitize=True, string="Informe de integridad")

    dash_run_id = fields.Many2one("nova.sync.run", compute="_compute_dashboard", string="Lote actual")
    dash_run_state = fields.Char(compute="_compute_dashboard", string="Estado del lote")
    dash_jobs_total = fields.Integer(compute="_compute_dashboard", string="Trabajos")
    dash_jobs_done = fields.Integer(compute="_compute_dashboard", string="Terminados")
    dash_jobs_queued = fields.Integer(compute="_compute_dashboard", string="En cola")
    dash_jobs_failed = fields.Integer(compute="_compute_dashboard", string="Fallidos")
    dash_progress = fields.Float(compute="_compute_dashboard", string="Avance (%)")
    dash_records = fields.Integer(compute="_compute_dashboard", string="Registros exportados")
    dash_avg_job_s = fields.Float(compute="_compute_dashboard", string="Duración media por trabajo (s)")
    dash_last_ready_at = fields.Datetime(compute="_compute_dashboard", string="Último lote listo")
    dash_datasets_usable = fields.Integer(compute="_compute_dashboard", string="Datasets activos")
    dash_datasets_error = fields.Integer(compute="_compute_dashboard", string="Datasets con error")

    def _compute_dashboard(self):
        Run = self.env["nova.sync.run"].sudo()
        Job = self.env["nova.sync.job"].sudo()
        datasets = self.env["nova.export.dataset"].sudo().search([])
        usable = datasets._nova_usable()
        for conn in self:
            run = Run.search([("connection_id", "=", conn.id)], order="run_seq desc", limit=1)
            ready = Run.search([("connection_id", "=", conn.id), ("state", "in", ["ready", "acknowledged"])],
                               order="run_seq desc", limit=1)
            conn.dash_run_id = run
            conn.dash_run_state = dict(run._fields["state"].selection).get(run.state, "") if run else ""
            conn.dash_jobs_total = run.jobs_total if run else 0
            conn.dash_jobs_done = run.jobs_done if run else 0
            conn.dash_jobs_queued = run.jobs_queued if run else 0
            conn.dash_jobs_failed = run.jobs_failed if run else 0
            conn.dash_progress = run.jobs_progress if run else 0.0
            conn.dash_records = run.records_count if run and run.records_count else (
                sum(Job.search([("run_id", "=", run.id)]).mapped("records")) if run else 0)
            done = Job.search([("run_id", "=", run.id), ("state", "=", "done")]) if run else Job
            conn.dash_avg_job_s = (sum(done.mapped("duration_ms")) / 1000.0 / len(done)) if done else 0.0
            conn.dash_last_ready_at = ready.ready_at if ready else False
            conn.dash_datasets_usable = len(usable)
            conn.dash_datasets_error = len(usable.filtered(lambda d: d.last_error))

    # ------------------------------------------------------------ actions
    @api.model
    def action_open_dashboard(self):
        conn = self._nova_ensure_connection()
        return {
            "type": "ir.actions.act_window", "name": _("Panel de control NOVA"),
            "res_model": "nova.connection", "res_id": conn.id, "view_mode": "form",
            "views": [(self.env.ref("nova_connector.view_nova_dashboard_form").id, "form")],
            "target": "current",
        }

    def action_open_jobs(self):
        self.ensure_one()
        action = self.env["ir.actions.act_window"]._for_xml_id("nova_connector.action_nova_sync_job")
        if self.dash_run_id:
            action["domain"] = [("run_id", "=", self.dash_run_id.id)]
        return action

    def action_open_failed_jobs(self):
        action = self.action_open_jobs()
        action["domain"] = (action.get("domain") or []) + [("state", "=", "failed")]
        return action

    def action_retry_failed_jobs(self):
        self.ensure_one()
        if self.dash_run_id:
            self.dash_run_id.job_ids.filtered(lambda j: j.state == "failed").action_retry()

    def action_check_integrity(self):
        for conn in self:
            checks = conn._nova_integrity_checks()
            worst = max((c["status"] for c in checks), key=lambda s: STATUS_ORDER[s], default="ok")
            conn.sudo().write({"integrity_status": worst, "integrity_checked_at": fields.Datetime.now(),
                               "integrity_report": conn._nova_integrity_html(checks)})

    # ------------------------------------------------------------ integrity
    def _nova_integrity_checks(self):
        """List of {name, status, detail}. Bounded: never scans business tables."""
        self.ensure_one()
        out = []

        def add(name, status, detail):
            out.append({"name": name, "status": status, "detail": detail})

        now = fields.Datetime.now()
        # 1. Copy/restore fingerprint and connection state.
        same = not self.db_fingerprint or self.db_fingerprint == self._nova_current_fingerprint()
        add(_("Huella de la base"), "ok" if same else "fail",
            _("Coincide con la vinculada.") if same else _("Base copiada o restaurada: re-vincular."))
        add(_("Estado de la conexión"), "ok" if self.state == "linked" else "warn",
            dict(self._fields["state"].selection).get(self.state, self.state))
        # 2. Capture guarantee.
        if not self.capture_enabled:
            add(_("Captura de cambios"), "fail", _("Desactivada: no hay garantía de deltas."))
        elif self.resync_required:
            add(_("Captura de cambios"), "warn", _("Resincronización pendiente: %s") % (self.resync_reason or ""))
        else:
            add(_("Captura de cambios"), "ok", _("Activa."))
        # 3. Datasets.
        datasets = self.env["nova.export.dataset"].sudo().search([])
        usable = datasets._nova_usable()
        missing = datasets.filtered(lambda d: d.enabled and d.available and d.missing_required)
        add(_("Datasets"), "fail" if missing else "ok",
            _("%(u)s activos; con campos obligatorios faltantes: %(m)s") % {
                "u": len(usable), "m": ", ".join(missing.mapped("key")) or "-"})
        errors = usable.filtered(lambda d: d.last_error)
        add(_("Errores de exportación"), "warn" if errors else "ok", ", ".join(errors.mapped("key")) or _("Ninguno."))
        # 4. Outbox health.
        Event = self.env["nova.change.event"].sudo()
        old = Event.search_count([("state", "=", "pending"), ("run_id", "=", False),
                                  ("captured_at", "<", now - timedelta(hours=48))])
        add(_("Cola de cambios"), "warn" if old else "ok",
            _("%s eventos pendientes de más de 48 h.") % old if old else _("Sin eventos atascados."))
        usable_keys = set(usable.mapped("key"))
        self.env.cr.execute("SELECT dataset_key, count(*) FROM nova_change_event "
                            "WHERE state = 'pending' AND run_id IS NULL GROUP BY dataset_key")
        orphans = {k: n for k, n in self.env.cr.fetchall() if k not in usable_keys}
        add(_("Eventos sin dataset activo"), "warn" if orphans else "ok",
            ", ".join("%s (%s)" % kv for kv in sorted(orphans.items())) or _("Ninguno."))
        # 5. Runs and jobs.
        Run = self.env["nova.sync.run"].sudo()
        stuck = Run.search_count([("connection_id", "=", self.id), ("state", "=", "preparing"),
                                  ("observed_from", "<", now - timedelta(hours=20))])
        add(_("Lotes en preparación"), "warn" if stuck else "ok",
            _("%s lotes llevan más de 20 h preparándose.") % stuck if stuck else _("Normal."))
        failed = self.env["nova.sync.job"].sudo().search_count(
            [("connection_id", "=", self.id), ("state", "=", "failed"), ("run_id.state", "=", "preparing")])
        add(_("Trabajos fallidos"), "warn" if failed else "ok", str(failed))
        cron = self.env.ref("nova_connector.ir_cron_nova_prepare", raise_if_not_found=False)
        add(_("Cron de preparación"), "ok" if cron and cron.active else "fail",
            _("Activo.") if cron and cron.active else _("Inactivo: no se preparan lotes."))
        # 6. Stored parts: checksum of a bounded sample of the latest ready run.
        run = Run.search([("connection_id", "=", self.id), ("state", "in", ["ready", "acknowledged"])],
                         order="run_seq desc", limit=1)
        if run:
            bad, checked = [], 0
            for part in run.part_ids.filtered(lambda p: not p.purged)[:PART_SAMPLE]:
                checked += 1
                try:
                    content = gzip.decompress(part.attachment_id.sudo().raw or b"")
                    if len(content) != part.bytes or hashlib.sha256(content).hexdigest() != part.sha256:
                        bad.append(part.part_no)
                except Exception:  # noqa: BLE001
                    bad.append(part.part_no)
            add(_("Checksum de partes (lote %s)") % run.run_seq, "fail" if bad else "ok",
                _("Partes alteradas o ilegibles: %s") % bad if bad else _("%s partes verificadas.") % checked)
        else:
            add(_("Checksum de partes"), "warn", _("Aún no hay lotes listos."))
        # 7. Quotas.
        ratio = (self.pending_bytes / float(self.max_pending_bytes)) if self.max_pending_bytes > 0 else 1
        add(_("Cuota de partes sin confirmar"), "fail" if ratio >= 1 else ("warn" if ratio >= 0.8 else "ok"),
            "%.0f%%" % (ratio * 100))
        return out

    def _nova_integrity_html(self, checks):
        rows = "".join(
            "<tr><td>%s</td><td class='%s'><strong>%s</strong></td><td>%s</td></tr>" % (
                escape(c["name"]), STATUS_CLASS[c["status"]], STATUS_LABEL[c["status"]], escape(c["detail"]))
            for c in checks)
        return ("<table class='table table-sm'><thead><tr><th>%s</th><th>%s</th><th>%s</th></tr></thead>"
                "<tbody>%s</tbody></table>") % (escape(_("Revisión")), escape(_("Estado")), escape(_("Detalle")), rows)
