import {gunzipSync} from 'node:zlib';
import {datasetsByKey} from '../contracts.mjs';
import {rebuildCore, rebuildSnapshots} from './transform.mjs';

const CHILDREN = new Map();
for (const ds of datasetsByKey.values()) for (const c of ds.children || []) {
  if (!CHILDREN.has(ds.key)) CHILDREN.set(ds.key, []);
  CHILDREN.get(ds.key).push(c);
}

class Affected {
  constructor() { this.ids = new Map(); this.prev = new Map(); }
  add(dataset, id, prevData) {
    if (!this.ids.has(dataset)) this.ids.set(dataset, new Set());
    this.ids.get(dataset).add(Number(id));
    if (prevData) {
      if (!this.prev.has(dataset)) this.prev.set(dataset, []);
      this.prev.get(dataset).push(prevData);
    }
  }
  of(dataset) { return [...(this.ids.get(dataset) || [])]; }
  prevOf(dataset) { return this.prev.get(dataset) || []; }
}

/** Runs of a source that can be applied now, strictly in run_seq order. */
export async function pendingRuns(db, sourceId) {
  const rows = (await db.query(`SELECT id, run_seq, state FROM ingest.runs WHERE source_id = $1
                                 AND state NOT IN ('applied', 'published') ORDER BY run_seq`, [sourceId])).rows;
  const out = [];
  for (const r of rows) {
    if (r.state !== 'validated') break; // an earlier run not yet validated blocks later ones
    out.push(r.id);
  }
  return out;
}

async function applyRecords(client, ctx, run, dataset, records, affected, epoch) {
  const ids = records.map(r => r.id);
  const existing = new Map((await client.query(
    `SELECT record_id, data, deleted, obs_run_seq, obs_seq FROM staging.records
      WHERE source_id = $1 AND dataset = $2 AND record_id = ANY($3::bigint[])`, [ctx.sourceId, dataset, ids])).rows
    .map(r => [Number(r.record_id), r]));
  const rows = [];
  const changes = [];
  for (const rec of records) {
    const cur = existing.get(rec.id);
    const newer = !cur || Number(cur.obs_run_seq) < run.run_seq
      || (Number(cur.obs_run_seq) === run.run_seq && Number(cur.obs_seq) < rec.seq);
    if (!newer) continue; // replay or older observation: never overwrites newer state
    const isDelete = rec.op === 'delete';
    const data = isDelete ? (cur?.data ?? rec.refs) : rec.data;
    rows.push({id: rec.id, company_id: rec.company_id ?? null, data, deleted: isDelete,
      reason: isDelete ? rec.reason : null, seq: rec.seq});
    // First observation (backfill/new record): the payload already lives in staging.records
    // (first_run_id), so the change log keeps only op + run; storing it twice doubled the
    // central database during historical loads. Updates keep before/after.
    changes.push({record_id: rec.id, op: rec.op, before: cur && !cur.deleted ? cur.data : null,
      after: isDelete || !cur ? null : rec.data});
    existing.set(rec.id, {data, deleted: isDelete, obs_run_seq: run.run_seq, obs_seq: rec.seq});
    affected.add(dataset, rec.id, cur?.data);
    if (isDelete && rec.refs) affected.add(dataset, rec.id, rec.refs);
  }
  if (!rows.length) return;
  // Last write per id within this batch (records are sequence-ordered).
  const last = new Map(rows.map(r => [r.id, r]));
  await client.query(
    `INSERT INTO staging.records AS s(tenant_id, source_id, dataset, record_id, company_id, data, obs_run_seq, obs_seq,
                                     generation, deleted, deleted_reason, deleted_at, seen_epoch, first_run_id, last_run_id, updated_at)
     SELECT $1, $2, $3, x.id, x.company_id, x.data, $4, x.seq, $5, x.deleted, x.reason,
            CASE WHEN x.deleted THEN now() END, $7, $6, $6, now()
       FROM jsonb_to_recordset($8::jsonb) AS x(id bigint, company_id bigint, data jsonb, deleted boolean, reason text, seq bigint)
     ON CONFLICT (source_id, dataset, record_id) DO UPDATE SET
       company_id = EXCLUDED.company_id, data = EXCLUDED.data, obs_run_seq = EXCLUDED.obs_run_seq,
       obs_seq = EXCLUDED.obs_seq, generation = EXCLUDED.generation, deleted = EXCLUDED.deleted,
       deleted_reason = EXCLUDED.deleted_reason, deleted_at = EXCLUDED.deleted_at,
       seen_epoch = greatest(s.seen_epoch, EXCLUDED.seen_epoch), last_run_id = EXCLUDED.last_run_id, updated_at = now()
     WHERE (s.obs_run_seq, s.obs_seq) < (EXCLUDED.obs_run_seq, EXCLUDED.obs_seq)`,
    [ctx.tenantId, ctx.sourceId, dataset, run.run_seq, run.generation, run.id, epoch, JSON.stringify([...last.values()])]);
  await client.query(
    `INSERT INTO staging.record_changes(tenant_id, source_id, run_id, dataset, record_id, op, before, after)
     SELECT $1, $2, $3, $4, x.record_id, x.op, x.before, x.after
       FROM jsonb_to_recordset($5::jsonb) AS x(record_id bigint, op text, before jsonb, after jsonb)`,
    [ctx.tenantId, ctx.sourceId, run.id, dataset, JSON.stringify(changes)]);
}

