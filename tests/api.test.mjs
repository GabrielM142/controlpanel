// API + security on real PostgreSQL (PGlite) with the nova_api role and RLS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decryptSecret, encryptSecret, hashPassword, resolveSecret, verifyPassword} from '../lib/crypto.mjs';
import {assertAllowedSourceUrl} from '../lib/net-guard.mjs';
import {withTransaction} from '../lib/db.mjs';
import {ContractError, validateManifest} from '../lib/contracts.mjs';
import {toCsv} from '../server/http.mjs';
import {createHandler} from '../server/app.mjs';
import {call, createWorld, PASSWORD, SECRET_KEY} from './helpers/world.mjs';

let w; let api; let cookieA; let cookieB; let cookieViewer;
const H = (cookie, tenant, extra = {}) => ({cookie, 'x-nova-tenant': tenant, 'x-nova-request': '1', ...extra});

async function login(email) {
  const r = await call(api, 'POST', '/api/auth/login', {headers: {'x-nova-request': '1'}, body: {email, password: PASSWORD}});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.headers['set-cookie'], /HttpOnly/);
  return r.headers['set-cookie'].split(';')[0];
}

test.before(async () => {
  w = await createWorld();
  w.transports.juj.setVisible(3);
  await w.ingest('juj');
  await w.ingest('beta');
  api = createHandler({pool: w.pool, config: w.config});
  cookieA = await login('ana@fixture.test');
  cookieB = await login('beto@fixture.test');
  cookieViewer = await login('vera@fixture.test');
});
test.after(async () => { await w.pool.end(); });

test('health endpoints expose no inventory or credentials', async () => {
  const live = await call(api, 'GET', '/health/live');
  const ready = await call(api, 'GET', '/health/ready');
  assert.deepEqual([live.status, live.body, ready.status, ready.body], [200, {ok: true}, 200, {ok: true}]);
});

test('login rejects bad password; session lists only own memberships', async () => {
  const bad = await call(api, 'POST', '/api/auth/login', {headers: {'x-nova-request': '1'}, body: {email: 'ana@fixture.test', password: 'nope-nope-nope'}});
  assert.equal(bad.status, 401);
  const csrf = await call(api, 'POST', '/api/auth/login', {body: {email: 'ana@fixture.test', password: PASSWORD}});
  assert.equal(csrf.status, 403, 'mutations require the custom anti-CSRF header');
  const s = await call(api, 'GET', '/api/session', {headers: {cookie: cookieA}});
  assert.deepEqual(s.body.memberships.map(m => m.tenant_id), [w.tenantA]);
});

test('report values come from NOVA marts and change with filters', async () => {
  const nov = await call(api, 'GET', '/api/reports/comercial?anio=2026&mes=Noviembre', {headers: H(cookieA, w.tenantA)});
  assert.equal(nov.status, 200);
  assert.equal(nov.body.widgets['comercial-01'].raw, '370.00');
  assert.equal(nov.body.widgets['comercial-04'].raw, '2', 'distinct customers, not summed counts');
  assert.equal(nov.body.widgets['comercial-02'].kind, 'missing', 'no budget => explicit missing, never demo numbers');
  assert.equal(nov.body.published.consistency, 'captured_interval');
  const retail = await call(api, 'GET', '/api/reports/comercial?anio=2026&mes=Noviembre&unidad=Retail%20JUJ', {headers: H(cookieA, w.tenantA)});
  assert.equal(retail.body.widgets['comercial-01'].raw, '45.00');
  // Unit pages are positions filled with the company's units by rule priority: the fixture's
  // "Retail JUJ" (priority 10) is the first unit, so the first unit page shows it.
  const unitPage = await call(api, 'GET', '/api/reports/mayoristahogar?anio=2026', {headers: H(cookieA, w.tenantA)});
  assert.equal(unitPage.body.widgets['mayoristahogar-01'].raw, '45.00', 'unit page forces its own unit');
  const units = await call(api, 'GET', '/api/units', {headers: H(cookieA, w.tenantA)});
  assert.deepEqual(units.body.pages.map(x => x.name), ['Retail JUJ', 'Mayorista Hogar', null, null]);
  const empty = await call(api, 'GET', '/api/reports/retailintorno?anio=2026', {headers: H(cookieA, w.tenantA)});
  assert.equal(empty.body.widgets?.['retailintorno-01']?.kind, 'missing', JSON.stringify(empty.body).slice(0, 300));
  const ytd = await call(api, 'GET', '/api/reports/nivel1?anio=2026&mes=Todos', {headers: H(cookieA, w.tenantA)});
  assert.equal(ytd.body.widgets['nivel1-01'].raw, '500.00', 'YTD = January 130 + November 370');
  const all = Object.keys(ytd.body.widgets);
  assert.equal(all.length, 13, 'every catalog block answered (value or explicit missing)');
  const inv = await call(api, 'GET', '/api/reports/inventarios', {headers: H(cookieA, w.tenantA)});
  assert.equal(Number(inv.body.widgets['inventarios-01'].raw), 1200);
});

