// Company inputs (budgets, campaigns, business-unit rules) feed the blocks Odoo cannot answer.
// Real PostgreSQL via PGlite; reports are read through the API exactly as the panel does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../server/app.mjs';
import {processRebuildRequests} from '../lib/ingest/rebuild-requests.mjs';
import {call, createWorld, PASSWORD} from './helpers/world.mjs';

let w; let api; let ana; let vera;
const H = (cookie, tenant) => ({cookie, 'x-nova-tenant': tenant, 'x-nova-request': '1'});
const login = async email => (await call(api, 'POST', '/api/auth/login', {headers: {'x-nova-request': '1'}, body: {email, password: PASSWORD}}))
  .headers['set-cookie'].split(';')[0];
const report = async (page, qs = 'anio=2026') => (await call(api, 'GET', `/api/reports/${page}?${qs}`, {headers: H(ana, w.tenantA)})).body.widgets;
const months = Array.from({length: 12}, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);

test.before(async () => {
  w = await createWorld();
  w.transports.juj.setVisible(3);
  await w.ingest('juj');
  api = createHandler({pool: w.pool, config: w.config});
  [ana, vera] = [await login('ana@fixture.test'), await login('vera@fixture.test')];
});
test.after(async () => { await w.pool.end(); });

test('without inputs the blocks say what to load (never an estimate)', async () => {
  const mk = await report('marketing');
  assert.equal(mk['marketing-01'].kind, 'missing');
  assert.match(mk['marketing-01'].reason, /campañas/i);
  assert.equal(mk['marketing-06'].kind, 'kpi', 'recompra comes from sales');
  const c = await report('compras');
  assert.match(c['compras-05'].reason, /presupuesto de compras/i);
  const u = await report('retailjuj');
  assert.match(u['retailjuj-02'].reason, /presupuesto/i);
});

test('budgets: admin only, validated, and used by every attainment block', async () => {
  const denied = await call(api, 'PUT', '/api/inputs/budgets/ventas', {headers: H(vera, w.tenantA), body: {rows: [{month: '2026-01', amount: 1}]}});
  assert.equal(denied.status, 403);
  const bad = await call(api, 'PUT', '/api/inputs/budgets/ventas', {headers: H(ana, w.tenantA), body: {rows: [{month: '2026-13', amount: 1}]}});
  assert.equal(bad.status, 400);
  const sales = [...months.map(m => ({month: m, amount: '100'})), ...months.map(m => ({month: m, unit_name: 'Retail JUJ', amount: '20'}))];
  assert.equal((await call(api, 'PUT', '/api/inputs/budgets/ventas', {headers: H(ana, w.tenantA), body: {rows: sales}})).status, 200);
  assert.equal((await call(api, 'PUT', '/api/inputs/budgets/compras', {headers: H(ana, w.tenantA), body: {rows: months.map(m => ({month: m, amount: 50}))}})).status, 200);
  assert.equal((await call(api, 'PUT', '/api/inputs/budgets/gastos_fijos', {headers: H(ana, w.tenantA), body: {rows: months.map(m => ({month: m, unit_name: 'Retail JUJ', amount: 1}))}})).status, 200);
  const n1 = await report('nivel1');
  assert.equal(n1['nivel1-02'].kind, 'kpi');
  assert.equal(n1['nivel1-02'].metric, 'budget_attainment');
  assert.equal(n1['nivel1-08'].kind, 'table');
  assert.ok(n1['nivel1-08'].rows.some(r => r[0] === 'Retail JUJ'));
  // Unit pages are positions: the fixture's first unit by priority ("Retail JUJ") is the first page.
  const unit = await report('mayoristahogar');
  assert.equal(unit['mayoristahogar-02'].kind, 'metric');
  assert.match(unit['mayoristahogar-02'].note, /presupuestados/);
  assert.notEqual(unit['mayoristahogar-04'].reason || '', 'Sin gastos fijos de la unidad: cárgalos (tipo gastos_fijos) en Configuración → Presupuestos y unidades.');
  const c = await report('compras');
  assert.equal(c['compras-05'].kind, 'kpi');
  const inputs = await call(api, 'GET', '/api/inputs', {headers: H(vera, w.tenantA)});
  assert.equal(inputs.status, 200, 'everyone in the company reads the inputs');
  assert.equal(inputs.body.budgets.filter(b => b.kind === 'ventas').length, 24);
  assert.equal(inputs.body.can_edit, false);
});

