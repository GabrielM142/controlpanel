// End-to-end ingestion on real PostgreSQL (PGlite): Python-produced fixture
// batches -> validation -> durable parts -> ACK -> idempotent apply -> marts ->
// publication. Covers mission M4.4 cases 1-8 and M9.1 failure modes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureTransport} from '../lib/ingest/fixture-transport.mjs';
import {applyRun} from '../lib/ingest/apply.mjs';
import {createWorld, salesBy} from './helpers/world.mjs';

let w;
test.before(async () => { w = await createWorld(); });
test.after(async () => { await w.pool.end(); });

test('initial load: sales, credit note sign, POS/invoice dedup, unit mapping', async () => {
  const out = await w.ingest('juj');
  assert.equal(out.status, 'ok');
  assert.equal(out.applied.length, 1);
  assert.equal(await salesBy(w, 'juj', "business_date = '2026-01-15'"), '100.00');
  // 250 invoice - 20 credit note + 80 invoice from POS order 801 + POS 800 (45 - 80 refund). POS 801 NOT counted again.
  assert.equal(await salesBy(w, 'juj', "business_date = '2026-11-09'"), '275.00');
  const pos801 = await w.one(`SELECT count(*)::int AS n FROM core.fact_sales_line WHERE source_id = $1 AND origin = 'pos' AND doc_id = 801`, [w.sources.juj]);
  assert.equal(pos801.n, 0);
  assert.equal(await salesBy(w, 'juj', "unit_code = 'RJ'"), '45.00');
  const cost = await w.one(`SELECT cost_amount::text FROM core.fact_sales_line WHERE source_id = $1 AND line_key = 'aml:6001'`, [w.sources.juj]);
  assert.equal(Number(cost.cost_amount), 60);
  const run = await w.one('SELECT state, acked_at FROM ingest.runs WHERE source_id = $1', [w.sources.juj]);
  assert.equal(run.state, 'published');
  assert.ok(run.acked_at, 'ACK after durable validation');
  assert.equal(w.transports.juj.acked.size, 1);
});

test('delta: old invoice change, salesperson move, line delete, payment, archive, cascade, new day', async () => {
  w.transports.juj.setVisible(3);
  const out = await w.ingest('juj');
  assert.equal(out.applied.length, 2, 'run 2 (delta) and run 3 (no changes) applied in order');
  assert.equal(await salesBy(w, 'juj', "business_date = '2026-01-15'"), '130.00', '1. January recalculated');
  assert.equal(await salesBy(w, 'juj', "business_date = '2026-11-09'"), '295.00', '3. deleted credit-note line withdrawn');
  assert.equal(await salesBy(w, 'juj', "business_date = '2026-11-10'"), '75.00');
  const luis = await w.one(`SELECT coalesce(sum(net_amount), 0)::text AS n FROM mart.sales_day WHERE source_id = $1 AND salesperson_id = 3 AND origin = 'invoice'`, [w.sources.juj]);
  const ana = await w.one(`SELECT coalesce(sum(net_amount), 0)::text AS n FROM mart.sales_day WHERE source_id = $1 AND salesperson_id = 2 AND business_date >= '2026-11-01'`, [w.sources.juj]);
  assert.equal(luis.n, '80.00', '2. old group corrected (only invoice 603 stays with Luis)');
  assert.equal(ana.n, '325.00', '2. new group gets invoice 601');
  const rec = await w.one(`SELECT residual::text FROM core.fact_receivable_item WHERE source_id = $1 AND line_id = 6002`, [w.sources.juj]);
  assert.equal(rec.residual, '60.00', '4. payment updates receivable without header change');
  const prod = await w.one(`SELECT active FROM core.dim_product WHERE source_id = $1 AND product_id = 201`, [w.sources.juj]);
  assert.equal(prod.active, false, '5. archived product kept as inactive');
  const hist = await w.one(`SELECT count(*)::int AS n FROM core.fact_sales_line WHERE source_id = $1 AND product_id = 201`, [w.sources.juj]);
  assert.ok(hist.n >= 2, '5. history preserved');
  const orders = await w.one(`SELECT count(*)::int AS n FROM core.fact_order_line WHERE source_id = $1`, [w.sources.juj]);
  assert.equal(orders.n, 0, 'cascade: lines of deleted order removed although no line event arrived');
  const child = await w.one(`SELECT deleted, deleted_reason FROM staging.records WHERE source_id = $1 AND dataset = 'sale_order_line' AND record_id = 1001`, [w.sources.juj]);
  assert.deepEqual([child.deleted, child.deleted_reason], [true, 'parent_deleted']);
  const deleted = await w.one(`SELECT deleted, data->>'move_id' AS move FROM staging.records WHERE source_id = $1 AND dataset = 'account_move_line' AND record_id = 6021`, [w.sources.juj]);
  assert.deepEqual([deleted.deleted, deleted.move], [true, '602'], 'logical delete keeps prior state');
  const changes = await w.one(`SELECT before->>'balance' AS b, after->>'balance' AS a FROM staging.record_changes WHERE dataset = 'account_move_line' AND record_id = 6001 AND after IS NOT NULL ORDER BY id DESC LIMIT 1`);
  assert.deepEqual([changes.b, changes.a], ['-100.00', '-130.00'], 'before/after audit');
});

