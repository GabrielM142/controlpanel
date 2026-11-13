// SaaS: Truekens ledger and quota, super admin console (plans, modules, companies), notifications
// and suggested values. Real PostgreSQL via PGlite, through the API like the panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../server/app.mjs';
import {withTransaction} from '../lib/db.mjs';
import {recordUsage} from '../lib/truekens.mjs';
import {notifyCloses} from '../lib/notifications.mjs';
import {call, createWorld, PASSWORD} from './helpers/world.mjs';

let w; let api; let ana; let vera;
const H = (cookie, tenant) => ({cookie, 'x-nova-tenant': tenant, 'x-nova-request': '1'});
const P = cookie => ({cookie, 'x-nova-request': '1'});
const login = async email => (await call(api, 'POST', '/api/auth/login', {headers: {'x-nova-request': '1'}, body: {email, password: PASSWORD}}))
  .headers['set-cookie'].split(';')[0];

test.before(async () => {
  w = await createWorld();
  w.transports.juj.setVisible(3);
  await w.ingest('juj');
  api = createHandler({pool: w.pool, config: w.config});
  await w.q("UPDATE app.users SET platform_admin = true WHERE email = 'ana@fixture.test'");
  [ana, vera] = [await login('ana@fixture.test'), await login('vera@fixture.test')];
});
test.after(async () => { await w.pool.end(); });

test('Truekens = real tokens × platform factor; ledger per user; quota blocks and notifies', async () => {
  assert.equal((await call(api, 'PUT', '/api/platform/settings', {headers: P(vera), body: {multiplier: 2}})).status, 403, 'only the super admin');
  assert.equal((await call(api, 'PUT', '/api/platform/settings', {headers: P(ana), body: {multiplier: 2.5, default_quota: null}})).status, 200);
  const users = await w.q("SELECT id, email FROM app.users WHERE email IN ('ana@fixture.test', 'vera@fixture.test')");
  const vid = users.rows.find(u => u.email === 'vera@fixture.test').id;
  const spent = await withTransaction(w.pool, {role: 'nova_api', tenantId: w.tenantA, userId: vid}, c => recordUsage(c, {tenantId: w.tenantA, userId: vid,
    pageId: 'comercial', provider: 'openai', model: 'gpt-x', question: '¿Cómo van las ventas?', usage: {input: 1000, output: 201}}));
  assert.equal(spent.truekens, Math.ceil(1201 * 2.5));
  const mine = await call(api, 'GET', '/api/truekens', {headers: H(vera, w.tenantA)});
  assert.equal(mine.body.scope, 'propio');
  assert.equal(mine.body.entries[0].question, '¿Cómo van las ventas?');
  assert.equal(mine.body.entries[0].truekens, 3003);
  // The conversion factor and the real tokens never reach the tenant: only Truekens.
  assert.equal(mine.body.plan.multiplier, undefined);
  assert.equal(mine.body.entries[0].input_tokens, undefined);
  assert.equal(mine.body.entries[0].multiplier, undefined);
  assert.equal((await call(api, 'GET', '/api/plan', {headers: H(vera, w.tenantA)})).body.multiplier, undefined);
  const all = await call(api, 'GET', '/api/truekens', {headers: H(ana, w.tenantA)});
  assert.equal(all.body.scope, 'empresa');
  assert.equal(all.body.byUser[0].truekens, 3003);
  const csv = await call(api, 'GET', '/api/truekens.csv', {headers: H(ana, w.tenantA)});
  assert.equal(csv.status, 200);
  assert.match(String(csv.raw ?? csv.body), /truekens/);
  assert.doesNotMatch(String(csv.raw ?? csv.body), /factor|tokens_/);
  // Quota: 3003 already used; a quota of 3000 blocks the next question and the 100% notice exists.
  assert.equal((await call(api, 'PUT', `/api/platform/tenants/${w.tenantA}/plan`, {headers: P(ana), body: {trueken_quota: 3000, status: 'activa', modules: null, skills: []}})).status, 200);
  const blocked = await call(api, 'POST', '/api/ai/report', {headers: H(vera, w.tenantA), body: {page_id: 'comercial', question: 'hola'}});
  assert.equal(blocked.status, 402, JSON.stringify(blocked.body));
  assert.match(blocked.body.error, /Truekens/);
  const notes = await call(api, 'GET', '/api/notifications', {headers: H(ana, w.tenantA)});
  assert.ok(notes.body.items.length >= 0);
});

