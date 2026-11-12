import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureTransport} from '../lib/ingest/fixture-transport.mjs';
import {nextCollect, processCommands} from '../lib/ingest/worker.mjs';
import {localDate, nextLocalTime} from '../lib/time.mjs';
import {createWorld} from './helpers/world.mjs';

test('collection schedule: 03:00 America/Guayaquil + stable jitter, retry while batch not ready', () => {
  const now = new Date('2026-11-11T07:30:00Z'); // 02:30 local
  const at = nextLocalTime(now, 'America/Guayaquil', '03:00');
  assert.equal(at.toISOString(), '2026-11-11T08:00:00.000Z');
  const src = {id: 'a1', collect_after: '03:00:00', collect_tz: 'America/Guayaquil'};
  const j1 = nextCollect(src, now, {found: true});
  const j2 = nextCollect(src, now, {found: true});
  assert.equal(j1.getTime(), j2.getTime(), 'jitter is stable per source');
  assert.ok(j1 >= at && j1 - at < 15 * 60000);
  const other = nextCollect({...src, id: 'zz-other-source'}, now, {found: true});
  assert.notEqual(other.getTime(), j1.getTime(), 'sources are spread over the window');
  const during = new Date('2026-11-11T08:20:00Z'); // 03:20 local, nothing ready yet
  assert.equal(nextCollect(src, during, {found: false}).toISOString(), '2026-11-11T08:50:00.000Z');
  assert.equal(localDate(new Date('2026-11-11T04:59:59Z'), 'America/Guayaquil'), '2026-11-10');
});

test('link command: worker pairs the source, stores identity and companies; clash detected', async () => {
  const w = await createWorld();
  try {
    const tenant = w.tenantB;
    const pending = (await w.one(`INSERT INTO app.connector_sources(tenant_id, name, base_url, db_name, login)
                                  VALUES ($1, 'beta-2', 'https://odoo.fixture.test', 'db', 'nova') RETURNING id`, [tenant])).id;
    await w.q(`INSERT INTO app.connector_credentials(source_id, tenant_id, secret_ciphertext) SELECT $1, tenant_id, secret_ciphertext
               FROM app.connector_credentials WHERE source_id = $2`, [pending, w.sources.beta]);
    await w.q(`INSERT INTO ops.source_commands(tenant_id, source_id, command, payload) VALUES ($1, $2, 'link', '{"link_token":"fixture-link-token"}')`, [tenant, pending]);
    const factory = async () => createFixtureTransport('beta', {linkedRef: null});
    await processCommands(w.pool, 'nova_worker', factory);
    const clash = await w.one('SELECT status, result FROM ops.source_commands WHERE source_id = $1', [pending]);
    assert.equal(clash.status, 'failed', 'same installation/generation already belongs to another source');
    // Free the identity (as after a documented relink) and retry.
    await w.q(`UPDATE app.connector_sources SET installation_uuid = NULL, source_generation = NULL, status = 'paused' WHERE id = $1`, [w.sources.beta]);
    await w.q(`INSERT INTO ops.source_commands(tenant_id, source_id, command, payload) VALUES ($1, $2, 'link', '{"link_token":"fixture-link-token"}')`, [tenant, pending]);
    await processCommands(w.pool, 'nova_worker', factory);
    const src = await w.one('SELECT status, installation_uuid, source_generation, next_collect_at FROM app.connector_sources WHERE id = $1', [pending]);
    assert.equal(src.status, 'active');
    assert.equal(src.installation_uuid, '0a9d4a0e-55a2-4c3d-9d77-7e2b3f9e0b02');
    assert.ok(src.next_collect_at);
    const companies = await w.one('SELECT count(*)::int AS n FROM app.source_companies WHERE source_id = $1', [pending]);
    assert.equal(companies.n, 1);
    await w.q(`INSERT INTO ops.source_commands(tenant_id, source_id, command, payload) VALUES ($1, $2, 'link', '{"link_token":"bad"}')`, [tenant, pending]);
    await processCommands(w.pool, 'nova_worker', async () => createFixtureTransport('beta', {linkedRef: null}));
    const bad = await w.one(`SELECT status FROM ops.source_commands WHERE source_id = $1 ORDER BY id DESC LIMIT 1`, [pending]);
    assert.equal(bad.status, 'failed', 'invalid pairing token');
  } finally { await w.pool.end(); }
});
