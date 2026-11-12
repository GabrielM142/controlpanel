import base64
import json
import logging
import time
import uuid
from datetime import timedelta

import pytz

from odoo import _, api, fields, models, release
from odoo.exceptions import UserError

from ..nova_lib.batching import PartBuilder, build_manifest, gzip_bytes, canonical_bytes
from ..nova_lib.schedule import night_window, utc_iso

_logger = logging.getLogger(__name__)

CONNECTOR_VERSION = "16.0.1.0.0"
RUN_STATES = [("pending", "Pendiente"), ("preparing", "Preparando"), ("ready", "Listo"),
              ("acknowledged", "Confirmado"), ("failed", "Fallido"), ("cancelled", "Cancelado")]


class NovaSyncCursor(models.Model):
    """Technical progress per dataset, committed only when NOVA acknowledges
    the run that advanced it (a cancelled run never moves the cursor)."""

    _name = "nova.sync.cursor"
    _description = "NOVA dataset cursor"

    dataset_id = fields.Many2one("nova.export.dataset", required=True, ondelete="cascade", index=True)
    backfill_done = fields.Boolean(readonly=True)
    backfill_last_id = fields.Integer(readonly=True)
    backfill_started_at = fields.Datetime(readonly=True)
    scan_ts = fields.Datetime(readonly=True)
    scan_id = fields.Integer(readonly=True)
    resync_epoch = fields.Integer(default=1, readonly=True)
    acked_run_id = fields.Many2one("nova.sync.run", readonly=True, ondelete="set null")

    _sql_constraints = [("dataset_uniq", "unique(dataset_id)", "Un cursor por dataset")]

    @api.model
    def _nova_for(self, dataset):
        cursor = self.sudo().search([("dataset_id", "=", dataset.id)], limit=1)
        return cursor or self.sudo().create({"dataset_id": dataset.id})

    def _nova_start_resync(self):
        for cur in self:
            cur.write({"backfill_done": False, "backfill_last_id": 0, "backfill_started_at": False,
                       "resync_epoch": cur.resync_epoch + 1})


class NovaSyncPart(models.Model):
    _name = "nova.sync.part"
    _description = "NOVA immutable batch part"
    _order = "run_id, part_no"

    run_id = fields.Many2one("nova.sync.run", required=True, ondelete="cascade", index=True, readonly=True)
    part_no = fields.Integer(required=True, readonly=True)
    dataset_key = fields.Char(required=True, readonly=True)
    records_count = fields.Integer(readonly=True)
    bytes = fields.Integer(readonly=True, help="Bytes sin comprimir (base del checksum)")
    compressed_bytes = fields.Integer(readonly=True)
    sha256 = fields.Char(readonly=True)
    attachment_id = fields.Many2one("ir.attachment", readonly=True, ondelete="set null")
    purged = fields.Boolean(readonly=True)

    _sql_constraints = [("run_part_uniq", "unique(run_id, part_no)", "Parte duplicada")]

    def write(self, vals):
        allowed = {"purged", "attachment_id"}
        if set(vals) - allowed and not self.env.context.get("nova_internal"):
            raise UserError(_("Las partes de un lote son inmutables."))
        return super().write(vals)

    def _nova_content_b64(self):
        self.ensure_one()
        if self.purged or not self.attachment_id:
            raise UserError(_("Parte purgada o inexistente."))
        return base64.b64encode(self.attachment_id.sudo().raw).decode("ascii")