/** Children whose parent was deleted (ON DELETE CASCADE in Odoo bypasses ORM hooks). */
async function cascadeDeletes(client, ctx, run, affected) {
  for (const [parent, children] of CHILDREN) {
    const deleted = (await client.query(`SELECT record_id FROM staging.records WHERE source_id = $1 AND dataset = $2
                                          AND deleted AND last_run_id = $3`, [ctx.sourceId, parent, run.id])).rows.map(r => r.record_id);
    if (!deleted.length) continue;
    for (const child of children) {
      const rows = (await client.query(
        `UPDATE staging.records SET deleted = true, deleted_reason = 'parent_deleted', deleted_at = now(), last_run_id = $4, updated_at = now()
          WHERE source_id = $1 AND dataset = $2 AND NOT deleted AND (data->>$5)::bigint = ANY($3::bigint[])
          RETURNING record_id, data`, [ctx.sourceId, child.dataset, deleted, run.id, child.fk])).rows;
      for (const r of rows) affected.add(child.dataset, r.record_id, r.data);
    }
  }
}

async function snapshotAndResync(client, ctx, run, manifest, affected) {
  for (const ds of manifest.datasets) {
    if (ds.mode === 'snapshot_replace') {
      if (!ds.complete) {
        await quality(client, ctx, run, 'snapshot_incomplete', ds.key, null, 'warn', {note: 'Snapshot parcial: no se limpia el destino'});
        continue;
      }
      // Complete manifest for an explicit scope: rows not observed in this run disappear (empty snapshot = legit empty).
      const rows = (await client.query(
        `UPDATE staging.records SET deleted = true, deleted_reason = 'snapshot_replace', deleted_at = now(), last_run_id = $4, updated_at = now()
          WHERE source_id = $1 AND dataset = $2 AND NOT deleted AND company_id = ANY($3::bigint[]) AND last_run_id <> $4
          RETURNING record_id, data`, [ctx.sourceId, ds.key, ds.scope.company_ids, run.id])).rows;
      for (const r of rows) affected.add(ds.key, r.record_id, r.data);
    }
    const cp = (await client.query('SELECT resync_epoch, backfill_complete FROM ops.sync_checkpoints WHERE source_id = $1 AND dataset = $2',
      [ctx.sourceId, ds.key])).rows[0];
    if (ds.mode === 'delta' && ds.backfill_complete && ds.complete && cp && ds.resync_epoch > cp.resync_epoch) {
      // A full re-export of a new epoch finished: anything not seen in it was deleted outside the ORM.
      const rows = (await client.query(
        `UPDATE staging.records SET deleted = true, deleted_reason = 'resync_missing', deleted_at = now(), last_run_id = $4, updated_at = now()
          WHERE source_id = $1 AND dataset = $2 AND NOT deleted AND seen_epoch < $3 RETURNING record_id, data`,
        [ctx.sourceId, ds.key, ds.resync_epoch, run.id])).rows;
      for (const r of rows) affected.add(ds.key, r.record_id, r.data);
    }
    await client.query(
      `INSERT INTO ops.sync_checkpoints(tenant_id, source_id, dataset, last_applied_run_seq, backfill_complete, resync_epoch, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (source_id, dataset) DO UPDATE SET last_applied_run_seq = EXCLUDED.last_applied_run_seq,
         backfill_complete = EXCLUDED.backfill_complete,
         resync_epoch = CASE WHEN EXCLUDED.backfill_complete THEN greatest(ops.sync_checkpoints.resync_epoch, EXCLUDED.resync_epoch)
                             ELSE ops.sync_checkpoints.resync_epoch END,
         updated_at = now()`,
      [ctx.tenantId, ctx.sourceId, ds.key, run.run_seq, ds.backfill_complete, ds.resync_epoch]);
  }
}

