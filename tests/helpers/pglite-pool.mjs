// pg.Pool-compatible adapter over PGlite (real PostgreSQL compiled to WASM)
// so migrations, RLS policies, roles and SQL run for real in tests. PGlite is a
// single connection: callers must be sequential (they are in these tests).
import {PGlite} from '@electric-sql/pglite';

export async function createTestPool() {
  // Keep numeric/int8/date as strings, exactly like lib/db.mjs configures pg.
  const db = new PGlite({parsers: {1700: v => v, 20: v => v, 1082: v => v}});
  await db.waitReady;
  const normalize = r => ({rows: r.rows, rowCount: r.affectedRows ?? r.rows.length});
  const query = async (text, params) => {
    if (!params || !params.length) {
      const results = await db.exec(text);
      return normalize(results[results.length - 1] || {rows: []});
    }
    return normalize(await db.query(text, params));
  };
  const client = {query, release() {}};
  return {db, query, async connect() { return client; }, async end() { await db.close(); }};
}