class NovaSyncRun(models.Model):
    _name = "nova.sync.run"
    _description = "NOVA batch run"
    _order = "run_seq desc"

    connection_id = fields.Many2one("nova.connection", required=True, ondelete="cascade", readonly=True)
    run_uuid = fields.Char(required=True, readonly=True, index=True, default=lambda s: str(uuid.uuid4()))
    run_seq = fields.Integer(required=True, readonly=True)
    state = fields.Selection(RUN_STATES, default="pending", required=True, readonly=True, index=True)
    business_date = fields.Date(readonly=True)
    timezone = fields.Char(readonly=True)
    requested_cutoff_at = fields.Datetime(readonly=True)
    observed_from = fields.Datetime(readonly=True)
    observed_to = fields.Datetime(readonly=True)
    ready_at = fields.Datetime(readonly=True)
    acked_at = fields.Datetime(readonly=True)
    receipt_uuid = fields.Char(readonly=True)
    progress = fields.Text(readonly=True, default="{}")
    manifest = fields.Text(readonly=True)
    parts_count = fields.Integer(readonly=True)
    records_count = fields.Integer(readonly=True)
    bytes_total = fields.Integer(readonly=True)
    error = fields.Char(readonly=True, help="Mensaje seguro, sin datos de negocio.")
    part_ids = fields.One2many("nova.sync.part", "run_id", readonly=True)

    _sql_constraints = [("uuid_uniq", "unique(run_uuid)", "UUID de lote duplicado")]

    # ------------------------------------------------------------ cron entry
    @api.model
    def _cron_prepare(self):
        conn = self.env["nova.connection"]._nova_get()
        if not conn:
            return
        self.env["nova.export.dataset"]._nova_sync_registry()
        self._nova_prepare(conn, force=False)

    @api.model
    def _nova_prepare(self, conn, force=False):
        if conn.state != "linked" or not conn._nova_check_fingerprint():
            return False
        # One active preparation per database: lock the connection row, skip if busy.
        self.env.cr.execute("SELECT id FROM nova_connection WHERE id = %s FOR UPDATE SKIP LOCKED", (conn.id,))
        if not self.env.cr.fetchone():
            return False
        self.env.cr.execute("SET LOCAL statement_timeout = %s", (int(conn.query_timeout_ms),))
        tz = pytz.timezone(conn.timezone or "UTC")
        window = night_window(fields.Datetime.now(), tz, conn.window_start_hour, conn.window_end_hour)
        run = self.search([("connection_id", "=", conn.id), ("state", "=", "preparing")], limit=1)
        if not run:
            if not (window["in_window"] or force):
                return False
            done = self.search_count([("connection_id", "=", conn.id),
                                      ("business_date", "=", window["business_date"]),
                                      ("state", "in", ["ready", "acknowledged"])])
            if done and not force:
                return False
            run = self._nova_create_run(conn, window)
        if conn.pending_bytes > conn.max_pending_bytes:
            conn.sudo().write({"last_error": _("Cuota de partes sin confirmar alcanzada: preparación detenida.")})
            _logger.warning("NOVA: pending bytes quota reached, preparation stopped")
            return False
        finished = run._nova_work(conn)
        if finished or not (window["in_window"] or force):
            run._nova_finalize(conn)
            return True
        self.env.ref("nova_connector.ir_cron_nova_prepare")._trigger()
        return False

    @api.model
    def _nova_create_run(self, conn, window):
        seq = conn.next_run_seq
        conn.sudo().write({"next_run_seq": seq + 1})
        return self.sudo().create({
            "connection_id": conn.id, "run_seq": seq, "state": "preparing",
            "business_date": window["business_date"], "timezone": conn.timezone,
            "requested_cutoff_at": window["requested_cutoff_at"].replace("T", " ").rstrip("Z"),
            "observed_from": fields.Datetime.now(),
            "progress": json.dumps({"next_part_no": 1, "next_seq": 1, "datasets": {}}),
        })

    # ------------------------------------------------------------ work
    def _nova_progress(self):
        return json.loads(self.progress or "{}")

    def _nova_work(self, conn):
        """Bounded work; returns True when every dataset reached phase 'done'."""
        self.ensure_one()
        deadline = time.monotonic() + conn.time_budget_seconds
        budget = {"parts": conn.max_parts_per_invocation}
        progress = self._nova_progress()
        datasets = self.env["nova.export.dataset"].sudo().search([])._nova_usable()
        company_ids = conn.company_ids.ids
        all_done = True
        for dataset in datasets:
            state = progress["datasets"].setdefault(dataset.key, self._nova_initial_state(dataset))
            while state["phase"] != "done":
                if time.monotonic() > deadline or budget["parts"] <= 0:
                    all_done = False
                    break
                try:
                    self._nova_step(conn, dataset, state, progress, company_ids, budget)
                except Exception as exc:  # noqa: BLE001
                    _logger.exception("NOVA: dataset %s failed", dataset.key)
                    state["phase"] = "done"
                    state["error"] = type(exc).__name__
                    dataset.sudo().write({"last_error": _("Error de exportación (%s)") % type(exc).__name__})
            if state["phase"] != "done":
                all_done = False
                break
        self.sudo().write({"progress": json.dumps(progress, sort_keys=True)})
        return all_done

    def _nova_initial_state(self, dataset):
        cursor = self.env["nova.sync.cursor"]._nova_for(dataset)
        spec = dataset._nova_spec()
        snapshot = spec["mode"] == "snapshot_replace"
        phase = "backfill" if (snapshot or not cursor.backfill_done) else "events"
        return {"phase": phase, "parts": [], "records": 0, "events": 0,
                "mode": spec["mode"], "snapshot": snapshot,
                "backfill_last_id": 0 if snapshot else cursor.backfill_last_id,
                "backfill_done": False if snapshot else cursor.backfill_done,
                "backfill_started_at": (utc_iso(cursor.backfill_started_at) if cursor.backfill_started_at
                                        else utc_iso(fields.Datetime.now())),
                "scan_ts": utc_iso(cursor.scan_ts) if cursor.scan_ts else None,
                "scan_id": cursor.scan_id or 0, "epoch": cursor.resync_epoch,
                "version": dataset.version}

    def _nova_builder(self, conn, dataset, progress):
        return PartBuilder(self.run_uuid, dataset.key, dataset.version, conn.max_rows_per_part,
                           conn.max_bytes_per_part, progress["next_part_no"], progress["next_seq"])

    def _nova_emit(self, builder, state, progress, records, budget):
        for rec in records:
            builder.add(rec)
        builder.flush()
        for part in builder.parts:
            self._nova_store_part(part)
            state["parts"].append(part.part_no)
            state["records"] += part.records
            budget["parts"] -= 1
        builder.parts = []
        progress["next_part_no"] = builder.next_part_no
        progress["next_seq"] = builder.next_seq

    def _nova_store_part(self, part):
        compressed = gzip_bytes(part.content)
        rec = self.env["nova.sync.part"].sudo().create({
            "run_id": self.id, "part_no": part.part_no, "dataset_key": part.dataset,
            "records_count": part.records, "bytes": part.bytes, "compressed_bytes": len(compressed),
            "sha256": part.sha256,
        })
        attachment = self.env["ir.attachment"].sudo().create({
            "name": "nova-%s-%05d.json.gz" % (self.run_uuid, part.part_no),
            "raw": compressed, "res_model": "nova.sync.part", "res_id": rec.id,
            "mimetype": "application/gzip", "public": False,
        })
        rec.with_context(nova_internal=True).write({"attachment_id": attachment.id})

    def _nova_step(self, conn, dataset, state, progress, company_ids, budget):
        spec = dataset._nova_spec()
        Model = dataset._nova_model()
        domain = dataset._nova_company_domain(spec, company_ids)
        builder = self._nova_builder(conn, dataset, progress)
        page = conn.max_rows_per_part
        if state["phase"] == "backfill":
            records = Model.search(domain + [("id", ">", state["backfill_last_id"])], order="id", limit=page)
            if not records:
                state["backfill_done"] = True
                state["phase"] = "done" if state["snapshot"] else "events"
                if not state["snapshot"] and not state.get("scan_ts"):
                    state["scan_ts"] = state["backfill_started_at"]
                    state["scan_id"] = 0
                return
            self._nova_emit(builder, state, progress, dataset._nova_serialize(records, "backfill"), budget)
            state["backfill_last_id"] = records[-1].id
            return
        if state["phase"] == "events":
            rows = self.env["nova.change.event"]._nova_claim(self, dataset.key, page)
            if not rows:
                state["phase"] = "scan" if (dataset.scan_enabled and "write_date" in Model._fields) else "done"
                return
            state["events"] += len(rows)
            self._nova_emit(builder, state, progress,
                            self._nova_records_from_events(dataset, Model, domain, rows), budget)
            return
        if state["phase"] == "scan":
            records = self._nova_scan_page(conn, Model, domain, state, page)
            if not records:
                state["phase"] = "done"
                return
            self._nova_emit(builder, state, progress, dataset._nova_serialize(records, "scan"), budget)
            last = records[-1]
            state["scan_ts"] = utc_iso(last.write_date)
            state["scan_id"] = last.id
            return

    def _nova_scan_page(self, conn, Model, domain, state, page):
        """Keyset pagination on (write_date, id) with a configurable overlap."""
        if not state.get("scan_ts"):
            return Model.browse()
        if not state.get("scan_started"):
            start = fields.Datetime.from_string(state["scan_ts"].replace("T", " ").rstrip("Z"))
            start -= timedelta(minutes=conn.scan_overlap_minutes)
            state["scan_ts"] = utc_iso(start)
            state["scan_id"] = 0
            state["scan_started"] = True
        ts = state["scan_ts"].replace("T", " ").rstrip("Z")
        upper = fields.Datetime.to_string(self.observed_from)
        keyset = ["|", ("write_date", ">", ts), "&", ("write_date", "=", ts), ("id", ">", state["scan_id"])]
        return Model.search(domain + keyset + [("write_date", "<=", upper)], order="write_date, id", limit=page)

    def _nova_records_from_events(self, dataset, Model, domain, rows):
        ids = sorted({r[1] for r in rows})
        delete_refs = {}
        event_company = {}
        for _event_id, res_id, op, refs, company_id in rows:
            event_company[res_id] = company_id
            if op == "delete":
                delete_refs[res_id] = json.loads(refs) if refs else {}
        in_scope = Model.search(domain + [("id", "in", ids)])
        existing = set(Model.browse(ids).exists().ids)
        out = dataset._nova_serialize(in_scope, "event") if in_scope else []
        scoped = set(in_scope.ids)
        for res_id in ids:
            if res_id in scoped:
                continue
            refs = delete_refs.get(res_id, {})
            company = refs.get("company_id") or event_company.get(res_id) or None
            out.append({"op": "delete", "id": res_id, "company_id": company, "refs": refs,
                        "reason": "out_of_scope" if res_id in existing else "deleted"})
        return out

    # ------------------------------------------------------------ finalize
    def _nova_finalize(self, conn):
        self.ensure_one()
        progress = self._nova_progress()
        conn_info = {"installation_uuid": conn.installation_uuid, "generation": conn.source_generation,
                     "odoo_version": release.version, "connector_version": CONNECTOR_VERSION}
        datasets, reconciliation, warnings = [], [], []
        for dataset in self.env["nova.export.dataset"].sudo().search([])._nova_usable():
            st = progress["datasets"].get(dataset.key)
            if not st:
                warnings.append({"code": "dataset_not_processed", "dataset": dataset.key})
                continue
            entry = {"key": dataset.key, "version": st["version"], "mode": st["mode"],
                     "records": st["records"], "parts": st["parts"], "events": st["events"],
                     "backfill_complete": bool(st["backfill_done"]), "resync_epoch": st["epoch"],
                     "missing_optional_fields": [f.strip() for f in (dataset.missing_optional or "").split(",") if f.strip()],
                     "complete": st["phase"] == "done" and not st.get("error")}
            if st["snapshot"]:
                entry["scope"] = {"company_ids": sorted(conn.company_ids.ids)}
            if st.get("error"):
                warnings.append({"code": "dataset_error", "dataset": dataset.key, "error": st["error"]})
            datasets.append(entry)
            if dataset.reconcile_enabled and st["backfill_done"] and not st["snapshot"]:
                reconciliation.extend(dataset._nova_reconcile(conn.company_ids.ids))
        if conn.resync_required:
            warnings.append({"code": "resync_required", "reason": conn.resync_reason or ""})
        if conn.pending_events > conn.max_pending_events:
            warnings.append({"code": "event_queue_high", "pending": conn.pending_events})
        parts = [p for p in self.part_ids.sorted("part_no")]
        descriptors = [{"part_no": p.part_no, "dataset": p.dataset_key, "records": p.records_count,
                        "bytes": p.bytes, "sha256": p.sha256, "encoding": "gzip+base64"} for p in parts]
        now = fields.Datetime.now()
        manifest = build_manifest({
            "run_uuid": self.run_uuid, "run_seq": self.run_seq, "source": conn_info,
            "business_date": fields.Date.to_string(self.business_date), "timezone": self.timezone,
            "requested_cutoff_at": utc_iso(self.requested_cutoff_at),
            "observed_from": utc_iso(self.observed_from), "observed_to": utc_iso(now),
            "companies": conn.company_ids.ids,
        }, datasets, descriptors, reconciliation, warnings)
        self.sudo().write({"state": "ready", "observed_to": now, "ready_at": now,
                           "manifest": canonical_bytes(manifest).decode("utf-8"),
                           "parts_count": len(parts), "records_count": manifest["totals"]["records"],
                           "bytes_total": manifest["totals"]["bytes"]})
        conn.sudo().write({"last_prepared_at": now, "last_error": False})

    # ------------------------------------------------------------ ack / cancel
    def _nova_ack(self, receipt):
        """Idempotent. Validates the receipt against every part checksum, then
        commits cursors and marks the run's exact events as acknowledged."""
        self.ensure_one()
        if self.state == "acknowledged":
            return {"status": "already_acknowledged", "receipt_uuid": self.receipt_uuid}
        if self.state != "ready":
            raise UserError(_("El lote no está listo."))
        received = {int(p["part_no"]): p.get("sha256") for p in (receipt.get("parts") or [])}
        for part in self.part_ids:
            if received.get(part.part_no) != part.sha256:
                raise UserError(_("Recibo incompleto o con checksum distinto (parte %s).") % part.part_no)
        if len(received) != len(self.part_ids):
            raise UserError(_("El recibo incluye partes desconocidas."))
        receipt_uuid = str(receipt.get("receipt_uuid") or "")
        try:
            uuid.UUID(receipt_uuid)
        except ValueError:
            raise UserError(_("receipt_uuid inválido."))
        progress = self._nova_progress()
        for key, st in progress.get("datasets", {}).items():
            dataset = self.env["nova.export.dataset"].sudo().search([("key", "=", key)], limit=1)
            if not dataset or st["snapshot"]:
                continue
            cursor = self.env["nova.sync.cursor"]._nova_for(dataset)
            if cursor.resync_epoch != st["epoch"]:
                continue  # a resync started meanwhile: keep the new cursor
            vals = {"backfill_last_id": st["backfill_last_id"], "backfill_done": st["backfill_done"],
                    "acked_run_id": self.id}
            if not cursor.backfill_started_at:
                vals["backfill_started_at"] = st["backfill_started_at"].replace("T", " ").rstrip("Z")
            if st.get("scan_ts"):
                vals["scan_ts"] = st["scan_ts"].replace("T", " ").rstrip("Z")
                vals["scan_id"] = st.get("scan_id", 0)
            cursor.write(vals)
        self.env.cr.execute("UPDATE nova_change_event SET state = 'acked' WHERE run_id = %s", (self.id,))
        self.env["nova.change.event"].invalidate_model(["state"])
        self.sudo().write({"state": "acknowledged", "acked_at": fields.Datetime.now(),
                           "receipt_uuid": receipt_uuid})
        conn = self.connection_id
        if conn.resync_required and all(c.backfill_done for c in self.env["nova.sync.cursor"].sudo().search([])):
            conn.sudo().write({"resync_required": False, "resync_reason": False})
        return {"status": "acknowledged", "receipt_uuid": receipt_uuid}

    def _nova_cancel(self, reason):
        for run in self:
            self.env.cr.execute("UPDATE nova_change_event SET state = 'pending', run_id = NULL "
                                "WHERE run_id = %s AND state = 'exported'", (run.id,))
            run.sudo().write({"state": "cancelled", "error": (reason or "")[:200]})
        self.env["nova.change.event"].invalidate_model(["state", "run_id"])

    def action_cancel(self):
        self.filtered(lambda r: r.state in ("pending", "preparing", "ready"))._nova_cancel(_("Cancelado por operador"))

    @api.model
    def action_prepare_now(self):
        conn = self.env["nova.connection"]._nova_get()
        if not conn:
            raise UserError(_("No hay conexión NOVA."))
        self.env["nova.export.dataset"]._nova_sync_registry()
        self._nova_prepare(conn, force=True)

    # ------------------------------------------------------------ retention
    @api.model
    def _cron_retention(self):
        conn = self.env["nova.connection"]._nova_get()
        if not conn:
            return
        limit = fields.Datetime.now() - timedelta(days=conn.retention_days)
        stale = self.search([("state", "=", "preparing"), ("observed_from", "<", fields.Datetime.now() - timedelta(hours=20))])
        for run in stale:
            run._nova_finalize(conn)
        runs = self.search([("state", "in", ["acknowledged", "failed", "cancelled"]), ("write_date", "<", limit)])
        parts = runs.mapped("part_ids").filtered(lambda p: not p.purged)
        parts.mapped("attachment_id").sudo().unlink()
        parts.with_context(nova_internal=True).sudo().write({"purged": True})
        self.env.cr.execute("DELETE FROM nova_change_event WHERE state = 'acked' AND captured_at < %s", (limit,))
