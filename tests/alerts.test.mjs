// Threshold alerts + Telegram notifications (real PostgreSQL via PGlite; Telegram stubbed).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../server/app.mjs';
import {withTransaction} from '../lib/db.mjs';
import {dispatchAlerts, evaluateAlerts} from '../lib/alerts.mjs';
import {call, createWorld, PASSWORD, SECRET_KEY} from './helpers/world.mjs';

let w; let api; let ana; let vera;
const H = (cookie, tenant) => ({cookie, 'x-nova-tenant': tenant, 'x-nova-request': '1'});
const login = async email => (await call(api, 'POST', '/api/auth/login', {headers: {'x-nova-request': '1'}, body: {email, password: PASSWORD}}))
  .headers['set-cookie'].split(';')[0];
const TOKEN = '123456789:AAEexampleTokenForTests_0123456789';

test.before(async () => {
  w = await createWorld();
  w.transports.juj.setVisible(3);
  await w.ingest('juj');
  api = createHandler({pool: w.pool, config: w.config});
  [ana, vera] = [await login('ana@fixture.test'), await login('vera@fixture.test')];
});
test.after(async () => { await w.pool.end(); });

test('notification settings: admin only, token encrypted and never returned', async () => {
  const denied = await call(api, 'PUT', '/api/notify/settings', {headers: H(vera, w.tenantA), body: {telegram_token: TOKEN, chat_id: '-100123456'}});
  assert.equal(denied.status, 403);
  const bad = await call(api, 'PUT', '/api/notify/settings', {headers: H(ana, w.tenantA), body: {telegram_token: 'no-es-token', chat_id: '-100123456'}});
  assert.equal(bad.status, 400);
  const ok = await call(api, 'PUT', '/api/notify/settings', {headers: H(ana, w.tenantA), body: {telegram_token: TOKEN, chat_id: '-100123456', enabled: true}});
  assert.equal(ok.status, 200);
  const g = await call(api, 'GET', '/api/notify/settings', {headers: H(ana, w.tenantA)});
  assert.deepEqual([g.body.has_token, g.body.enabled, g.body.chat_id], [true, true, '-100123456']);
  assert.doesNotMatch(JSON.stringify(g.body), /AAEexample/);
});

test('alerts follow the saved thresholds and are sent once per published close', async () => {
  // Concentration of the top 3 customers is high in the fixtures: force a low threshold so it fires.
  await call(api, 'PUT', '/api/thresholds/com-concentracion', {headers: H(ana, w.tenantA), body: {threshold: 1, enabled: true, comparator: 'gt'}});
  const pub = await w.one('SELECT business_date::text AS d FROM ops.published_versions WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1', [w.tenantA]);
  const alerts = await withTransaction(w.pool, {role: 'nova_api', tenantId: w.tenantA, readOnly: true}, c => evaluateAlerts(c, pub.d));
  assert.ok(alerts.some(a => a.id === 'com-concentracion'));
  assert.ok(!alerts.some(a => a.id === 'com-meta-mensual'), 'una meta sin configurar no alerta');
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({url, body: JSON.parse(init.body)}); return new Response(JSON.stringify({ok: true}), {status: 200}); };
  const first = await dispatchAlerts(w.pool, withTransaction, {secretKey: SECRET_KEY, fetchImpl});
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /api\.telegram\.org\/bot123456789:/);
  assert.equal(sent[0].body.chat_id, '-100123456');
  assert.match(sent[0].body.text, /Concentración top 3/);
  assert.ok(first.some(r => r.sent > 0));
  await dispatchAlerts(w.pool, withTransaction, {secretKey: SECRET_KEY, fetchImpl});
  assert.equal(sent.length, 1, 'el mismo cierre no se vuelve a notificar');
});
