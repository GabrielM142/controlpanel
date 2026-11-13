// In-app notifications: what a manager must review (exceeded thresholds, tickets, Trueken quota,
// new closes). Stored per company; a null user_id means everyone in it. dedupe_key makes every
// producer idempotent (the cron may run the same close twice).
import {evaluateAlerts} from './alerts.mjs';

export const KINDS = ['umbral', 'ticket', 'truekens', 'presupuesto', 'datos', 'decision', 'sistema'];

/** Insert one notification inside a tenant transaction (nova_api or nova_worker). */
export async function notify(c, tenantId, {kind, severity = 'info', title, body = null, pageId = null, userId = null, dedupe = null}) {
  await c.query(`INSERT INTO app.notifications(tenant_id, user_id, kind, severity, title, body, page_id, dedupe_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
  [tenantId, userId, kind, severity, String(title).slice(0, 200), body ? String(body).slice(0, 1000) : null, pageId, dedupe]);
}

/** After each new published close: one "cierre" notice and one per exceeded threshold. */
export async function notifyCloses(pool, withTransaction, {log = () => {}} = {}) {
  const tenants = await withTransaction(pool, {role: 'nova_worker'}, async c => (await c.query(`
    SELECT v.tenant_id, v.version, v.business_date::text AS business_date FROM ops.published_versions v
     WHERE v.version = (SELECT max(version) FROM ops.published_versions x WHERE x.tenant_id = v.tenant_id)
       AND NOT EXISTS (SELECT 1 FROM app.notifications n WHERE n.tenant_id = v.tenant_id AND n.dedupe_key = 'cierre:v' || v.version)`)).rows);
  let created = 0;
  for (const t of tenants) {
    try {
      await withTransaction(pool, {role: 'nova_api', tenantId: t.tenant_id}, async c => {
        const alerts = await evaluateAlerts(c, t.business_date);
        for (const a of alerts) {
          await notify(c, t.tenant_id, {kind: 'umbral', severity: 'critica', title: a.label, body: a.text, pageId: a.page, dedupe: `umbral:v${t.version}:${a.id}`});
          created++;
        }
        await notify(c, t.tenant_id, {kind: 'datos', title: `Cierre ${t.business_date} publicado`,
          body: alerts.length ? `${alerts.length} umbral${alerts.length > 1 ? 'es' : ''} excedido${alerts.length > 1 ? 's' : ''} en este cierre.` : 'Todos los umbrales activos están dentro de rango.',
          pageId: 'nivel1', dedupe: `cierre:v${t.version}`});
        created++;
      });
    } catch (e) { log('warn', 'notify_close_failed', {tenant: t.tenant_id, error: e.message}); }
  }
  return created;
}
