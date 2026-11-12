import test from 'node:test';
import assert from 'node:assert/strict';
import {main} from '../scripts/admin.mjs';
import {verifyPassword} from '../lib/crypto.mjs';
import {createWorld} from './helpers/world.mjs';

test('admin set-password resets the hash, closes sessions and clears the login lock', async () => {
  const w = await createWorld();
  await w.q(`INSERT INTO app.sessions(token_hash, user_id, expires_at) VALUES ('t1', $1, now() + interval '1 day')`, [w.userA]);
  await w.q(`INSERT INTO app.auth_throttle(key, failures, locked_until) VALUES ('email:ana@fixture.test', 9, now() + interval '1 hour')`);
  const old = process.env.NOVA_NEW_PASSWORD;
  process.env.NOVA_NEW_PASSWORD = 'nueva-clave-segura-2026';
  try {
    await main(['set-password', 'Ana@Fixture.test'], {pool: w.pool});
    const u = await w.one('SELECT password_hash FROM app.users WHERE id = $1', [w.userA]);
    assert.equal(await verifyPassword('nueva-clave-segura-2026', u.password_hash), true);
    assert.equal((await w.one('SELECT count(*)::int AS n FROM app.sessions WHERE user_id = $1 AND revoked_at IS NULL', [w.userA])).n, 0);
    assert.equal((await w.one(`SELECT count(*)::int AS n FROM app.auth_throttle WHERE key = 'email:ana@fixture.test'`)).n, 0);
    await assert.rejects(() => main(['set-password', 'nadie@fixture.test'], {pool: w.pool}), /No existe/);
    process.env.NOVA_NEW_PASSWORD = 'corta';
    await assert.rejects(() => main(['set-password', 'ana@fixture.test'], {pool: w.pool}), /12 caracteres/);
  } finally {
    if (old === undefined) delete process.env.NOVA_NEW_PASSWORD; else process.env.NOVA_NEW_PASSWORD = old;
  }
  await main(['list-users'], {pool: w.pool});
  await w.q(`INSERT INTO app.auth_throttle(key, failures, locked_until) VALUES ('email:beto@fixture.test', 9, now() + interval '1 hour')`);
  await main(['unlock', 'Beto@fixture.test'], {pool: w.pool});
  assert.equal((await w.one(`SELECT count(*)::int AS n FROM app.auth_throttle WHERE key = 'email:beto@fixture.test'`)).n, 0);
  await w.pool.end();
});