test('7. run without changes is confirmed; aging snapshot still computed for its date', async () => {
  const run3 = await w.one(`SELECT state, business_date::text AS d, manifest->'totals'->>'records' AS records FROM ingest.runs WHERE source_id = $1 AND run_seq = 3`, [w.sources.juj]);
  assert.deepEqual([run3.state, run3.d, run3.records], ['published', '2026-11-11', '0']);
  const aging = await w.one(`SELECT sum(residual)::text AS r, sum(overdue)::text AS o, sum(b90p)::text AS b90, sum(b0_30)::text AS b30
                               FROM mart.receivable_day WHERE source_id = $1 AND snapshot_date = '2026-11-11'`, [w.sources.juj]);
  assert.deepEqual([aging.r, aging.o, aging.b90, aging.b30], ['365.00', '290.00', '60.00', '230.00']);
  const inv = await w.one(`SELECT qty_internal::text AS q, value::text AS v FROM mart.inventory_day WHERE source_id = $1 AND snapshot_date = '2026-11-11' AND product_id = 200`, [w.sources.juj]);
  assert.deepEqual([inv.q, inv.v], ['38.00', '1200.00']);
  const pub = await w.one('SELECT max(version) AS v FROM ops.published_versions WHERE tenant_id = $1', [w.tenantA]);
  assert.equal(Number(pub.v), 3);
});

test('6. re-collect and double import are idempotent', async () => {
  const before = await salesBy(w, 'juj');
  const again = await w.ingest('juj');
  assert.equal(again.applied.length, 0);
  // Force a replay of an already-applied run: ordering guard keeps state identical.
  const run2 = await w.one('SELECT id FROM ingest.runs WHERE source_id = $1 AND run_seq = 2', [w.sources.juj]);
  await w.q(`UPDATE ingest.runs SET state = 'validated' WHERE id = $1`, [run2.id]);
  await applyRun(w.pool, run2.id);
  assert.equal(await salesBy(w, 'juj'), before);
  assert.equal(await salesBy(w, 'juj', "business_date = '2026-01-15'"), '130.00', 'older replay never overwrites');
});

test('lost ACK response: published once, re-ACK on next collection, no duplicates', async () => {
  const t = createFixtureTransport('beta', {faults: {loseAckResponse: true}});
  const first = await w.ingest('beta', {transport: t});
  assert.equal(first.applied.length, 1, 'durable parts are applied even if the ACK response was lost');
  let run = await w.one('SELECT acked_at FROM ingest.runs WHERE source_id = $1', [w.sources.beta]);
  assert.equal(run.acked_at, null);
  await w.ingest('beta', {transport: t});
  run = await w.one('SELECT acked_at FROM ingest.runs WHERE source_id = $1', [w.sources.beta]);
  assert.ok(run.acked_at);
  assert.equal(t.calls.ackRun, 2);
  assert.equal(await salesBy(w, 'beta'), '999.00');
});

test('connection drop mid-run: retry downloads only missing parts', async () => {
  const world = await createWorld();
  try {
    const t = createFixtureTransport('juj', {visibleRuns: 1, faults: {dropConnectionOnPart: 5}});
    const r1 = await world.ingest('juj', {transport: t});
    assert.equal(r1.applied.length, 0);
    const stored = await world.one('SELECT count(*)::int AS n FROM ingest.parts');
    assert.equal(stored.n, 4);
    const r2 = await world.ingest('juj', {transport: t});
    assert.equal(r2.applied.length, 1);
    const total = (await world.one('SELECT manifest->\'totals\'->>\'parts\' AS p FROM ingest.runs')).p;
    assert.equal(t.calls.readPart, Number(total) + 1, 'only the failed part is requested again');
  } finally { await world.pool.end(); }
});