test('cross-tenant access is rejected: header tampering, MCP and direct RLS', async () => {
  const forged = await call(api, 'GET', '/api/reports/comercial', {headers: H(cookieA, w.tenantB)});
  assert.equal(forged.status, 403);
  const noSession = await call(api, 'GET', '/api/status', {headers: {'x-nova-tenant': w.tenantA}});
  assert.equal(noSession.status, 401);
  const b = await call(api, 'GET', '/api/reports/comercial?anio=2026&mes=Noviembre', {headers: H(cookieB, w.tenantB)});
  assert.equal(b.body.widgets['comercial-01'].raw, '999.00', 'tenant B only sees B');
  const sources = await call(api, 'GET', '/api/sources', {headers: H(cookieB, w.tenantB)});
  assert.deepEqual(sources.body.sources.map(s => s.name), ['beta']);
  const foreignRuns = await call(api, 'POST', `/api/sources/${w.sources.juj}/resync`, {headers: H(cookieB, w.tenantB), body: {datasets: ['res_partner']}});
  assert.equal(foreignRuns.status, 404, 'RLS hides other tenant sources even with a valid id');
  const mcp = await call(api, 'POST', '/mcp', {headers: {cookie: cookieB}, body: {jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: {name: 'get_dashboard', arguments: {tenant_id: w.tenantA, page: 'comercial'}}}});
  assert.equal(mcp.body.result.isError, true);
  // Direct database check with the API role: tenant context is transaction-local.
  const rows = await withTransaction(w.pool, {role: 'nova_api', tenantId: w.tenantA}, c => c.query('SELECT DISTINCT tenant_id FROM mart.sales_day'));
  assert.deepEqual(rows.rows.map(r => r.tenant_id), [w.tenantA]);
  const none = await withTransaction(w.pool, {role: 'nova_api'}, c => c.query('SELECT count(*)::int AS n FROM core.fact_sales_line'));
  assert.equal(none.rows[0].n, 0, 'no tenant context => no rows (fails closed)');
  await assert.rejects(withTransaction(w.pool, {role: 'nova_api', tenantId: w.tenantA}, c => c.query('SELECT secret_ciphertext FROM app.connector_credentials')),
    /permission denied/, 'the API role can never read ERP secrets');
  await assert.rejects(withTransaction(w.pool, {role: 'nova_api', tenantId: w.tenantA}, c => c.query(
    `INSERT INTO app.tasks(tenant_id, owner_id, title) VALUES ($1, $2, 'x')`, [w.tenantB, w.userA])), /row-level security/);
});

test('company grants restrict a member to authorized companies', async () => {
  await w.q('INSERT INTO app.membership_companies(tenant_id, user_id, source_id, company_id) VALUES ($1, $2, $3, 2)', [w.tenantA, w.viewerA, w.sources.juj]);
  const r = await call(api, 'GET', '/api/reports/comercial?anio=2026&mes=Noviembre', {headers: H(cookieViewer, w.tenantA)});
  assert.equal(r.body.widgets['comercial-01'].raw, '45.00', 'only company 2');
  const admin = await call(api, 'GET', '/api/sources', {headers: H(cookieViewer, w.tenantA)});
  assert.equal(admin.status, 403, 'viewer cannot administer sources');
});

test('status shows business date, capture interval and source state', async () => {
  const s = await call(api, 'GET', '/api/status', {headers: H(cookieA, w.tenantA)});
  assert.equal(s.body.published.business_date, '2026-11-11');
  const src = s.body.published.sources[w.sources.juj];
  assert.ok(src.observed_from && src.observed_to);
  assert.equal(s.body.sources[0].last_run.state, 'published');
});

test('legacy refresh no longer triggers ERP extraction', async () => {
  const r = await call(api, 'POST', '/api/refresh', {headers: H(cookieA, w.tenantA)});
  assert.equal(r.status, 410);
});

