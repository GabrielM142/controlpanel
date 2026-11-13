// Truekens: OMEGA's unit of AI consumption. Every Omega IA answer records the real tokens the
// provider reported (input + output) and converts them with the platform multiplier:
//   truekens = ceil((input_tokens + output_tokens) × multiplier)
// The ledger (app.ai_usage) is the evidence for the manager: who, when, what for, how many.
import {notify} from './notifications.mjs';

export async function truekenSettings(c) {
  const rows = (await c.query(`SELECT key, value FROM app.platform_settings WHERE key IN ('truekens', 'default_plan')`)).rows;
  const by = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const multiplier = Number(by.truekens?.multiplier);
  return {multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1, label: by.truekens?.label || 'Truekens',
    defaultQuota: by.default_plan?.trueken_quota ?? null, defaultModules: by.default_plan?.modules ?? null};
}

/** Plan of the company in the current tenant transaction (defaults when none was saved). */
export async function tenantPlan(c, tenantId) {
  const s = await truekenSettings(c);
  const p = (await c.query('SELECT plan_name, status, trueken_quota, modules, skills FROM app.tenant_plans WHERE tenant_id = $1', [tenantId])).rows[0];
  return {plan_name: p?.plan_name || 'Estándar', status: p?.status || 'activa', quota: p ? p.trueken_quota : s.defaultQuota,
    modules: p ? p.modules : s.defaultModules, skills: p?.skills || [], multiplier: s.multiplier, label: s.label};
}

export async function monthUsage(c) {
  const r = (await c.query(`SELECT coalesce(sum(truekens), 0)::float AS truekens, count(*)::int AS questions
      FROM app.ai_usage WHERE at >= date_trunc('month', now())`)).rows[0];
  return {truekens: Number(r.truekens), questions: r.questions};
}

/** Throws a user-facing message when the company cannot spend Truekens now. */
export async function assertCanSpend(c, tenantId) {
  const plan = await tenantPlan(c, tenantId);
  if (plan.status === 'suspendida') return {ok: false, status: 403, message: 'La cuenta de tu empresa está suspendida: contacta a tu administrador de OMEGA.'};
  if (plan.quota !== null && plan.quota !== undefined) {
    const used = await monthUsage(c);
    if (used.truekens >= plan.quota) return {ok: false, status: 402, message: `Tu empresa usó sus ${plan.quota.toLocaleString('es-EC')} ${plan.label} de este mes. Pide a tu administrador ampliar el plan.`};
  }
  return {ok: true, plan};
}

/** Record one answer and notify the company when it crosses 80% / 100% of its quota. */
export async function recordUsage(c, {tenantId, userId, pageId, provider, model, question, usage, feature = 'omega'}) {
  const plan = await tenantPlan(c, tenantId);
  const input = Number(usage?.input) || 0, output = Number(usage?.output) || 0;
  const truekens = Math.ceil((input + output) * plan.multiplier);
  const before = await monthUsage(c);
  await c.query(`INSERT INTO app.ai_usage(tenant_id, user_id, page_id, provider, model, question, input_tokens, output_tokens, multiplier, truekens, feature)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
  [tenantId, userId, pageId, provider, model ? String(model).slice(0, 80) : null, question ? String(question).slice(0, 300) : null, input, output, plan.multiplier, truekens, feature]);
  if (plan.quota) {
    const month = new Date().toISOString().slice(0, 7);
    for (const level of [80, 100]) {
      const limit = plan.quota * level / 100;
      if (before.truekens < limit && before.truekens + truekens >= limit) {
        await notify(c, tenantId, {kind: 'truekens', severity: level === 100 ? 'critica' : 'atencion', pageId: 'truekens',
          title: level === 100 ? `Se agotaron los ${plan.label} del mes` : `Tu empresa usó el 80% de sus ${plan.label}`,
          body: `${Math.round(before.truekens + truekens).toLocaleString('es-EC')} de ${plan.quota.toLocaleString('es-EC')} ${plan.label} en ${month}.`,
          dedupe: `truekens:${month}:${level}`});
      }
    }
  }
  return {truekens, input, output, multiplier: plan.multiplier};
}
