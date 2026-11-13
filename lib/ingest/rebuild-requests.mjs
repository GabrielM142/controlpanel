// Full core/mart recalculation requested from the panel (after editing business-unit rules).
// Runs in the worker (cron) under the source lock, so it never overlaps a collect/apply.
import {withTransaction} from '../db.mjs';
import {rebuildAll} from './transform.mjs';

export async function processRebuildRequests(pool, role, log = () => {}) {
  const sources = await withTransaction(pool, {role}, async c => (await c.query(
    `SELECT id, tenant_id, timezone, attribute_map FROM app.connector_sources
      WHERE rebuild_requested_at IS NOT NULL ORDER BY rebuild_requested_at LIMIT 3`)).rows);
  const done = [];
  for (const s of sources) {
    const lock = await pool.connect();
    try {
      const ok = (await lock.query("SELECT pg_try_advisory_lock(hashtext('nova-source:' || $1)) AS ok", [s.id])).rows[0].ok;
      if (!ok) continue;
      try {
        const started = Date.now();
        const dates = await withTransaction(pool, {role}, async c => {
          const requested = (await c.query('SELECT rebuild_requested_at FROM app.connector_sources WHERE id = $1 FOR UPDATE', [s.id])).rows[0];
          if (!requested?.rebuild_requested_at) return null;
          const out = await rebuildAll(c, {tenantId: s.tenant_id, sourceId: s.id, timezone: s.timezone, attributeMap: s.attribute_map || []});
          await c.query('UPDATE app.connector_sources SET rebuild_requested_at = NULL, rebuilt_at = now() WHERE id = $1', [s.id]);
          return out;
        });
        if (dates) { done.push(s.id); log('info', 'rebuild_done', {source: s.id, dates: dates.length, ms: Date.now() - started}); }
      } finally {
        await lock.query("SELECT pg_advisory_unlock(hashtext('nova-source:' || $1))", [s.id]).catch(() => {});
      }
    } catch (error) {
      log('error', 'rebuild_failed', {source: s.id, error: error.message});
    } finally {
      lock.release();
    }
  }
  return done;
}
