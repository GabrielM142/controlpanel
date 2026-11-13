import pg from 'pg';
import {loadConfig} from './config.mjs';

// Dates stay as 'YYYY-MM-DD' strings (no local-timezone shift); numeric and
// int8 stay strings (pg default) so money is never converted to float.
pg.types.setTypeParser(1082, v => v);

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
let shared;

export function createPool(config = loadConfig(), overrides = {}) {
  if (!config.databaseUrl) throw new Error('DATABASE_URL no configurada');
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: overrides.max ?? config.poolMax,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: overrides.statementTimeoutMs ?? config.statementTimeoutMs,
    application_name: overrides.applicationName ?? 'nova',
  });
}

/** One bounded pool per process (never one per route/tenant). */
export function getPool() {
  if (!shared) shared = createPool();
  return shared;
}

export function setPool(pool) { shared = pool; }

/**
 * Run fn(client) inside one transaction with a transaction-local tenant/user
 * context and optional SET LOCAL ROLE. The context cannot leak into the next
 * request that reuses the pooled connection.
 */
export async function withTransaction(pool, {role = '', tenantId = null, userId = null, readOnly = false,
  isolation = 'READ COMMITTED', platform = false} = {}, fn) {
  if (role && !IDENT.test(role)) throw new Error('rol inválido');
  if (!['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].includes(isolation)) throw new Error('aislamiento inválido');
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}${readOnly ? ' READ ONLY' : ''}`);
    if (role) await client.query(`SET LOCAL ROLE ${role}`);
    // platform: super admin console only, set by the API after checking app.users.platform_admin.
    await client.query("SELECT set_config('nova.tenant_id', $1, true), set_config('nova.user_id', $2, true), set_config('nova.platform', $3, true)",
      [tenantId || '', userId || '', platform ? 'on' : '']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
