// Versioned migrations: sql/migrations/NNNN_name.sql, each in its own
// transaction, recorded with a checksum. An applied file that changed is an
// error (write a new migration instead). Rollback = restore backup / forward fix.
import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const dir = new URL('./migrations/', import.meta.url);

export async function listMigrations() {
  const files = (await readdir(dir)).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  return Promise.all(files.map(async f => {
    const sql = await readFile(new URL(f, dir), 'utf8');
    return {version: f.replace('.sql', ''), sql, checksum: createHash('sha256').update(sql).digest('hex')};
  }));
}

export async function migrate(pool, {log = () => {}} = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.nova_schema_migrations(
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('SELECT pg_advisory_lock(8174021)');
    const done = new Map((await client.query('SELECT version, checksum FROM public.nova_schema_migrations')).rows.map(r => [r.version, r.checksum]));
    for (const m of await listMigrations()) {
      if (done.has(m.version)) {
        if (done.get(m.version) !== m.checksum) throw new Error(`La migración ${m.version} ya aplicada fue modificada`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO public.nova_schema_migrations(version, checksum) VALUES ($1, $2)', [m.version, m.checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falló ${m.version}: ${error.message}`);
      }
      applied.push(m.version);
      log(`aplicada ${m.version}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(8174021)').catch(() => {});
    client.release();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const {createPool} = await import('../lib/db.mjs');
  const pool = createPool(undefined, {max: 1, statementTimeoutMs: 600000, applicationName: 'nova-migrate'});
  try {
    const applied = await migrate(pool, {log: console.log});
    console.log(applied.length ? `${applied.length} migraciones aplicadas` : 'Sin migraciones pendientes');
  } finally { await pool.end(); }
}
