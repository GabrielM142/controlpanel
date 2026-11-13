// Suggested starting values for a company (SaaS onboarding): every module has something to
// measure against from day one, computed from the company's own published data, never invented:
// - business units: one per sales team (or one for the whole company) when none exist;
// - budget (sales, purchases, fixed expenses, marketing): the same month of the last 12 months
//   (or the average of the complete months) × (1 + growth), only for months without a budget;
// - thresholds: every rule saved with its default; monthly goal and minimum ticket from the data.
// Everything stays editable; nothing that the company already loaded is overwritten.
import {thresholdValues} from './metrics.mjs';

const DEFAULTS = {
  'com-meta-mensual': null, 'com-ticket': null, 'com-concentracion': 60, 'fin-cartera': 8, 'fin-liquidez': 30, 'fin-banco': 60,
  'cmp-proveedores': 55, 'cmp-cobertura': 15, 'cmp-margen': 7, 'inv-critico': 3, 'inv-obs': 5, 'inv-rotacion': 2.5,
  'sop-sla-cumpl': 95, 'sop-vencidos': 0, 'sop-respuesta': 15,
};
const GT = new Set(['com-concentracion', 'fin-cartera', 'fin-banco', 'cmp-proveedores', 'inv-critico', 'inv-obs', 'sop-vencidos', 'sop-respuesta']);
const ym = d => d.slice(0, 7);
const addMonths = (month, n) => { const [y, m] = month.split('-').map(Number); const t = y * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };

export async function seedCompany(c, tenantId, userId, {growth = 5, cutoff} = {}) {
  const out = {units: 0, budget: {}, thresholds: 0};
  // 1. Units: one rule per sales team with sales; otherwise one per company.
  if (!Number((await c.query('SELECT count(*) AS n FROM app.business_unit_rules')).rows[0].n)) {
    const src = (await c.query('SELECT id FROM app.connector_sources ORDER BY created_at LIMIT 1')).rows[0];
    if (src) {
      const teams = (await c.query(`SELECT d.match_value, d.name FROM core.dim_unit_source d WHERE d.source_id = $1 AND d.match_type = 'team' ORDER BY d.name`, [src.id])).rows;
      const companies = (await c.query(`SELECT d.match_value, d.name FROM core.dim_unit_source d WHERE d.source_id = $1 AND d.match_type = 'company' ORDER BY d.name`, [src.id])).rows;
      const pick = teams.length ? teams.slice(0, 4).map((t, i) => ({type: 'team', value: t.match_value, name: t.name || `Unidad ${i + 1}`}))
        : companies.slice(0, 4).map((t, i) => ({type: 'company', value: t.match_value, name: t.name || `Unidad ${i + 1}`}));
      for (const [i, r] of pick.entries()) {
        const code = r.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `unidad-${i + 1}`;
        await c.query(`INSERT INTO app.business_unit_rules(tenant_id, source_id, match_type, match_value, unit_code, unit_name, channel, priority, validated_by)
            VALUES ($1, $2, $3, $4, $5, $6, 'General', $7, 'OMEGA (sugerido)')`, [tenantId, src.id, r.type, r.value, code, r.name, (i + 1) * 10]);
        out.units++;
      }
      if (out.units) await c.query('UPDATE app.connector_sources SET rebuild_requested_at = now() WHERE id = $1', [src.id]);
    }
  }
  // 2. Budget for the rest of this year and all of next year, from the real monthly history.
  const end = cutoff || new Date().toISOString().slice(0, 10);
  const hist = async sql => Object.fromEntries((await c.query(sql, [end])).rows.map(r => [r.m, Number(r.v)]));
  const series = {
    ventas: await hist(`SELECT to_char(business_date, 'YYYY-MM') AS m, sum(net_amount) AS v FROM core.fact_sales_line
        WHERE business_date > $1::date - 400 AND business_date < date_trunc('month', $1::date) GROUP BY 1`),
    compras: await hist(`SELECT to_char(approve_date, 'YYYY-MM') AS m, sum(amount) AS v FROM core.fact_purchase_line
        WHERE approve_date > $1::date - 400 AND approve_date < date_trunc('month', $1::date) GROUP BY 1`),
    gastos_fijos: await hist(`SELECT to_char(month, 'YYYY-MM') AS m, sum(balance) AS v FROM core.fact_account_month
        WHERE month > $1::date - 400 AND month < date_trunc('month', $1::date) AND (code LIKE '601%' OR code LIKE '602%') GROUP BY 1`),
  };
  const first = addMonths(ym(end), 0), year = Number(end.slice(0, 4));
  const months = []; for (let m = first; Number(m.slice(0, 4)) <= year + 1; m = addMonths(m, 1)) months.push(m);
  const fill = async (kind, valueFor) => {
    const have = new Set((await c.query(`SELECT to_char(month, 'YYYY-MM') AS m FROM app.budgets WHERE kind = $1 AND unit_name IS NULL AND brand IS NULL`, [kind])).rows.map(r => r.m));
    let n = 0;
    for (const m of months) {
      if (have.has(m)) continue;
      const v = valueFor(m);
      if (!(v > 0)) continue;
      await c.query('INSERT INTO app.budgets(tenant_id, kind, month, amount, created_by) VALUES ($1, $2, $3, $4, $5)', [tenantId, kind, `${m}-01`, Math.round(v), userId]);
      n++;
    }
    out.budget[kind] = n;
  };
  const make = s => {
    const vals = Object.values(s).filter(v => v > 0);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return m => ((s[addMonths(m, -12)] > 0 ? s[addMonths(m, -12)] : avg) * (1 + growth / 100));
  };
  for (const kind of ['ventas', 'compras', 'gastos_fijos']) await fill(kind, make(series[kind]));
  const salesFor = make(series.ventas);
  await fill('marketing', m => salesFor(m) * 0.01); // 1% of sales: a usual starting point for marketing
  // 3. Thresholds: save every rule; goals from the data (monthly goal = sales budget, ticket −10%).
  const saved = new Set((await c.query('SELECT id FROM app.threshold_rules')).rows.map(r => r.id));
  const values = await thresholdValues(c, end);
  const goal = salesFor(addMonths(ym(end), 1));
  const target = {...DEFAULTS, 'com-meta-mensual': goal > 0 ? Math.round(goal) : null,
    'com-ticket': values['com-ticket'] ? Math.round(values['com-ticket'] * 0.9 * 100) / 100 : null};
  for (const [id, value] of Object.entries(target)) {
    if (saved.has(id) || value === null) continue;
    await c.query(`INSERT INTO app.threshold_rules(id, tenant_id, metric, comparator, warn_value, crit_value, enabled, owner_id, updated_at)
        VALUES ($1, $2, $1, $3, $4, $4, true, $5, now()) ON CONFLICT (tenant_id, id) DO NOTHING`, [id, tenantId, GT.has(id) ? 'gt' : 'lt', value, userId]);
    out.thresholds++;
  }
  return out;
}
