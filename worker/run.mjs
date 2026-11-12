// NOVA worker: separate process from the web API. Polls ready Odoo batches
// (never extracts on behalf of a dashboard visitor), applies and publishes.
//   npm run worker            (loop)
//   node worker/run.mjs --once
import {loadConfig} from '../lib/config.mjs';
import {createPool, withTransaction} from '../lib/db.mjs';
import {defaultTransportFactory, packageVersion, syncRegistry, tick} from '../lib/ingest/worker.mjs';

const config = loadConfig();
if (!config.databaseUrl) throw new Error('Configure DATABASE_URL');
if (!config.secretKey) throw new Error('Configure NOVA_SECRET_KEY (32 bytes base64) para descifrar credenciales');
const role = process.env.NOVA_DB_ROLE === undefined ? 'nova_worker' : config.dbRole;
const pool = createPool(config, {max: config.workerConcurrency + 2, statementTimeoutMs: 10 * 60 * 1000, applicationName: 'nova-worker'});
const log = (level, event, data = {}) => console.log(JSON.stringify({ts: new Date().toISOString(), level, event, ...data}));

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

await syncRegistry(pool, role);
// Crash recovery: interrupted downloads become retryable (stored parts are reused).
await withTransaction(pool, {role}, c => c.query(`UPDATE ingest.runs SET state = 'failed', error = 'Worker interrumpido; se reintentará'
                                                  WHERE state = 'downloading'`));
log('info', 'worker_started', {version: packageVersion(), concurrency: config.workerConcurrency});
const opts = {config, transportFactory: defaultTransportFactory(config), log};
do {
  try {
    const results = await tick(pool, role, opts);
    if (results.length) log('info', 'tick', {sources: results.length});
  } catch (error) {
    log('error', 'tick_failed', {error: error.message});
  }
  if (process.argv.includes('--once')) break;
  for (let i = 0; i < config.workerPollSeconds && !stopping; i++) await new Promise(r => setTimeout(r, 1000));
} while (!stopping);
await pool.end();
log('info', 'worker_stopped');
