"""Background job queue of a night run.

A run is split into many short jobs (one dataset chunk each) instead of one long
process. The cron executes ONE job per invocation, commits, and re-triggers itself
after ``job_pause_seconds``: the ERP gets breathing room between jobs, every job is
visible in the control panel and a failing chunk is retried with backoff without
losing what other jobs already produced.
"""
import copy
import logging
import time
from datetime import timedelta

from odoo import _, api, fields, models

_logger = logging.getLogger(__name__)

JOB_STATES = [("queued", "En cola"), ("running", "En ejecución"), ("done", "Terminado"),
              ("failed", "Fallido"), ("cancelled", "Cancelado")]
BACKOFF_MINUTES = (1, 5, 15, 30)


class NovaSyncJob(models.Model):
    _name = "nova.sync.job"
    _description = "NOVA background job (one chunk of a night run)"
    _order = "id desc"

    run_id = fields.Many2one("nova.sync.run", required=True, ondelete="cascade", index=True, readonly=True)
    connection_id = fields.Many2one(related="run_id.connection_id", store=True, readonly=True)
    run_seq = fields.Integer(related="run_id.run_seq", store=True, readonly=True)
    dataset_id = fields.Many2one("nova.export.dataset", readonly=True, ondelete="set null")
    dataset_key = fields.Char(readonly=True, index=True)
    addon = fields.Char(readonly=True, help="Módulo que declara el dataset (compras, inventario, POS…).")
    chunk = fields.Integer(readonly=True, default=1, help="Número de trozo dentro del dataset.")
    state = fields.Selection(JOB_STATES, default="queued", required=True, readonly=True, index=True)
    scheduled_at = fields.Datetime(default=fields.Datetime.now, readonly=True, index=True)
    started_at = fields.Datetime(readonly=True)
    finished_at = fields.Datetime(readonly=True)
    duration_ms = fields.Integer(readonly=True)
    attempts = fields.Integer(readonly=True)
    phase_start = fields.Char(readonly=True)
    phase_end = fields.Char(readonly=True)
    records = fields.Integer(readonly=True, help="Registros exportados por este trabajo.")
    parts = fields.Integer(readonly=True)
    events = fields.Integer(readonly=True)
    error = fields.Char(readonly=True, help="Tipo de error, sin datos de negocio.")
    duration_s = fields.Float(compute="_compute_duration_s", string="Duración (s)")

    def _compute_duration_s(self):
        for job in self:
            job.duration_s = (job.duration_ms or 0) / 1000.0

    def init(self):
        # The runner always looks for the next queued job of a run.
        self.env.cr.execute(
            "CREATE INDEX IF NOT EXISTS nova_sync_job_queue_idx "
            "ON nova_sync_job (run_id, scheduled_at, id) WHERE state = 'queued'")

    # ------------------------------------------------------------ operator actions
    def action_retry(self):
        """Re-queue failed jobs of a run that is still being prepared."""
        for job in self.filtered(lambda j: j.state == "failed" and j.run_id.state == "preparing"):
            progress = job.run_id._nova_progress()
            st = progress.get("datasets", {}).get(job.dataset_key)
            if st:
                st.pop("error", None)
                if st.get("phase") == "done" and st.get("failed_phase"):
                    st["phase"] = st.pop("failed_phase")
                job.run_id.sudo().write({"progress": _json_dumps(progress)})
            job.sudo().write({"state": "queued", "attempts": 0, "error": False,
                              "scheduled_at": fields.Datetime.now()})
        self.env.ref("nova_connector.ir_cron_nova_prepare")._trigger()


def _json_dumps(value):
    import json
    return json.dumps(value, sort_keys=True)


