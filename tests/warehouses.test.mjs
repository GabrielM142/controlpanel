// Valorización por bodega on real PostgreSQL (PGlite) with the nova_api role and RLS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../server/app.mjs';
import {call, createWorld, PASSWORD} from './helpers/world.mjs';

let w; let api; let cookieA; let cookieB;
const H = (cookie, tenant) => ({cookie, 'x-nova-tenant': tenant, 'x-nova-request': '1'});
const login = async email => (await call(api, 'POST', '/api/auth/login', {headers: {'x-nova-request': '1'}, body: {email, password: PASSWORD}}))
  .headers['set-cookie'].split(';')[0];

test.before(async () => {
  w = await createWorld();
  w.transports.juj.setVisible(3);
  await w.ingest('juj');
  await w.ingest('beta');
  api = createHandler({pool: w.pool, config: w.config});
  cookieA = await login('ana@fixture.test');
  cookieB = await login('beto@fixture.test');
});
test.after(async () => { await w.pool.end(); });

test('warehouse valuation: totals reconcile with warehouses and products; filters narrow', async () => {
  const r = await call(api, 'GET', '/api/inventory/warehouses', {headers: H(cookieA, w.tenantA)});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.published);
  const {totals, warehouses, products, options} = r.body;
  const sum = rows => rows.reduce((s, x) => s + Number(x.value), 0);
  assert.ok(warehouses.length >= 1);
  assert.ok(Math.abs(sum(warehouses) - Number(totals.value)) < 0.01, 'bodegas = total');
  assert.ok(Math.abs(sum(products) - Number(totals.value)) < 0.01, 'productos = total');
  assert.ok(options.warehouses.length >= warehouses.length && options.categories.length >= 1);
  const first = warehouses[0];
  const one = await call(api, 'GET', `/api/inventory/warehouses?bodega=${first.id}`, {headers: H(cookieA, w.tenantA)});
  assert.equal(one.body.warehouses.length, 1);
  assert.equal(one.body.totals.value, first.value);
  assert.equal(one.body.options.warehouses.length, options.warehouses.length, 'las opciones no dependen del filtro');
  const none = await call(api, 'GET', '/api/inventory/warehouses?q=%25%25no-existe%25', {headers: H(cookieA, w.tenantA)});
  assert.equal(Number(none.body.totals.value), 0);
  const bad = await call(api, 'GET', "/api/inventory/warehouses?bodega=1;DROP TABLE x", {headers: H(cookieA, w.tenantA)});
  assert.equal(bad.status, 200); // non-numeric warehouse filter is ignored, never interpolated
});

test('warehouse valuation is tenant-isolated', async () => {
  const cross = await call(api, 'GET', '/api/inventory/warehouses', {headers: H(cookieB, w.tenantA)});
  assert.equal(cross.status, 403);
  const anon = await call(api, 'GET', '/api/inventory/warehouses', {headers: {'x-nova-tenant': w.tenantA}});
  assert.equal(anon.status, 401);
});
