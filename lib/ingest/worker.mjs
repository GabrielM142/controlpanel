import {readFileSync} from 'node:fs';
import {registry} from '../contracts.mjs';
import {resolveSecret} from '../crypto.mjs';
import {withTransaction} from '../db.mjs';
import {assertAllowedSourceUrl, guardedFetch} from '../net-guard.mjs';
import {localMinutes, nextLocalTime} from '../time.mjs';
import {applyRun, pendingRuns} from './apply.mjs';
import {collectSource} from './collect.mjs';
import {createOdooTransport} from './odoo-transport.mjs';

export async function syncRegistry(pool, role) {
  await withTransaction(pool, {role}, async c => {
    for (const d of registry.datasets) {
      await c.query(`INSERT INTO app.dataset_registry(key, version, min_version, addon, model, mode, contract, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
                     ON CONFLICT (key) DO UPDATE SET version = EXCLUDED.version, min_version = EXCLUDED.min_version,
                       addon = EXCLUDED.addon, model = EXCLUDED.model, mode = EXCLUDED.mode, contract = EXCLUDED.contract, updated_at = now()`,
      [d.key, d.version, d.min_version, d.addon, d.model, d.mode, JSON.stringify(d)]);
    }
  });
}

export function defaultTransportFactory(config) {
  return async (source, credential) => {
    await assertAllowedSourceUrl(source.base_url, {allowInsecure: config.allowInsecureSources, allowlist: config.sourceHostAllowlist});
    return createOdooTransport({baseUrl: source.base_url, db: source.db_name, login: source.login,
      apiKey: resolveSecret(credential, config.secretKey), maxResponseBytes: Math.ceil(config.maxPartBytes * 1.5) + 65536,
      fetchImpl: guardedFetch({allowlist: config.sourceHostAllowlist})});
  };
}

async function loadSource(c, sourceId) {
  const source = (await c.query('SELECT * FROM app.connector_sources WHERE id = $1', [sourceId])).rows[0];
  const credential = (await c.query('SELECT secret_ciphertext, secret_ref FROM app.connector_credentials WHERE source_id = $1', [sourceId])).rows[0];
  return {source, credential};
}

