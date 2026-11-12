// Vercel function for the NOVA API: delegates to the router in server/app.mjs.
// Same origin as the panel (no CORS). The database comes from the Vercel
// Postgres (Neon) integration, connected with the OMEGA_ prefix
// (OMEGA_DATABASE_URL = pooled). The legacy DATABASE_URL of the old
// prototype is deliberately ignored here.
import {loadConfig} from '../lib/config.mjs';
import {createHandler} from '../server/app.mjs';

let handler;
export default async function entry(req, res) {
  if (!handler) {
    const config = loadConfig({...process.env, DATABASE_URL: process.env.OMEGA_DATABASE_URL || ''});
    if (process.env.NOVA_DB_ROLE === undefined) config.dbRole = 'nova_api';
    const pool = config.databaseUrl ? (await import('../lib/db.mjs')).createPool(config, {applicationName: 'nova-api'}) : null;
    handler = createHandler({pool, config});
  }
  return handler(req, res);
}

/** Test helper: rebuild the handler after changing environment variables. */
export function resetHandler() { handler = undefined; }