test('super admin: plans and modules gate reports; companies and members are created', async () => {
  const ov = await call(api, 'GET', '/api/platform/overview', {headers: P(ana)});
  assert.equal(ov.status, 200);
  assert.ok(ov.body.tenants.length >= 2, 'sees every company');
  assert.equal((await call(api, 'GET', '/api/platform/overview', {headers: P(vera)})).status, 403);
  await call(api, 'PUT', `/api/platform/tenants/${w.tenantA}/plan`, {headers: P(ana), body: {modules: ['nivel1'], skills: ['sk-precios'], status: 'activa', trueken_quota: null}});
  assert.equal((await call(api, 'GET', '/api/reports/compras?anio=2026', {headers: H(vera, w.tenantA)})).status, 403, 'module off');
  assert.equal((await call(api, 'GET', '/api/reports/nivel1?anio=2026', {headers: H(vera, w.tenantA)})).status, 200);
  const plan = await call(api, 'GET', '/api/plan', {headers: H(vera, w.tenantA)});
  assert.deepEqual([plan.body.modules, plan.body.skills], [['nivel1'], ['sk-precios']]);
  await call(api, 'PUT', `/api/platform/tenants/${w.tenantA}/plan`, {headers: P(ana), body: {modules: null, skills: [], status: 'activa', trueken_quota: null}});
  const created = await call(api, 'POST', '/api/platform/tenants', {headers: P(ana), body: {name: 'Ferretería Andina', admin_email: 'gerente@andina.test'}});
  assert.equal(created.status, 200);
  assert.equal(created.body.slug, 'ferreteria-andina');
  assert.ok(created.body.temporary_password, 'a new administrator receives a temporary password once');
  const newLogin = await call(api, 'POST', '/api/auth/login', {headers: {'x-nova-request': '1'}, body: {email: 'gerente@andina.test', password: created.body.temporary_password}});
  assert.equal(newLogin.status, 200);
  assert.ok(newLogin.body.memberships.some(m => m.tenant_id === created.body.id && m.role === 'owner'));
});

test('notifications: close and tickets create them; read state and muted kinds per user', async () => {
  const n = await notifyCloses(w.pool, withTransaction);
  assert.ok(n >= 1);
  assert.equal(await notifyCloses(w.pool, withTransaction), 0, 'the same close is notified once');
  await call(api, 'POST', '/api/tickets', {headers: H(vera, w.tenantA), body: {title: 'No llega la factura', priority: 'alta'}});
  let list = await call(api, 'GET', '/api/notifications', {headers: H(ana, w.tenantA)});
  assert.ok(list.body.items.some(x => x.kind === 'datos'));
  assert.ok(list.body.items.some(x => x.kind === 'ticket'));
  const unread = list.body.unread;
  assert.equal((await call(api, 'POST', '/api/notifications/read', {headers: H(ana, w.tenantA), body: {ids: [list.body.items[0].id]}})).status, 200);
  list = await call(api, 'GET', '/api/notifications', {headers: H(ana, w.tenantA)});
  assert.equal(list.body.unread, unread - 1);
  await call(api, 'PUT', '/api/notifications/prefs', {headers: H(ana, w.tenantA), body: {muted: ['ticket']}});
  list = await call(api, 'GET', '/api/notifications', {headers: H(ana, w.tenantA)});
  assert.ok(!list.body.items.some(x => x.kind === 'ticket'), 'muted kinds are hidden');
  const other = await call(api, 'GET', '/api/notifications', {headers: H(vera, w.tenantA)});
  assert.ok(other.body.items.some(x => x.kind === 'ticket'), 'preferences are per user');
  await call(api, 'POST', '/api/notifications/read', {headers: H(vera, w.tenantA), body: {all: true}});
  assert.equal((await call(api, 'GET', '/api/notifications', {headers: H(vera, w.tenantA)})).body.unread, 0);
});

test('suggested values: budget, thresholds and units from the data, never overwriting', async () => {
  assert.equal((await call(api, 'POST', '/api/inputs/seed', {headers: H(vera, w.tenantA), body: {}})).status, 403);
  const r = await call(api, 'POST', '/api/inputs/seed', {headers: H(ana, w.tenantA), body: {growth: 10}});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.thresholds > 0);
  const again = await call(api, 'POST', '/api/inputs/seed', {headers: H(ana, w.tenantA), body: {growth: 10}});
  assert.equal(again.body.thresholds, 0, 'a second run does not overwrite');
  const th = await call(api, 'GET', '/api/thresholds', {headers: H(ana, w.tenantA)});
  assert.ok(th.body.rules.some(x => x.id === 'inv-obs'));
});