test('campaigns feed investment, sales, captured customers and ROI', async () => {
  const bad = await call(api, 'PUT', '/api/inputs/campaigns', {headers: H(ana, w.tenantA), body: {rows: [{name: 'X', start_date: '2026-05-01', end_date: '2026-04-01'}]}});
  assert.equal(bad.status, 400);
  const ok = await call(api, 'PUT', '/api/inputs/campaigns', {headers: H(ana, w.tenantA), body: {rows: [
    {name: 'Lanzamiento', status: 'ejecutada', start_date: '2026-01-01', end_date: '2026-12-31', investment: '10'},
    {name: 'Navidad', status: 'planificada', start_date: '2026-12-01', end_date: '2026-12-24', investment: '5'}]}});
  assert.equal(ok.status, 200);
  const mk = await report('marketing');
  assert.equal(mk['marketing-01'].kind, 'kpi');
  assert.equal(mk['marketing-01'].raw, '10');
  assert.equal(mk['marketing-02'].value, '1');
  assert.equal(mk['marketing-07'].rows.length, 1, 'a campaign outside the period is not counted');
  assert.equal(mk['marketing-13'].kind, 'text');
});

test('unit rules from the panel are recalculated by the worker', async () => {
  const before = await call(api, 'GET', '/api/inputs', {headers: H(ana, w.tenantA)});
  const source = before.body.sources[0].id;
  const rules = before.body.rules.filter(r => r.source_id === source).map(r => ({...r}));
  assert.ok(rules.length >= 2);
  const denied = await call(api, 'PUT', '/api/inputs/units', {headers: H(vera, w.tenantA), body: {rules}});
  assert.equal(denied.status, 403);
  const res = await call(api, 'PUT', '/api/inputs/units', {headers: H(ana, w.tenantA), body: {rules}});
  assert.equal(res.status, 200);
  const pending = await call(api, 'GET', '/api/inputs', {headers: H(ana, w.tenantA)});
  assert.ok(pending.body.sources.some(s => s.rebuild_requested_at));
  const done = await processRebuildRequests(w.pool, 'nova_worker');
  assert.deepEqual(done, [source]);
  const after = await call(api, 'GET', '/api/inputs', {headers: H(ana, w.tenantA)});
  assert.ok(after.body.sources.every(s => !s.rebuild_requested_at));
  const lg = await report('logistica');
  assert.equal(lg['logistica-08'].kind, 'bars');
});

test('purchase budget by brand: attainment bars per budgeted brand', async () => {
  const inputs = await call(api, 'GET', '/api/inputs', {headers: H(ana, w.tenantA)});
  const brand = inputs.body.brands[0];
  assert.ok(brand, 'the fixture has product brands');
  const rows = [...months.map(m => ({month: m, amount: 50})), ...months.map(m => ({month: m, brand, amount: 10}))];
  assert.equal((await call(api, 'PUT', '/api/inputs/budgets/compras', {headers: H(ana, w.tenantA), body: {rows}})).status, 200);
  const c = await report('compras');
  assert.equal(c['compras-05'].kind, 'kpi', 'the total uses the plain rows, not total + brand');
  assert.equal(c['compras-16'].kind, 'bars');
  assert.equal(c['compras-16'].rows[0].n, brand);
});

test('budget builder: base from real sales, saves one year and level only', async () => {
  const g = await call(api, 'GET', '/api/budget/ventas/2027?by=unit', {headers: H(ana, w.tenantA)});
  assert.equal(g.status, 200);
  assert.ok(g.body.base.length > 0, 'the 2026 sales are the base of the 2027 budget');
  assert.ok(g.body.base.every(p => p.month.startsWith('2026-')));
  assert.ok(g.body.units.includes('Retail JUJ'));
  const bad = await call(api, 'PUT', '/api/budget/ventas/2027', {headers: H(ana, w.tenantA), body: {by: 'unit', rows: [{key: 'Retail JUJ', month: '2026-01', amount: 1}]}});
  assert.equal(bad.status, 400, 'a month of another year is rejected');
  const ok = await call(api, 'PUT', '/api/budget/ventas/2027', {headers: H(ana, w.tenantA), body: {by: 'unit', rows: [{key: 'Retail JUJ', month: '2027-03', amount: 99}]}});
  assert.equal(ok.status, 200);
  const all = await call(api, 'GET', '/api/inputs', {headers: H(ana, w.tenantA)});
  const ventas = all.body.budgets.filter(b => b.kind === 'ventas');
  assert.ok(ventas.some(b => b.month === '2027-03' && b.unit_name === 'Retail JUJ'));
  assert.equal(ventas.filter(b => b.month.startsWith('2026-')).length, 24, 'the 2026 budget is untouched');
  const viewer = await call(api, 'PUT', '/api/budget/ventas/2027', {headers: H(vera, w.tenantA), body: {by: 'total', rows: []}});
  assert.equal(viewer.status, 403);
});