test('source registration: SSRF guard, encrypted key, link queued for the worker', async () => {
  const bad = await call(api, 'POST', '/api/sources', {headers: H(cookieA, w.tenantA),
    body: {name: 'x', base_url: 'https://169.254.169.254', db_name: 'd', login: 'l', api_key: 'k'}});
  assert.equal(bad.status, 400);
  const http = await call(api, 'POST', '/api/sources', {headers: H(cookieA, w.tenantA),
    body: {name: 'x', base_url: 'http://93.184.216.34', db_name: 'd', login: 'l', api_key: 'k'}});
  assert.equal(http.status, 400, 'HTTPS required');
  const ok = await call(api, 'POST', '/api/sources', {headers: H(cookieA, w.tenantA),
    body: {name: 'Nueva', base_url: 'https://93.184.216.34', db_name: 'd', login: 'nova', api_key: 'secret-key-123'}});
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const cred = await w.one('SELECT secret_ciphertext FROM app.connector_credentials WHERE source_id = $1', [ok.body.id]);
  assert.ok(!cred.secret_ciphertext.includes('secret-key-123'));
  assert.equal(decryptSecret(cred.secret_ciphertext, SECRET_KEY), 'secret-key-123');
  const link = await call(api, 'POST', `/api/sources/${ok.body.id}/link`, {headers: H(cookieA, w.tenantA), body: {link_token: 'abc'}});
  assert.equal(link.status, 202);
  const cmd = await call(api, 'GET', `/api/commands/${link.body.command_id}`, {headers: H(cookieA, w.tenantA)});
  assert.equal(cmd.body.command, 'link');
});

test('Factory: versioned terms required, idempotent, body limit enforced while reading', async () => {
  const body = {client_name: 'JUJ', title: 'Módulo', process: 'p', actors: 'a', data_sources: 'd', integrations: 'i', outputs: 'o',
    terms_accepted: true, terms_version: '2026-11', terms_sha256: 'a'.repeat(64)};
  const noKey = await call(api, 'POST', '/api/factory/requests', {headers: H(cookieA, w.tenantA), body});
  assert.equal(noKey.status, 400);
  const noTerms = await call(api, 'POST', '/api/factory/requests', {headers: H(cookieA, w.tenantA, {'idempotency-key': 'k1'}), body: {...body, terms_accepted: false}});
  assert.equal(noTerms.status, 400);
  const wrongTerms = await call(api, 'POST', '/api/factory/requests', {headers: H(cookieA, w.tenantA, {'idempotency-key': 'k1'}), body: {...body, terms_sha256: 'b'.repeat(64)}});
  assert.equal(wrongTerms.status, 400);
  const first = await call(api, 'POST', '/api/factory/requests', {headers: H(cookieA, w.tenantA, {'idempotency-key': 'k1'}), body});
  const second = await call(api, 'POST', '/api/factory/requests', {headers: H(cookieA, w.tenantA, {'idempotency-key': 'k1'}), body});
  assert.equal(first.status, 201);
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.idempotent_replay, true);
  const big = await call(api, 'POST', '/api/factory/requests', {headers: H(cookieA, w.tenantA, {'idempotency-key': 'k2'}), body: {...body, process: 'x'.repeat(40000)}});
  assert.equal(big.status, 413);
  const listB = await call(api, 'GET', '/api/factory/requests', {headers: H(cookieB, w.tenantB)});
  assert.equal(listB.body.requests.length, 0, 'tenant B never sees A requests');
});

test('tasks are per tenant and user with audit', async () => {
  const t = await call(api, 'POST', '/api/tasks', {headers: H(cookieA, w.tenantA), body: {title: 'Revisar cartera', priority: 'alta'}});
  assert.equal(t.status, 201);
  const cancel = await call(api, 'PATCH', `/api/tasks/${t.body.id}`, {headers: H(cookieA, w.tenantA), body: {status: 'cancelled'}});
  assert.equal(cancel.body.status, 'cancelled');
  const other = await call(api, 'PATCH', `/api/tasks/${t.body.id}`, {headers: H(cookieB, w.tenantB), body: {status: 'done'}});
  assert.equal(other.status, 404);
  const audit = await w.one(`SELECT count(*)::int AS n FROM ops.audit_log WHERE action LIKE 'task.%'`);
  assert.equal(audit.n, 2);
});

