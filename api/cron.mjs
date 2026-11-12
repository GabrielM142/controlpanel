// Vercel Cron entry for the NOVA worker: one bounded scheduler tick per call
// (same code as `node worker/run.mjs --once`). Vercel calls it on the schedule
// in vercel.json with `Authorization: Bearer $CRON_SECRET`; anything else is 401.
// Sources decide by themselves when they are due (collect_after / next_collect_at),
// so a frequent schedule only costs one cheap query when nothing is due.
// Uses the direct (unpooled) connection: processSource holds session advisory
// locks, which a transaction pooler would not keep.
import {timingSafeEqual} from 'node:crypto';
import {loadConfig} from '../lib/config.mjs';
import {createPool, withTransaction} from '../lib/db.mjs';
import {defaultTransportFactory, syncRegistry, tick} from '../lib/ingest/worker.mjs';
import {dispatchAlerts} from '../lib/alerts.mjs';

let state;
const log = (level, event, data = {}) => console.log(JSON.stringify({ts: new Date().toISOString(), level, event, ...data}));

function authorized(req) {
  const secret = process.env.CRON_SECRET || '';
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return secret.length >= 16 && got.length === want.length && timingSafeEqual(got, want);
}

async function init() {
  const config = loadConfig({...process.env, DATABASE_URL: process.env.OMEGA_DATABASE_URL_UNPOOLED || process.env.OMEGA_DATABASE_URL || ''});
  if (!config.databaseUrl) throw new Error('DATABASE_URL no configurada');
  if (!config.secretKey) throw new Error('NOVA_SECRET_KEY no configurada');
  const role = process.env.NOVA_DB_ROLE === undefined ? 'nova_worker' : config.dbRole;
  const pool = createPool(config, {max: config.workerConcurrency + 2, statementTimeoutMs: 10 * 60 * 1000, applicationName: 'nova-cron'});
  await syncRegistry(pool, role);
  return {config, role, pool, opts: {config, transportFactory: defaultTransportFactory(config), log}};
}

/** A previous invocation killed by the time limit leaves runs in 'downloading': free them
 * (stored parts are reused) unless another invocation still holds that source's lock. */
async function recoverInterrupted({pool, role}) {
  const sources = await withTransaction(pool, {role}, async c =>
    (await c.query("SELECT DISTINCT source_id FROM ingest.runs WHERE state = 'downloading'")).rows.map(r => r.source_id));
  for (const id of sources) {
    const client = await pool.connect();
    try {
      const ok = (await client.query("SELECT pg_try_advisory_lock(hashtext('nova-source:' || $1)) AS ok", [id])).rows[0].ok;
      if (!ok) continue;
      try {
        await withTransaction(pool, {role}, c => c.query(
          "UPDATE ingest.runs SET state = 'failed', error = 'Ejecución interrumpida; se reintentará' WHERE source_id = $1 AND state = 'downloading'", [id]));
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('nova-source:' || $1))", [id]).catch(() => {});
      }
    } finally {
      client.release();
    }
  }
}

export default async function cron(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!authorized(req)) { res.statusCode = 401; return res.end(JSON.stringify({error: 'No autorizado'})); }
  const started = Date.now();
  try {
    state ??= await init();
    await recoverInterrupted(state);
    const results = await tick(state.pool, state.role, state.opts);
    // After a new close: threshold alerts to each company's Telegram (once per published version).
    const alerts = await dispatchAlerts(state.pool, withTransaction, {secretKey: state.config.secretKey, log,
      panelUrl: process.env.NOVA_PANEL_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')})
      .catch(e => { log('warn', 'alerts_dispatch_failed', {error: e.message}); return []; });
    log('info', 'cron_tick', {sources: results.length, ms: Date.now() - started});
    res.statusCode = 200;
    res.end(JSON.stringify({ok: true, sources: results.length, results: results.map(r => r.status), alerts: alerts.length, ms: Date.now() - started}));
  } catch (error) {
    state = undefined; // rebuild the pool on the next call
    log('error', 'cron_failed', {error: error.message});
    res.statusCode = 500;
    res.end(JSON.stringify({ok: false, error: error.message}));
  }
}