async function quality(client, ctx, run, check, dataset, company, status, details) {
  await client.query(`INSERT INTO ops.data_quality_results(tenant_id, source_id, run_id, check_name, dataset, company_id, status, details)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [ctx.tenantId, ctx.sourceId, run.id, check, dataset, company, status, JSON.stringify(details)]);
}

async function reconcile(client, ctx, run, manifest) {
  for (const r of manifest.reconciliation || []) {
    const got = (await client.query(
      `SELECT count(*)::bigint AS count, coalesce(sum(record_id), 0)::text AS id_sum FROM staging.records
        WHERE source_id = $1 AND dataset = $2 AND NOT deleted AND ($3::bigint IS NULL OR company_id = $3)`,
      [ctx.sourceId, r.dataset, r.company_id])).rows[0];
    const ok = Number(got.count) === r.count && got.id_sum === r.id_sum;
    await quality(client, ctx, run, 'reconciliation', r.dataset, r.company_id, ok ? 'ok' : 'fail',
      {source_count: r.count, central_count: Number(got.count), source_id_sum: r.id_sum, central_id_sum: got.id_sum});
  }
  for (const w of manifest.warnings || []) {
    if (w.code === 'fixture') continue;
    await quality(client, ctx, run, `source_${w.code}`, w.dataset || null, null, 'warn', w);
  }
}

async function publish(client, ctx, run) {
  const prev = (await client.query('SELECT version, sources FROM ops.published_versions WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1',
    [ctx.tenantId])).rows[0];
  const sources = {...(prev?.sources || {})};
  sources[ctx.sourceId] = {run_seq: Number(run.run_seq), run_uuid: run.run_uuid, business_date: run.business_date,
    observed_from: run.observed_from, observed_to: run.observed_to, requested_cutoff_at: run.requested_cutoff_at};
  const dates = Object.values(sources).map(s => s.business_date).filter(Boolean).sort();
  const version = (prev?.version || 0) + 1;
  await client.query(`INSERT INTO ops.published_versions(tenant_id, version, business_date, sources, consistency)
                      VALUES ($1, $2, $3, $4, 'captured_interval')`, [ctx.tenantId, version, dates[0] || null, JSON.stringify(sources)]);
  const exec = (await client.query(
    `SELECT coalesce(sum(net_amount) FILTER (WHERE business_date >= date_trunc('month', $2::date)), 0)::text AS sales_mtd,
            coalesce(sum(net_amount) FILTER (WHERE business_date >= date_trunc('year', $2::date)), 0)::text AS sales_ytd
       FROM mart.sales_day WHERE tenant_id = $1 AND business_date <= $2::date`, [ctx.tenantId, dates[0] || run.business_date])).rows[0];
  await client.query('INSERT INTO mart.executive_snapshot(tenant_id, version, business_date, payload) VALUES ($1, $2, $3, $4)',
    [ctx.tenantId, version, dates[0] || null, JSON.stringify({...exec, sources})]);
  return version;
}

/**
 * Apply one validated run in a single transaction: staging upserts/deletes with
 * observation ordering, cascades, snapshot/resync cleanup, reconciliation, core
 * and mart rebuild for affected keys/dates, and publication of a new version.
 * Any failure rolls back everything: the last published version stays intact
 * and stored parts allow a retry without downloading again.
 */
export async function applyRun(client, runId, {log = () => {}} = {}) {
  const run = (await client.query(`SELECT r.*, s.timezone, s.attribute_map FROM ingest.runs r JOIN app.connector_sources s ON s.id = r.source_id
                                    WHERE r.id = $1 FOR UPDATE OF r`, [runId])).rows[0];
  if (!run || run.state !== 'validated') return null;
  run.run_seq = Number(run.run_seq);
  const ctx = {tenantId: run.tenant_id, sourceId: run.source_id, timezone: run.timezone, attributeMap: run.attribute_map || []};
  const manifest = run.manifest;
  const epochs = new Map(manifest.datasets.map(d => [d.key, d.resync_epoch]));
  const affected = new Affected();
  const parts = (await client.query('SELECT part_no, dataset, payload FROM ingest.parts WHERE run_id = $1 ORDER BY part_no', [runId])).rows;
  for (const part of parts) {
    const doc = JSON.parse(gunzipSync(part.payload).toString('utf8'));
    await applyRecords(client, ctx, run, doc.dataset, doc.records, affected, epochs.get(doc.dataset) || 1);
  }
  await cascadeDeletes(client, ctx, run, affected);
  await snapshotAndResync(client, ctx, run, manifest, affected);
  await reconcile(client, ctx, run, manifest);
  const dates = await rebuildCore(client, ctx, affected);
  await rebuildSnapshots(client, ctx, run.business_date);
  await client.query(`UPDATE ingest.runs SET state = 'applied', applied_at = now(), error = NULL WHERE id = $1`, [runId]);
  const version = await publish(client, ctx, run);
  await client.query(`UPDATE ingest.runs SET state = 'published', published_at = now() WHERE id = $1`, [runId]);
  log('info', 'run_published', {run: run.run_uuid, version, affected_dates: dates.length});
  return {version, affectedDates: dates};
}
