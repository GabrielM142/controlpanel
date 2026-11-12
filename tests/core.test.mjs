import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {resetHandler} from '../api/index.mjs';
import {demoRows, summarize, validateRows} from '../lib/model.mjs';

test('validates legacy demo contract (fixture only) with signed measures', () => {
  assert.equal(validateRows(demoRows()).length, 24);
  assert.throws(() => validateRows([{period: 'bad'}]));
  assert.throws(() => validateRows([{...demoRows()[0], sales: NaN}]));
  assert.equal(validateRows([{...demoRows()[0], sales: -120, cost: -80}]).length, 1, 'credit notes may be negative');
  assert.throws(() => validateRows([{...demoRows()[0], orders: -1}]), 'counts cannot be negative');
});
test('zero sales does not produce infinite margin', () => {
  assert.equal(summarize([]).margin, 0);
  assert.equal(summarize([{sales: 100, cost: 75, receivable: 0, overdue: 0, inventory: 0, orders: 1}]).margin, 25);
});
function response() { return {headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); }}; }
function req(url, method) { return {url, method, headers: {}, async *[Symbol.asyncIterator]() {}}; }
test('production fails closed without session', async () => {
  process.env.APP_MODE = 'live'; delete process.env.DATABASE_URL; resetHandler();
  const res = response();
  await handler(req('/api/state', 'GET'), res);
  assert.equal(res.statusCode, 401);
  const reports = response();
  await handler(req('/api/reports/comercial', 'GET'), reports);
  assert.equal(reports.statusCode, 503, 'no database => no data, never demo numbers in live mode');
});
test('demo is explicit and cannot enqueue', async () => {
  process.env.APP_MODE = 'demo'; resetHandler();
  const res = response();
  await handler(req('/api/refresh', 'POST'), res);
  assert.equal(res.statusCode, 409);
  const read = response();
  await handler(req('/api/state', 'GET'), read);
  assert.equal(read.body.mode, 'demo');
  assert.equal(read.body.snapshots[0].rows.length, 24);
});
