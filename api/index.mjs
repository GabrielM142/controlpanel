// Serverless-style entry kept for compatibility: delegates to the NOVA API
// router (server/app.mjs). The production API runs as `npm run api` behind TLS;
// Vercel only serves the frontend (see .vercelignore / docs/DEPLOY.md).
import {loadConfig} from '../lib/config.mjs';
import {createHandler} from '../server/app.mjs';

let handler;
export default async function entry(req, res) {
  if (!handler) {
    const config = loadConfig();
    if (process.env.NOVA_DB_ROLE === undefined) config.dbRole = 'nova_api';
    const pool = config.databaseUrl ? (await import('../lib/db.mjs')).getPool() : null;
    handler = createHandler({pool, config});
  }
  return handler(req, res);
}

/** Test helper: rebuild the handler after changing environment variables. */
export function resetHandler() { handler = undefined; }