test('marketing app integration: token once, push upserts by id, revoke stops it', async () => {
  const t = await call(api, 'POST', '/api/integrations/marketing/tokens', {headers: H(ana, w.tenantA), body: {label: 'Iris'}});
  assert.equal(t.status, 200);
  const token = t.body.token;
  assert.match(token, /^omk_/);
  const push = body => call(api, 'POST', '/api/integrations/marketing/campaigns', {headers: {authorization: `Bearer ${token}`}, body});
  const c1 = {id: 'CMP-1', name: 'Iris A', start_date: '2026-01-01', end_date: '2026-12-31', investment: 7, leads: 30};
  assert.equal((await push({source: 'iris', campaigns: [c1]})).status, 200);
  assert.equal((await push({source: 'iris', campaigns: [{...c1, investment: 8}]})).status, 200);
  const list = await call(api, 'GET', '/api/inputs', {headers: H(ana, w.tenantA)});
  const iris = list.body.campaigns.filter(c => c.source === 'iris');
  assert.equal(iris.length, 1, 'same id = same campaign');
  assert.equal(Number(iris[0].investment), 8);
  assert.equal(iris[0].leads, 30);
  const csvReplace = await call(api, 'PUT', '/api/inputs/campaigns', {headers: H(ana, w.tenantA), body: {rows: []}});
  assert.equal(csvReplace.status, 200);
  const after = await call(api, 'GET', '/api/inputs', {headers: H(ana, w.tenantA)});
  assert.equal(after.body.campaigns.filter(c => c.source === 'iris').length, 1, 'a CSV upload never deletes app campaigns');
  const mk = await report('marketing');
  assert.equal(mk['marketing-01'].raw, '8');
  assert.equal((await call(api, 'POST', '/api/integrations/marketing/campaigns', {headers: {authorization: 'Bearer omk_' + 'x'.repeat(43)}, body: {campaigns: [c1]}})).status, 401);
  const info = await call(api, 'GET', '/api/integrations/marketing', {headers: H(ana, w.tenantA)});
  assert.doesNotMatch(JSON.stringify(info.body), new RegExp(token), 'the token is never returned again');
  assert.equal((await call(api, 'DELETE', `/api/integrations/marketing/tokens/${info.body.tokens[0].id}`, {headers: H(ana, w.tenantA)})).status, 200);
  assert.equal((await push({source: 'iris', campaigns: [c1]})).status, 401);
});

test('cash flow: committed flows and run-rate from the close; scenarios per company', async () => {
  const r = await call(api, 'GET', '/api/cashflow?meses=6', {headers: H(vera, w.tenantA)});
  assert.equal(r.status, 200);
  assert.equal(r.body.months.length, 6);
  assert.ok(r.body.months[0] > r.body.cutoff.slice(0, 7), 'the projection starts after the close month');
  assert.ok(r.body.runRate.sales >= 0 && typeof r.body.committed.overdue === 'number');
  assert.equal(r.body.can_edit, false, 'viewers read but do not save scenarios');
  assert.equal((await call(api, 'PUT', '/api/cashflow/scenarios', {headers: H(vera, w.tenantA), body: {name: 'x', params: {}}})).status, 403);
  const s = await call(api, 'PUT', '/api/cashflow/scenarios', {headers: H(ana, w.tenantA), body: {name: 'Promo diciembre', params: {salesGrowth: 5, promoMonths: [r.body.months[0]]}}});
  assert.equal(s.status, 200);
  const again = await call(api, 'GET', '/api/cashflow', {headers: H(ana, w.tenantA)});
  assert.deepEqual(again.body.scenarios.map(x => x.name), ['Promo diciembre']);
  assert.equal(again.body.scenarios[0].params.salesGrowth, 5);
  assert.equal((await call(api, 'DELETE', `/api/cashflow/scenarios/${s.body.id}`, {headers: H(ana, w.tenantA)})).status, 200);
});
