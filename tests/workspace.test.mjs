// Tasks, notes, thresholds and decisions stored in the API (real PostgreSQL via PGlite + RLS).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../server/app.mjs';
import {call, createWorld, PASSWORD} from './helpers/world.mjs';

let w; let api; let ana; let beto; let vera;
const H = (cookie, tenant) => ({cookie, 'x-nova-tenant': tenant, 'x-nova-request': '1'});
const login = async email => (await call(api, 'POST', '/api/auth/login', {headers: {'x-nova-request': '1'}, body: {email, password: PASSWORD}}))
  .headers['set-cookie'].split(';')[0];

test.before(async () => {
  w = await createWorld();
  w.transports.juj.setVisible(3);
  await w.ingest('juj');
  await w.ingest('beta');
  api = createHandler({pool: w.pool, config: w.config});
  [ana, beto, vera] = [await login('ana@fixture.test'), await login('beto@fixture.test'), await login('vera@fixture.test')];
});
test.after(async () => { await w.pool.end(); });

test('tasks: create, update status and due date, list, delete; private to their owner', async () => {
  const t = await call(api, 'POST', '/api/tasks', {headers: H(ana, w.tenantA), body: {title: 'Revisar cartera', priority: 'alta', view_id: 'clientes'}});
  assert.equal(t.status, 201);
  const p = await call(api, 'PATCH', `/api/tasks/${t.body.id}`, {headers: H(ana, w.tenantA), body: {status: 'doing', due_date: '2026-12-01'}});
  assert.equal(p.body.status, 'doing');
  assert.equal(String(p.body.due_date).slice(0, 10), '2026-12-01');
  const cleared = await call(api, 'PATCH', `/api/tasks/${t.body.id}`, {headers: H(ana, w.tenantA), body: {due_date: null}});
  assert.equal(cleared.body.due_date, null);
  const otherUser = await call(api, 'GET', '/api/tasks', {headers: H(vera, w.tenantA)});
  assert.equal(otherUser.body.tasks.length, 0, 'otro usuario de la misma empresa no ve la tarea');
  const del = await call(api, 'DELETE', `/api/tasks/${t.body.id}`, {headers: H(ana, w.tenantA)});
  assert.equal(del.status, 200);
});

test('notes: create, edit, pin and delete', async () => {
  const n = await call(api, 'POST', '/api/notes', {headers: H(ana, w.tenantA), body: {body: 'Llamar al cliente', color: 'red', view_id: 'clientes'}});
  assert.equal(n.status, 201);
  const e = await call(api, 'PATCH', `/api/notes/${n.body.id}`, {headers: H(ana, w.tenantA), body: {body: 'Llamar hoy', pinned: true}});
  assert.deepEqual([e.body.body, e.body.pinned], ['Llamar hoy', true]);
  const cross = await call(api, 'PATCH', `/api/notes/${n.body.id}`, {headers: H(beto, w.tenantB), body: {body: 'x'}});
  assert.equal(cross.status, 404, 'RLS: otra empresa no la encuentra');
  assert.equal((await call(api, 'DELETE', `/api/notes/${n.body.id}`, {headers: H(ana, w.tenantA)})).status, 200);
});

test('thresholds: evaluated against the published close; only admins edit; shared per company', async () => {
  const g = await call(api, 'GET', '/api/thresholds', {headers: H(vera, w.tenantA)});
  assert.equal(g.status, 200);
  assert.equal(typeof g.body.values['com-meta-mensual'], 'number');
  assert.equal(g.body.can_edit, false);
  assert.equal(g.body.values['fin-liquidez'], undefined, 'sin fuente: no hay valor inventado');
  const denied = await call(api, 'PUT', '/api/thresholds/com-ticket', {headers: H(vera, w.tenantA), body: {threshold: 50}});
  assert.equal(denied.status, 403);
  const put = await call(api, 'PUT', '/api/thresholds/com-ticket', {headers: H(ana, w.tenantA), body: {threshold: 50, enabled: false, comparator: 'lt'}});
  assert.equal(put.status, 200);
  const seen = await call(api, 'GET', '/api/thresholds', {headers: H(vera, w.tenantA)});
  const rule = seen.body.rules.find(r => r.id === 'com-ticket');
  assert.deepEqual([Number(rule.warn_value), rule.enabled], [50, false], 'el viewer ve el umbral del administrador');
  const other = await call(api, 'GET', '/api/thresholds', {headers: H(beto, w.tenantB)});
  assert.equal(other.body.rules.length, 0, 'otra empresa no ve los umbrales');
});

test('decisions: create from Omega, decide (also derived ids), shared with who decided', async () => {
  const c = await call(api, 'POST', '/api/decisions', {headers: H(ana, w.tenantA), body: {title: 'Revisar descuento', detail: 'd', recommendation: 'r', page_id: 'comercial'}});
  assert.equal(c.status, 201);
  const d = await call(api, 'PATCH', `/api/decisions/${c.body.id}`, {headers: H(ana, w.tenantA), body: {status: 'aprobada'}});
  assert.equal(d.body.status, 'aprobada');
  const derived = await call(api, 'PATCH', '/api/decisions/th-com-ticket', {headers: H(ana, w.tenantA), body: {status: 'escalada', title: 'Umbral excedido'}});
  assert.equal(derived.body.kind, 'umbral');
  const viewerTry = await call(api, 'PATCH', `/api/decisions/${c.body.id}`, {headers: H(vera, w.tenantA), body: {status: 'rechazada'}});
  assert.equal(viewerTry.status, 403, 'lectura no decide');
  const list = await call(api, 'GET', '/api/decisions', {headers: H(vera, w.tenantA)});
  const mine = list.body.decisions.find(x => x.id === c.body.id);
  assert.equal(mine.status, 'aprobada');
  assert.ok(mine.decided_by_name);
  const other = await call(api, 'GET', '/api/decisions', {headers: H(beto, w.tenantB)});
  assert.equal(other.body.decisions.length, 0);
});