class NovaSyncRunJobs(models.Model):
    _inherit = "nova.sync.run"

    job_ids = fields.One2many("nova.sync.job", "run_id", readonly=True)
    jobs_total = fields.Integer(compute="_compute_jobs")
    jobs_done = fields.Integer(compute="_compute_jobs")
    jobs_queued = fields.Integer(compute="_compute_jobs")
    jobs_failed = fields.Integer(compute="_compute_jobs")
    jobs_progress = fields.Float(compute="_compute_jobs", string="Avance (%)")

    def _compute_jobs(self):
        groups = self.env["nova.sync.job"].sudo().read_group(
            [("run_id", "in", self.ids)], ["run_id"], ["run_id", "state"], lazy=False)
        counts = {}
        for g in groups:
            counts.setdefault(g["run_id"][0], {})[g["state"]] = g["__count"]
        for run in self:
            c = counts.get(run.id, {})
            total = sum(c.values())
            run.jobs_total = total
            run.jobs_done = c.get("done", 0)
            run.jobs_queued = c.get("queued", 0) + c.get("running", 0)
            run.jobs_failed = c.get("failed", 0)
            finished = c.get("done", 0) + c.get("failed", 0) + c.get("cancelled", 0)
            run.jobs_progress = (100.0 * finished / total) if total else 0.0

    # ------------------------------------------------------------ queue
    def _nova_enqueue_initial(self):
        """One job per usable dataset, in registry order (parts are numbered sequentially)."""
        self.ensure_one()
        Job = self.env["nova.sync.job"].sudo()
        now = fields.Datetime.now()
        datasets = self.env["nova.export.dataset"].sudo().search([])._nova_usable()
        Job.create([{"run_id": self.id, "dataset_id": ds.id, "dataset_key": ds.key, "addon": ds.addon,
                     "chunk": 1, "scheduled_at": now} for ds in datasets])

    def _nova_next_job(self, force=False):
        self.ensure_one()
        domain = [("run_id", "=", self.id), ("state", "=", "queued")]
        if not force:
            domain.append(("scheduled_at", "<=", fields.Datetime.now()))
        return self.env["nova.sync.job"].sudo().search(domain, order="id", limit=1)

    def _nova_requeue_stale_jobs(self, conn):
        """A job left 'running' means its worker was killed (the transaction rolled
        back, so nothing it produced exists): put it back in the queue."""
        self.ensure_one()
        limit = fields.Datetime.now() - timedelta(seconds=max(120, 3 * conn.time_budget_seconds))
        stale = self.env["nova.sync.job"].sudo().search(
            [("run_id", "=", self.id), ("state", "=", "running"), ("started_at", "<", limit)])
        if stale:
            stale.write({"state": "queued", "error": "WorkerKilled", "scheduled_at": fields.Datetime.now()})

    def _nova_has_pending_jobs(self):
        self.ensure_one()
        return bool(self.env["nova.sync.job"].sudo().search_count(
            [("run_id", "=", self.id), ("state", "in", ["queued", "running"])]))

    def _nova_cancel_jobs(self, reason):
        self.env["nova.sync.job"].sudo().search(
            [("run_id", "in", self.ids), ("state", "in", ["queued", "running"])]).write(
            {"state": "cancelled", "error": (reason or "")[:60], "finished_at": fields.Datetime.now()})

    def _nova_run_job(self, conn, job, budget_seconds):
        """Execute one bounded chunk of one dataset. Never raises: a failure is
        rolled back to the savepoint and the job is re-queued with backoff."""
        self.ensure_one()
        dataset = job.dataset_id
        progress = self._nova_progress()
        if not dataset or dataset not in dataset._nova_usable():
            job.write({"state": "cancelled", "error": "DatasetNotUsable", "finished_at": fields.Datetime.now()})
            return
        if dataset.key not in progress["datasets"]:
            progress["datasets"][dataset.key] = self._nova_initial_state(dataset)
        state = progress["datasets"][dataset.key]
        started = time.monotonic()
        job.write({"state": "running", "started_at": fields.Datetime.now(), "attempts": job.attempts + 1,
                   "phase_start": state["phase"]})
        before = (state["records"], len(state["parts"]), state["events"])
        snap = (copy.deepcopy(state), progress["next_part_no"], progress["next_seq"])
        deadline = started + budget_seconds
        budget = {"parts": conn.max_parts_per_invocation}
        company_ids = conn.company_ids.ids
        try:
            with self.env.cr.savepoint():
                while state["phase"] != "done" and time.monotonic() < deadline and budget["parts"] > 0:
                    self._nova_step(conn, dataset, state, progress, company_ids, budget)
        except Exception as exc:  # noqa: BLE001
            _logger.exception("NOVA: job %s (%s) failed", job.id, dataset.key)
            self.env.invalidate_all()
            saved, progress["next_part_no"], progress["next_seq"] = snap
            state.clear()
            state.update(saved)
            name = type(exc).__name__
            elapsed = int((time.monotonic() - started) * 1000)
            if job.attempts < max(1, conn.job_max_attempts):
                delay = BACKOFF_MINUTES[min(job.attempts, len(BACKOFF_MINUTES)) - 1]
                job.write({"state": "queued", "error": name, "duration_ms": elapsed,
                           "scheduled_at": fields.Datetime.now() + timedelta(minutes=delay)})
            else:
                state["failed_phase"] = state["phase"]
                state["phase"] = "done"
                state["error"] = name
                job.write({"state": "failed", "error": name, "duration_ms": elapsed,
                           "finished_at": fields.Datetime.now(), "phase_end": "error"})
                dataset.sudo().write({"last_error": _("Error de exportación (%s)") % name})
            self.sudo().write({"progress": _json_dumps(progress)})
            return
        self.sudo().write({"progress": _json_dumps(progress)})
        job.write({"state": "done", "finished_at": fields.Datetime.now(), "error": False,
                   "duration_ms": int((time.monotonic() - started) * 1000), "phase_end": state["phase"],
                   "records": state["records"] - before[0], "parts": len(state["parts"]) - before[1],
                   "events": state["events"] - before[2]})
        if state["phase"] != "done":
            job.copy({"state": "queued", "chunk": job.chunk + 1, "scheduled_at": fields.Datetime.now(),
                      "attempts": 0, "started_at": False, "finished_at": False, "duration_ms": 0,
                      "records": 0, "parts": 0, "events": 0, "error": False,
                      "phase_start": False, "phase_end": False})

    # ------------------------------------------------------------ retention of job history
    @api.model
    def _nova_purge_jobs(self, limit_dt):
        self.env.cr.execute(
            "DELETE FROM nova_sync_job j USING nova_sync_run r WHERE j.run_id = r.id "
            "AND r.state IN ('acknowledged', 'failed', 'cancelled') AND r.write_date < %s", (limit_dt,))
