import {Readable} from 'node:stream';
import {encryptSecret, hashPassword} from '../../lib/crypto.mjs';
import {loadConfig} from '../../lib/config.mjs';
import {createFixtureTransport} from '../../lib/ingest/fixture-transport.mjs';
import {processSource, syncRegistry} from '../../lib/ingest/worker.mjs';
import {migrate} from '../../sql/migrate.mjs';
import {createTestPool} from './pglite-pool.mjs';

export const SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
export const PASSWORD = 'fixture-password-123';

export function testConfig(extra = {}) {
  return {...loadConfig({APP_MODE: 'live'}), mode: 'live', secretKey: SECRET_KEY, cookieSecure: false, dbRole: 'nova_api', ...extra};
}

/** Two tenants (FIXTURE data): A = JUJ-like with 2 companies, B = Beta. Same Odoo ids on purpose. */
export async function createWorld() {
  const pool = await createTestPool();
  await migrate(pool);
  await syncRegistry(pool, 'nova_worker');
  const q = (sql, params) => pool.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows[0];
  const tenantA = (await one(`INSERT INTO app.tenants(slug, name) VALUES ('fixture-juj', 'JUJ (fixture)') RETURNING id`)).id;
  const tenantB = (await one(`INSERT INTO app.tenants(slug, name) VALUES ('fixture-beta', 'Beta (fixture)') RETURNING id`)).id;
  const hash = await hashPassword(PASSWORD);
  const userA = (await one(`INSERT INTO app.users(email, name, password_hash) VALUES ('ana@fixture.test', 'Ana', $1) RETURNING id`, [hash])).id;
  const userB = (await one(`INSERT INTO app.users(email, name, password_hash) VALUES ('beto@fixture.test', 'Beto', $1) RETURNING id`, [hash])).id;
  const viewerA = (await one(`INSERT INTO app.users(email, name, password_hash) VALUES ('vera@fixture.test', 'Vera', $1) RETURNING id`, [hash])).id;
  await q(`INSERT INTO app.memberships(tenant_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner'), ($1, $5, 'viewer')`,
    [tenantA, userA, tenantB, userB, viewerA]);
  const transports = {juj: createFixtureTransport('juj', {visibleRuns: 1}), beta: createFixtureTransport('beta')};
  const sources = {};
  for (const [name, tenant] of [['juj', tenantA], ['beta', tenantB]]) {
    const caps = transports[name].caps;
    sources[name] = (await one(`INSERT INTO app.connector_sources(tenant_id, name, base_url, db_name, login, status, installation_uuid, source_generation)
                                VALUES ($1, $2, 'https://odoo.fixture.test', 'db', 'nova.integracion', 'active', $3, 1) RETURNING id`,
    [tenant, name, caps.installation_uuid])).id;
    await q('INSERT INTO app.connector_credentials(source_id, tenant_id, secret_ciphertext) VALUES ($1, $2, $3)',
      [sources[name], tenant, encryptSecret('fixture-api-key', SECRET_KEY)]);
    for (const c of caps.companies) {
      await q('INSERT INTO app.source_companies(tenant_id, source_id, company_id, name, currency) VALUES ($1, $2, $3, $4, $5)',
        [tenant, sources[name], c.id, c.name, c.currency]);
    }
  }
  await q(`INSERT INTO app.business_unit_rules(tenant_id, source_id, match_type, match_value, unit_code, unit_name, channel, priority) VALUES
    ($1, $2, 'company', '1', 'MH', 'Mayorista Hogar', 'Mayorista', 100),
    ($1, $2, 'company', '2', 'RJ', 'Retail JUJ', 'Retail', 100),
    ($1, $2, 'pos_config', '700', 'RJ', 'Retail JUJ', 'Retail', 10),
    ($3, $4, 'company', '1', 'BX', 'Beta Única', 'Mayorista', 100)`, [tenantA, sources.juj, tenantB, sources.beta]);
  await q(`INSERT INTO app.terms_versions(version, sha256) VALUES ('2026-11', $1)`, ['a'.repeat(64)]);
  const config = testConfig();
  const ingest = (name, opts = {}) => processSource(pool, 'nova_worker', sources[name], {
    config: {...config, ...opts.config}, transportFactory: async () => opts.transport || transports[name], now: () => new Date('2026-11-11T08:00:00Z')});
  return {pool, q, one, tenantA, tenantB, userA, userB, viewerA, sources, transports, config, ingest};
}

export async function salesBy(world, sourceName, where = 'true', params = []) {
  const r = await world.one(`SELECT coalesce(sum(net_amount), 0)::text AS net FROM mart.sales_day WHERE source_id = $1 AND ${where}`,
    [world.sources[sourceName], ...params]);
  return r.net;
}

export function request(method, url, {headers = {}, body} = {}) {
  const payload = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const req = Readable.from(payload);
  req.method = method;
  req.url = url;
  req.headers = {...(body !== undefined ? {'content-type': 'application/json'} : {}), ...headers};
  return req;
}

export async function call(handler, method, url, opts) {
  const res = {statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.raw = b; }};
  await handler(request(method, url, opts), res);
  let json = null;
  try { json = JSON.parse(res.raw); } catch {}
  return {status: res.statusCode, headers: res.headers, body: json, raw: res.raw};
}