test('corrupt, truncated, oversized, incompatible and gapped batches are rejected without publishing', async () => {
  const cases = {
    corrupt: {part: (p, n) => (n === 2 ? {...p, content: p.content.slice(0, 40) + (p.content[40] === 'A' ? 'B' : 'A') + p.content.slice(41)} : p)},
    truncated: {part: (p, n) => (n === 1 ? {...p, content: p.content.slice(0, Math.floor(p.content.length / 2))} : p)},
    incompatible: {manifest: m => ({...m, schema: 'nova.export.v2'})},
    gapped: {manifest: m => ({...m, parts: m.parts.slice(1)})},
    wrong_generation: {manifest: m => ({...m, source: {...m.source, generation: 9}})},
  };
  for (const [name, faults] of Object.entries(cases)) {
    const world = await createWorld();
    try {
      const t = createFixtureTransport('juj', {visibleRuns: 2, faults});
      const r = await world.ingest('juj', {transport: t});
      assert.equal(r.applied.length, 0, name);
      const run = await world.one('SELECT state, error FROM ingest.runs ORDER BY run_seq LIMIT 1');
      assert.equal(run.state, 'rejected', `${name}: ${run.error}`);
      const runs = await world.one('SELECT count(*)::int AS n FROM ingest.runs');
      assert.equal(runs.n, 1, `${name}: a rejected run blocks later runs (no out-of-order apply)`);
      assert.equal(t.acked.size, 0, `${name}: never ACK an invalid batch`);
      const pub = await world.one('SELECT count(*)::int AS n FROM ops.published_versions');
      assert.equal(pub.n, 0, name);
    } finally { await world.pool.end(); }
  }
  const world = await createWorld();
  try {
    const r = await world.ingest('juj', {config: {maxPartBytes: 1024}});
    assert.equal(r.applied.length, 0);
    assert.equal((await world.one('SELECT state FROM ingest.runs')).state, 'rejected', 'oversized part');
  } finally { await world.pool.end(); }
});

test('source restored/cloned with another generation: relink required, central data preserved', async () => {
  await w.q('UPDATE app.connector_sources SET source_generation = 2 WHERE id = $1', [w.sources.beta]);
  const before = await salesBy(w, 'beta');
  const r = await w.ingest('beta', {transport: createFixtureTransport('beta')});
  assert.equal(r.status, 'relink_required');
  const src = await w.one('SELECT status FROM app.connector_sources WHERE id = $1', [w.sources.beta]);
  assert.equal(src.status, 'relink_required');
  assert.equal(await salesBy(w, 'beta'), before, 'nothing deleted by a source change');
  await w.q(`UPDATE app.connector_sources SET source_generation = 1, status = 'active' WHERE id = $1`, [w.sources.beta]);
});

test('snapshot_replace: complete empty snapshot clears scope, incomplete never does', async () => {
  const quants = async () => (await w.one(`SELECT count(*)::int AS n FROM staging.records WHERE source_id = $1 AND dataset = 'stock_quant' AND NOT deleted`, [w.sources.juj])).n;
  assert.ok(await quants() > 0);
  const insertRun = async (seq, complete) => (await w.one(`INSERT INTO ingest.runs(tenant_id, source_id, run_uuid, run_seq, generation, state, manifest, business_date)
      VALUES ($1, $2, gen_random_uuid(), $3, 1, 'validated', $4, '2026-11-12') RETURNING id`, [w.tenantA, w.sources.juj, seq, JSON.stringify({
    schema: 'nova.export.v1', run_seq: seq, parts: [], reconciliation: [], warnings: [], companies: [1, 2],
    datasets: [{key: 'stock_quant', version: 1, mode: 'snapshot_replace', records: 0, parts: [], events: 0, backfill_complete: true,
      resync_epoch: 1, missing_optional_fields: [], complete, scope: {company_ids: [1]}}]})])).id;
  await applyRun(w.pool, await insertRun(10, false));
  assert.ok(await quants() > 0, 'partial snapshot never cleans the destination');
  const warn = await w.one(`SELECT count(*)::int AS n FROM ops.data_quality_results WHERE check_name = 'snapshot_incomplete'`);
  assert.equal(warn.n, 1);
  await applyRun(w.pool, await insertRun(11, true));
  assert.equal(await quants(), 0, 'complete empty snapshot for explicit scope is legitimate');
  const inv = await w.one(`SELECT coalesce(sum(qty_internal), 0)::text AS q FROM mart.inventory_day WHERE source_id = $1 AND snapshot_date = '2026-11-12'`, [w.sources.juj]);
  assert.equal(Number(inv.q), 0);
});

test('tenant keys are never shared: same Odoo ids in two databases stay separate', async () => {
  const rows = (await w.q(`SELECT tenant_id, data->>'name' AS name FROM staging.records WHERE dataset = 'res_partner' AND record_id = 300 ORDER BY 2`)).rows;
  assert.deepEqual(rows.map(r => r.name), ['Beta Cliente', 'Cliente A']);
  assert.notEqual(rows[0].tenant_id, rows[1].tenant_id);
});
