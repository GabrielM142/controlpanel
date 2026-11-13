// Menus that used to be demo-only in live mode: helpdesk, company theme, AI usage, Iris performance
// and the operational threshold values. Real PostgreSQL via PGlite, through the API like the panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../server/app.mjs';
import {withTransaction} from '../lib/db.mjs';
import {thresholdValues} from '../lib/metrics.mjs';
import {call, createWorld, PASSWORD} from './helpers/world.mjs';

let w; let api; let ana; let vera;
const H = (cookie, tenant) => ({cookie, 'x-nova-tenant': tenant, 'x-nova-request': '1'});
const login = async email => (await call(api, 'POST', '/api/auth/login', {headers: {'x-nova-request': '1'}, body: {email, password: PASSWORD}}))
  .headers['set-cookie'].split(';')[0];

test.before(async () => {
  w = await createWorld();
  w.transports.juj.setVisible(3);
  await w.ingest('juj');
  api = createHandler({pool: w.pool, config: w.config});
  [ana, vera] = [await login('ana@fixture.test'), await login('vera@fixture.test')];
});
test.after(async () => { await w.pool.end(); });

test('helpdesk: create, SLA by priority, assign, first response, resolve; isolated per company', async () => {
  const bad = await call(api, 'POST', '/api/tickets', {headers: H(vera, w.tenantA), body: {title: 'x'}});
  assert.equal(bad.status, 400);
  const c = await call(api, 'POST', '/api/tickets', {headers: H(vera, w.tenantA), body: {title: 'Factura duplicada', priority: 'alta', customer: 'Cliente A'}});
  assert.equal(c.status, 200, 'any member opens a ticket');
  const id = c.body.id;
  let list = await call(api, 'GET', '/api/tickets', {headers: H(ana, w.tenantA)});
  const t = list.body.tickets.find(x => x.id === id);
  assert.equal(Math.round((Date.parse(t.due_at) - Date.parse(t.created_at)) / 36e5), 4, 'alta = 4 h');
  assert.equal(list.body.kpis.open, 1);
  assert.equal((await call(api, 'PATCH', `/api/tickets/${id}`, {headers: H(vera, w.tenantA), body: {status: 'resuelto'}})).status, 403, 'viewers do not manage');
  const agent = list.body.agents.find(a => a.role !== 'viewer');
  const pa = await call(api, 'PATCH', `/api/tickets/${id}`, {headers: H(ana, w.tenantA), body: {assignee_id: agent.id, priority: 'media'}});
  assert.equal(pa.status, 200, JSON.stringify(pa.body) + JSON.stringify(list.body.agents));
  assert.equal((await call(api, 'POST', `/api/tickets/${id}/comments`, {headers: H(ana, w.tenantA), body: {body: 'Ya lo revisamos'}})).status, 200);
  assert.equal((await call(api, 'PATCH', `/api/tickets/${id}`, {headers: H(ana, w.tenantA), body: {status: 'resuelto'}})).status, 200);
  const d = await call(api, 'GET', `/api/tickets/${id}`, {headers: H(vera, w.tenantA)});
  assert.equal(d.body.ticket.priority, 'media');
  assert.ok(d.body.ticket.first_response_at && d.body.ticket.resolved_at);
  assert.equal(d.body.comments.length, 1);
  list = await call(api, 'GET', '/api/tickets', {headers: H(ana, w.tenantA)});
  assert.equal(list.body.kpis.sla_pct, 100);
  const other = await call(api, 'GET', `/api/tickets/${id}`, {headers: H(ana, w.tenantB)});
  assert.notEqual(other.status, 200, 'another company never sees it');
  const values = await withTransaction(w.pool, {role: 'nova_api', tenantId: w.tenantA, readOnly: true}, c2 => thresholdValues(c2, '2026-03-31'));
  assert.equal(values['sop-vencidos'], 0);
  assert.equal(values['sop-sla-cumpl'], 100);
});

test('company theme is shared and only admins change it', async () => {
  assert.equal((await call(api, 'PUT', '/api/tenant/theme', {headers: H(vera, w.tenantA), body: {brand_color: '#123456'}})).status, 403);
  assert.equal((await call(api, 'PUT', '/api/tenant/theme', {headers: H(ana, w.tenantA), body: {brand_color: 'rojo'}})).status, 400);
  assert.equal((await call(api, 'PUT', '/api/tenant/theme', {headers: H(ana, w.tenantA), body: {brand_color: '#2A6FDB', logo: '<svg onload=x>'}})).status, 400);
  assert.equal((await call(api, 'PUT', '/api/tenant/theme', {headers: H(ana, w.tenantA), body: {brand_color: '#2A6FDB'}})).status, 200);
  const seen = await call(api, 'GET', '/api/tenant/theme', {headers: H(vera, w.tenantA)});
  assert.equal(seen.body.brand_color, '#2a6fdb');
  assert.equal(seen.body.can_edit, false);
});

test('AI usage endpoint and marketing performance by source', async () => {
  const u = await call(api, 'GET', '/api/ai/usage', {headers: H(vera, w.tenantA)});
  assert.equal(u.status, 200);
  assert.equal(u.body.hourly_limit, 60);
  const t = await call(api, 'POST', '/api/integrations/marketing/tokens', {headers: H(ana, w.tenantA), body: {label: 'Iris'}});
  const push = await call(api, 'POST', '/api/integrations/marketing/campaigns', {headers: {authorization: `Bearer ${t.body.token}`},
    body: {source: 'iris', campaigns: [{id: 'A1', name: 'Iris A', start_date: '2026-01-01', end_date: '2026-03-31', investment: 100, leads: 50}]}});
  assert.equal(push.status, 200);
  const p = await call(api, 'GET', '/api/marketing/performance?fuente=iris&desde=2026-01-01', {headers: H(vera, w.tenantA)});
  assert.equal(p.status, 200);
  assert.equal(p.body.campaigns.length, 1);
  assert.equal(p.body.campaigns[0].cpl, 2);
  assert.ok(p.body.sources.some(s => s.source === 'iris'));
});
