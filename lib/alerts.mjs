// Threshold alerts evaluated on the server after each close, and sent to Telegram.
// The catalog mirrors the panel's rules that published data can answer (thresholdValues);
// a company's saved threshold/enabled state (app.threshold_rules) wins over the default.
import {decryptSecret} from './crypto.mjs';
import {thresholdValues} from './metrics.mjs';

export const RULES = {
  'com-meta-mensual': {label: 'Meta mensual mínima', unit: 'USD', op: '<', threshold: null, target: true, page: 'comercial'},
  'com-ticket': {label: 'Ticket promedio mínimo', unit: 'USD', op: '<', threshold: null, target: true, page: 'comercial'},
  'com-concentracion': {label: 'Concentración top 3 clientes', unit: '%', op: '>=', threshold: 60, page: 'clientes'},
  'fin-cartera': {label: 'Cartera vencida máxima', unit: '%', op: '>', threshold: 8, page: 'financiero'},
  'fin-liquidez': {label: 'Días de liquidez', unit: 'días', op: '<', threshold: 30, page: 'flujo'},
  'fin-banco': {label: 'Dependencia del banco principal', unit: '%', op: '>=', threshold: 60, page: 'financiero'},
  'cmp-proveedores': {label: 'Concentración en 2 proveedores', unit: '%', op: '>=', threshold: 55, page: 'compras'},
  'cmp-cobertura': {label: 'Cobertura de stock mínima', unit: 'días', op: '<', threshold: 15, page: 'inventarios'},
  'cmp-margen': {label: 'Margen bruto mínimo (30 días)', unit: '%', op: '<', threshold: 7, page: 'compras'},
  'inv-critico': {label: 'SKU en riesgo de quiebre', unit: 'SKU', op: '>', threshold: 3, page: 'inventarios'},
  'inv-obs': {label: 'Inventario sin movimiento (180 días)', unit: '%', op: '>', threshold: 5, page: 'inventarios'},
  'inv-rotacion': {label: 'Rotación mensual mínima', unit: 'veces/mes', op: '<', threshold: 2.5, page: 'inventarios'},
  'sop-sla-cumpl': {label: 'Cumplimiento de SLA', unit: '%', op: '<', threshold: 95, page: 'tickets'},
  'sop-vencidos': {label: 'Tickets con SLA vencido', unit: 'tickets', op: '>', threshold: 0, page: 'tickets'},
  'sop-respuesta': {label: 'Tiempo de primera respuesta', unit: 'min', op: '>', threshold: 15, page: 'tickets'},
};
const fmt = (v, unit) => unit === 'USD' ? `$${Math.round(v).toLocaleString('es-EC')}` : unit === '%' ? `${Number(v).toFixed(1)}%` : `${Number(v).toFixed(unit === 'veces/mes' ? 2 : 0)} ${unit}`;
const hit = (op, v, t) => (op === '<' ? v < t : op === '<=' ? v <= t : op === '>' ? v > t : v >= t);

/** Exceeded rules for one tenant at a close date (run inside a tenant transaction). */
export async function evaluateAlerts(c, businessDate, companies = null) {
  const values = await thresholdValues(c, businessDate, companies);
  const saved = new Map((await c.query('SELECT id, warn_value, enabled, comparator FROM app.threshold_rules')).rows.map(r => [r.id, r]));
  const out = [];
  for (const [id, rule] of Object.entries(RULES)) {
    const s = saved.get(id);
    const enabled = s ? s.enabled : !rule.target; // business targets stay off until the company sets them
    const threshold = s ? Number(s.warn_value) : rule.threshold;
    const value = values[id];
    if (!enabled || threshold === null || typeof value !== 'number') continue;
    if (hit(rule.op, value, threshold)) out.push({id, label: rule.label, value, threshold, op: rule.op, unit: rule.unit, page: rule.page,
      text: `${rule.label}: ${fmt(value, rule.unit)} (umbral ${rule.op} ${fmt(threshold, rule.unit)})`});
  }
  return out;
}

export async function sendTelegram(token, chatId, text, fetchImpl = globalThis.fetch) {
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token || '')) throw new Error('Token de bot de Telegram inválido');
  if (!/^-?\d{3,20}$|^@[A-Za-z0-9_]{4,64}$/.test(String(chatId || ''))) throw new Error('Chat de Telegram inválido');
  const r = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({chat_id: chatId, text, disable_web_page_preview: true}),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.ok === false) throw new Error(`Telegram respondió: ${String(body.description || r.status).slice(0, 120)}`);
  return true;
}

export function alertMessage(tenantName, businessDate, alerts, panelUrl) {
  return [`OMEGA · ${tenantName}`, `Cierre ${businessDate}: ${alerts.length} umbral${alerts.length > 1 ? 'es' : ''} excedido${alerts.length > 1 ? 's' : ''}`,
    ...alerts.map(a => `• ${a.text}`), panelUrl ? `Ver en el panel: ${panelUrl}` : ''].filter(Boolean).join('\n');
}

/**
 * Cron step: for every company with notifications on and a newer published close than the last
 * one notified, evaluate thresholds and send one Telegram summary (only when something is exceeded).
 */
export async function dispatchAlerts(pool, withTransaction, {secretKey, panelUrl, log = () => {}, fetchImpl} = {}) {
  const targets = await withTransaction(pool, {role: 'nova_worker'}, async c => (await c.query(`
    SELECT n.tenant_id, n.telegram_token_ciphertext, n.telegram_chat_id, n.last_version, t.name,
           (SELECT max(version) FROM ops.published_versions v WHERE v.tenant_id = n.tenant_id) AS version,
           (SELECT business_date::text FROM ops.published_versions v WHERE v.tenant_id = n.tenant_id ORDER BY version DESC LIMIT 1) AS business_date
      FROM app.notify_settings n JOIN app.tenants t ON t.id = n.tenant_id
     WHERE n.enabled AND n.telegram_token_ciphertext IS NOT NULL AND n.telegram_chat_id IS NOT NULL`)).rows);
  const results = [];
  for (const t of targets) {
    if (!t.version || (t.last_version && t.last_version >= t.version)) continue;
    let error = null; let sent = 0;
    try {
      const alerts = await withTransaction(pool, {role: 'nova_api', tenantId: t.tenant_id, readOnly: true}, c => evaluateAlerts(c, t.business_date));
      if (alerts.length) {
        await sendTelegram(decryptSecret(t.telegram_token_ciphertext, secretKey), t.telegram_chat_id, alertMessage(t.name, t.business_date, alerts, panelUrl), fetchImpl);
        sent = alerts.length;
      }
    } catch (e) { error = String(e.message).slice(0, 200); log('warn', 'alerts_failed', {tenant: t.tenant_id, error}); }
    await withTransaction(pool, {role: 'nova_worker'}, c => c.query(
      `UPDATE app.notify_settings SET last_version = CASE WHEN $3::text IS NULL THEN $2 ELSE last_version END,
         last_sent_at = CASE WHEN $4 > 0 THEN now() ELSE last_sent_at END, last_error = $3 WHERE tenant_id = $1`,
      [t.tenant_id, t.version, error, sent]));
    results.push({tenant: t.tenant_id, sent, error});
  }
  return results;
}