function jitter(sourceId, maxSeconds = 900) {
  let h = 0;
  for (const ch of String(sourceId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % maxSeconds; // stable per source: 50 clients never hit the same second
}

export function nextCollect(source, now, {found}) {
  const after = String(source.collect_after).slice(0, 5);
  const [h, m] = after.split(':').map(Number);
  const minutes = localMinutes(now, source.collect_tz);
  const windowEnd = h * 60 + m + 6 * 60;
  if (!found && minutes >= h * 60 + m && minutes < windowEnd) return new Date(now.getTime() + 30 * 60000); // batch not ready yet
  return nextLocalTime(now, source.collect_tz, after, jitter(source.id));
}

/** Link: the API queued a pairing token; only the worker holds ERP credentials. */
async function runLink(pool, role, command, transportFactory) {
  const {source, credential} = await withTransaction(pool, {role}, c => loadSource(c, command.source_id));
  const transport = await transportFactory(source, credential);
  const caps = await transport.getCapabilities();
  if (caps.central_source_ref && caps.central_source_ref !== source.id && caps.state === 'linked') throw new Error('La instalación ya está vinculada a otra fuente NOVA');
  const linked = await transport.confirmLink(command.payload.link_token, source.id);
  const fresh = await transport.getCapabilities();
  await withTransaction(pool, {role}, async c => {
    const clash = (await c.query('SELECT id FROM app.connector_sources WHERE installation_uuid = $1 AND source_generation = $2 AND id <> $3',
      [linked.installation_uuid, linked.generation, source.id])).rows[0];
    if (clash) throw new Error('Esa instalación/generación ya pertenece a otra fuente');
    await c.query(`UPDATE app.connector_sources SET installation_uuid = $2, source_generation = $3, status = 'active', link_confirmed_at = now(),
                   capabilities = $4, attribute_map = $5, last_error = NULL, next_collect_at = $6 WHERE id = $1`,
    [source.id, linked.installation_uuid, linked.generation, JSON.stringify(fresh), JSON.stringify(fresh.attribute_map || []),
      nextLocalTime(new Date(), source.collect_tz, String(source.collect_after).slice(0, 5), jitter(source.id))]);
    for (const company of fresh.companies || []) {
      await c.query(`INSERT INTO app.source_companies(tenant_id, source_id, company_id, name, currency, authorized)
                     VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (source_id, company_id) DO UPDATE SET name = EXCLUDED.name, currency = EXCLUDED.currency`,
      [source.tenant_id, source.id, company.id, company.name, company.currency]);
    }
  });
  return {installation_uuid: linked.installation_uuid, generation: linked.generation, companies: (fresh.companies || []).length};
}

export async function processCommands(pool, role, transportFactory, log = () => {}) {
  for (;;) {
    const command = await withTransaction(pool, {role}, async c => (await c.query(
      `UPDATE ops.source_commands SET status = 'running' WHERE id = (SELECT id FROM ops.source_commands WHERE status = 'queued'
        ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows[0]);
    if (!command) return;
    let result; let status = 'done';
    try {
      if (command.command === 'link') result = await runLink(pool, role, command, transportFactory);
      else if (command.command === 'resync') {
        const {source, credential} = await withTransaction(pool, {role}, c => loadSource(c, command.source_id));
        const transport = await transportFactory(source, credential);
        result = await transport.requestResync({installation_uuid: source.installation_uuid, generation: source.source_generation}, command.payload.datasets);
      } else if (command.command === 'test') {
        const {source, credential} = await withTransaction(pool, {role}, c => loadSource(c, command.source_id));
        const caps = await (await transportFactory(source, credential)).getCapabilities(); // never downloads data
        result = {state: caps.state, odoo_version: caps.odoo_version, datasets: (caps.datasets || []).length};
      } else if (command.command === 'collect_now') {
        await withTransaction(pool, {role}, c => c.query('UPDATE app.connector_sources SET next_collect_at = now() WHERE id = $1', [command.source_id]));
        result = {scheduled: true};
      }
    } catch (error) {
      status = 'failed'; result = {error: String(error.message).slice(0, 300)};
      log('warn', 'command_failed', {command: command.command, source: command.source_id, error: error.message});
    }
    await withTransaction(pool, {role}, c => c.query('UPDATE ops.source_commands SET status = $2, result = $3, finished_at = now() WHERE id = $1',
      [command.id, status, JSON.stringify(result || {})]));
  }
}

/** Collect + apply one source under an advisory lock (one job per source). */
export async function processSource(pool, role, sourceId, {config, transportFactory, log = () => {}, now = () => new Date()}) {
  const lockClient = await pool.connect();
  try {
    const locked = (await lockClient.query("SELECT pg_try_advisory_lock(hashtext('nova-source:' || $1)) AS ok", [sourceId])).rows[0].ok;
    if (!locked) return {status: 'busy'};
    let outcome;
    try {
      const {source, credential} = await withTransaction(pool, {role}, c => loadSource(c, sourceId));
      if (!source || source.status !== 'active') return {status: 'skipped'};
      const transport = await transportFactory(source, credential);
      const db = {query: (sql, params) => withTransaction(pool, {role}, c => c.query(sql, params))};
      const collected = await collectSource({db, source, transport, config, log});
      const applied = [];
      for (const runId of await withTransaction(pool, {role}, c => pendingRuns(c, sourceId))) {
        try {
          applied.push(await withTransaction(pool, {role}, c => applyRun(c, runId, {log})));
        } catch (error) {
          // Transformation failure: parts stay stored, last published version stays valid.
          await withTransaction(pool, {role}, c => c.query(`UPDATE ingest.runs SET error = $2, attempts = attempts + 1 WHERE id = $1`,
            [runId, `Aplicación fallida: ${String(error.message).slice(0, 300)}`]));
          log('error', 'apply_failed', {source: sourceId, run: runId, error: error.message});
          break;
        }
      }
      outcome = {status: collected.status, collected: collected.runs.length, applied};
      await withTransaction(pool, {role}, c => c.query(
        `UPDATE app.connector_sources SET last_collect_at = now(), consecutive_failures = 0, next_collect_at = $2,
         last_error = CASE WHEN status = 'relink_required' THEN last_error ELSE NULL END WHERE id = $1`,
        [sourceId, nextCollect(source, now(), {found: collected.runs.length > 0})]));
    } catch (error) {
      log('warn', 'source_failed', {source: sourceId, error: error.message});
      await withTransaction(pool, {role}, c => c.query(
        `UPDATE app.connector_sources SET consecutive_failures = consecutive_failures + 1, last_error = $2,
           next_collect_at = now() + make_interval(mins => least(120, 5 * power(2, least(consecutive_failures, 5))::int)) WHERE id = $1`,
        [sourceId, String(error.message).slice(0, 300)]));
      outcome = {status: 'error', error: error.message};
    }
    return outcome;
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock(hashtext('nova-source:' || $1))", [sourceId]).catch(() => {});
    lockClient.release();
  }
}

export async function dueSources(pool, role) {
  return withTransaction(pool, {role}, async c => (await c.query(
    `SELECT id FROM app.connector_sources WHERE status = 'active' AND (next_collect_at IS NULL OR next_collect_at <= now())
      ORDER BY next_collect_at NULLS FIRST LIMIT 100`)).rows.map(r => r.id));
}

/** One scheduler tick with bounded global concurrency. */
export async function tick(pool, role, opts) {
  await processCommands(pool, role, opts.transportFactory, opts.log);
  const queue = await dueSources(pool, role);
  const results = [];
  const workers = Array.from({length: Math.min(opts.config.workerConcurrency, queue.length)}, async () => {
    while (queue.length) results.push(await processSource(pool, role, queue.shift(), opts));
  });
  await Promise.all(workers);
  return results;
}

export function packageVersion() {
  return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
}