test('CSV export keeps filters/version and neutralizes formulas', async () => {
  const r = await call(api, 'GET', '/api/reports/comercial/export.csv?anio=2026&mes=Noviembre', {headers: H(cookieA, w.tenantA)});
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/csv/);
  assert.match(r.raw, /Versión publicada,\d+/);
  assert.match(r.raw, /comercial-01/);
  assert.equal(toCsv([['=HYPERLINK("x")', '-12.5', '+cmd']]), `"'=HYPERLINK(""x"")",-12.5,'+cmd\r\n`);
});

test('MCP: tools listed; dashboard with same cut and filters as UI', async () => {
  const list = await call(api, 'POST', '/mcp', {headers: {cookie: cookieA}, body: {jsonrpc: '2.0', id: 1, method: 'tools/list'}});
  assert.ok(list.body.result.tools.some(t => t.name === 'get_dashboard'));
  const dash = await call(api, 'POST', '/mcp', {headers: {cookie: cookieA}, body: {jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: {name: 'get_dashboard', arguments: {tenant_id: w.tenantA, page: 'comercial', filters: {anio: '2026', mes: 'Noviembre'}}}}});
  assert.equal(dash.body.result.structuredContent.widgets['comercial-01'].raw, '370.00');
  const anon = await call(api, 'POST', '/mcp', {body: {jsonrpc: '2.0', id: 3, method: 'tools/list'}});
  assert.equal(anon.status, 401);
});

test('crypto, secret references and password hashing', async () => {
  const c = encryptSecret('k', SECRET_KEY);
  assert.notEqual(encryptSecret('k', SECRET_KEY), c, 'random IV');
  // Tamper the first character of the auth tag: always 6 significant bits (the last character of a
  // base64url field may only carry padding bits, which made this assertion fail at random).
  const parts = c.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  assert.throws(() => decryptSecret(parts.join('.'), SECRET_KEY));
  assert.equal(resolveSecret({secret_ref: 'env:NOVA_TEST_KEY'}, SECRET_KEY, {NOVA_TEST_KEY: 'x'}), 'x');
  assert.throws(() => resolveSecret({secret_ref: 'file:/etc/passwd'}, SECRET_KEY));
  const h = await hashPassword('a-long-password!');
  assert.equal(await verifyPassword('a-long-password!', h), true);
  assert.equal(await verifyPassword('wrong-password!!', h), false);
});

test('SSRF guard blocks private, metadata, credentials and redirects to internal names', async () => {
  const resolve = async host => [{address: host === 'evil.example' ? '10.0.0.5' : '93.184.216.34'}];
  for (const u of ['https://127.0.0.1', 'https://[::1]', 'https://169.254.169.254', 'https://user:pw@odoo.example', 'https://localhost',
    'https://evil.example', 'http://odoo.example', 'https://odoo.example/?x=1']) {
    await assert.rejects(assertAllowedSourceUrl(u, {resolve}), Error, u);
  }
  assert.ok(await assertAllowedSourceUrl('https://odoo.example', {resolve}));
  assert.ok(await assertAllowedSourceUrl('https://odoo.local', {allowlist: ['odoo.local'], resolve}));
});

test('contract: incompatible dataset version and undeclared datasets are rejected', () => {
  const base = {schema: 'nova.export.v1', run_uuid: '1b0e5a2a-0d0b-4bf0-9e1c-000000000999', run_seq: 1,
    source: {installation_uuid: '6f1c1b6e-8d55-4a4b-a8f8-0b7f3c9c2a01', generation: 1, odoo_version: '16.0', connector_version: '16.0.1.0.0'},
    business_date: '2026-11-10', timezone: 'America/Guayaquil', requested_cutoff_at: '2026-11-11T05:00:00Z',
    observed_from: '2026-11-11T05:00:00Z', observed_to: '2026-11-11T05:01:00Z', consistency: 'captured_interval', companies: [1],
    datasets: [{key: 'res_partner', version: 2, mode: 'delta', records: 0, parts: [], events: 0, backfill_complete: true, resync_epoch: 1,
      missing_optional_fields: [], complete: true}], parts: [], totals: {parts: 0, records: 0, bytes: 0}, reconciliation: [], warnings: []};
  assert.throws(() => validateManifest(base), ContractError);
  assert.throws(() => validateManifest({...base, datasets: [{...base.datasets[0], key: 'helpdesk_ticket', version: 1}]}), /desconocido/);
  assert.ok(validateManifest({...base, datasets: [{...base.datasets[0], version: 1}]}));
});
