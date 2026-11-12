// Metric catalog and report builder over NOVA's published marts. Every
// definition is versioned and starts as "propuesta" until JUJ approves it.
// Nothing here queries Odoo.

export const METRICS = {
  sales_net: {version: 1, status: 'propuesta', label: 'Venta neta', unit: 'USD', aggregation: 'sum',
    formula: 'Σ líneas de producto de facturas y NC publicadas (−balance, moneda compañía) + líneas POS pagadas sin factura',
    source: 'account_move_line, account_move, pos_order_line, pos_order', grain: 'día × compañía × unidad × vendedor × marca × categoría × provincia'},
  gross_profit: {version: 2, status: 'propuesta', label: 'Utilidad bruta', unit: 'USD', aggregation: 'sum',
    formula: 'Σ venta neta − Σ costo, solo sobre líneas con costo conocido. Costo: COGS anglosajón de la factura, costo POS, o (contabilidad continental) cantidad × costo unitario contabilizado por Odoo en la entrega del producto en la fecha de la factura o la más cercana',
    source: 'account_move_line (display_type=cogs | asientos de inventario en la cuenta de salida de la categoría), pos_order_line.total_cost'},
  gross_margin_pct: {version: 1, status: 'propuesta', label: 'Margen bruto %', unit: '%', aggregation: 'ratio',
    formula: '(Σ venta con costo conocido − Σ costo) / Σ venta con costo conocido; nunca promedio de porcentajes'},
  customers_invoiced: {version: 1, status: 'propuesta', label: 'Clientes facturados', unit: 'clientes', aggregation: 'distinct',
    formula: 'COUNT DISTINCT socio comercial con venta neta en el período y filtros (no suma de conteos)'},
  ticket_avg: {version: 1, status: 'propuesta', label: 'Ticket promedio', unit: 'USD', aggregation: 'ratio',
    formula: 'Σ venta neta / COUNT DISTINCT documentos (facturas, NC y pedidos POS) del mismo universo'},
  orders_pending_invoice: {version: 2, status: 'propuesta', label: 'Pedidos pendientes de facturar', unit: 'USD', aggregation: 'sum',
    formula: 'Σ cantidad a facturar de Odoo (qty_to_invoice: según política pedida/entregada) × precio neto unitario, pedidos confirmados (pedido ≠ venta)'},
  backorder_value: {version: 2, status: 'propuesta', label: 'Valor en backorder', unit: 'USD', aggregation: 'sum',
    formula: 'Σ (cantidad pedida − entregada) × precio neto unitario, pedidos confirmados con entrega pendiente o parcial (delivery_status ≠ full: lo que Odoo ya cerró no se entregará)'},
  pending_age_days: {version: 1, status: 'propuesta', label: 'Antigüedad promedio de pendientes', unit: 'días', aggregation: 'avg',
    formula: 'Promedio ponderado por línea de (fecha de corte − fecha del pedido) en líneas con saldo por facturar'},
  orders_pending_15d: {version: 1, status: 'propuesta', label: 'Pedidos +15 días sin facturar', unit: 'pedidos', aggregation: 'distinct',
    formula: 'COUNT DISTINCT pedidos con saldo por facturar y antigüedad > 15 días al corte'},
  inventory_value: {version: 1, status: 'propuesta', label: 'Valor del inventario', unit: 'USD', aggregation: 'snapshot',
    formula: 'Σ valor de capas de valoración hasta el corte (no se suma entre fechas)'},
  sku_active: {version: 1, status: 'propuesta', label: 'SKU activos', unit: 'SKU', aggregation: 'distinct',
    formula: 'COUNT DISTINCT productos con existencia interna > 0 al corte'},
  receivable_open: {version: 1, status: 'propuesta', label: 'Cartera abierta', unit: 'USD', aggregation: 'snapshot',
    formula: 'Σ residual de apuntes por cobrar publicados al corte; aging por días desde vencimiento'},
};

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const UNIT_PAGES = {mayoristahogar: 'Mayorista Hogar', mayoristaintorno: 'Mayorista Intorno', retailjuj: 'Retail JUJ', retailintorno: 'Retail Intorno'};
const ALL = new Set(['Todos', 'Todas', '', undefined, null]);

const money = new Intl.NumberFormat('es-EC', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
const money2 = new Intl.NumberFormat('es-EC', {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2});
const int = new Intl.NumberFormat('es-EC', {maximumFractionDigits: 0});
const num = v => (v === null || v === undefined ? null : Number(v));
const fmtMoney = v => (v === null ? '—' : money.format(v));
const fmtPct = v => (v === null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`);
const ratio = (a, b) => (b ? a / b : null);
const growth = (cur, prev) => (prev ? (cur - prev) / Math.abs(prev) * 100 : null);
const toneOf = v => (v === null ? 'a' : v >= 0 ? 'g' : 'r');
const signed = v => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

export function parseFilters(query, pageId, businessDate) {
  const year = /^\d{4}$/.test(query.anio || '') ? Number(query.anio) : Number((businessDate || new Date().toISOString()).slice(0, 4));
  const monthIdx = MONTHS.indexOf(query.mes);
  const cap = businessDate || `${year}-12-31`;
  let from; let to;
  if (monthIdx >= 0) {
    from = `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, monthIdx + 1, 0)).toISOString().slice(0, 10);
    to = end < cap ? end : cap;
  } else {
    from = `${year}-01-01`;
    to = `${year}-12-31` < cap ? `${year}-12-31` : cap;
  }
  const shift = d => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28');
  const pick = k => (ALL.has(query[k]) ? null : String(query[k]).slice(0, 120));
  const unit = UNIT_PAGES[pageId] || pick('unidad');
  const channel = pick('canal');
  return {from, to, prevFrom: shift(from), prevTo: shift(to), unit, channel, brand: pick('marca'), category: pick('categoria'),
    province: pick('provincia'), salesperson: pick('vendedor'), year, cutoff: businessDate};
}

function where(f, p, {alias = 'm', mart = true, range = 'cur', companies = null} = {}) {
  const w = [`${alias}.business_date BETWEEN $${p.push(range === 'cur' ? f.from : f.prevFrom)} AND $${p.push(range === 'cur' ? f.to : f.prevTo)}`];
  if (f.unit) w.push(`${alias}.unit_code IN (SELECT unit_code FROM app.business_unit_rules WHERE unit_name = $${p.push(f.unit)})`);
  if (f.channel) w.push(`${alias}.channel = $${p.push(f.channel)}`);
  if (f.salesperson) w.push(`${alias}.salesperson_id IN (SELECT user_id FROM core.dim_user WHERE name = $${p.push(f.salesperson)})`);
  if (mart) {
    if (f.brand) w.push(`${alias}.brand = $${p.push(f.brand)}`);
    if (f.category) w.push(`${alias}.categ_id IN (SELECT categ_id FROM core.dim_product WHERE category_name = $${p.push(f.category)})`);
    if (f.province) w.push(`${alias}.state_id IN (SELECT state_id FROM core.dim_partner WHERE state_name = $${p.push(f.province)})`);
  } else {
    if (f.brand) w.push(`${alias}.product_id IN (SELECT product_id FROM core.dim_product WHERE brand = $${p.push(f.brand)})`);
    if (f.category) w.push(`${alias}.product_id IN (SELECT product_id FROM core.dim_product WHERE category_name = $${p.push(f.category)})`);
    if (f.province) w.push(`${alias}.partner_id IN (SELECT partner_id FROM core.dim_partner WHERE state_name = $${p.push(f.province)})`);
  }
  if (companies) w.push(`(${alias}.source_id::text || ':' || ${alias}.company_id) = ANY($${p.push(companies)}::text[])`);
  return w.join(' AND ');
}

async function salesTotals(c, f, range, companies) {
  const p = [];
  const r = (await c.query(`SELECT coalesce(sum(net_amount), 0)::text AS net, coalesce(sum(cost_amount), 0)::text AS cost,
                                   coalesce(sum(cost_known_net), 0)::text AS known,
                                   (coalesce(sum(cost_known_net), 0) - coalesce(sum(cost_amount), 0))::text AS profit
                              FROM mart.sales_day m WHERE ${where(f, p, {range, companies})}`, p)).rows[0];
  // *Text fields keep the exact NUMERIC string from PostgreSQL (raw values never pass through float).
  return {net: num(r.net), cost: num(r.cost), known: num(r.known), netText: r.net, profitText: r.profit};
}

async function distincts(c, f, companies) {
  const p = [];
  const r = (await c.query(`SELECT count(DISTINCT partner_id) AS customers, count(DISTINCT origin || ':' || doc_id) AS docs
                              FROM core.fact_sales_line m WHERE ${where(f, p, {mart: false, companies})}`, p)).rows[0];
  return {customers: Number(r.customers), docs: Number(r.docs)};
}

async function grouped(c, f, dim, companies, range = 'cur') {
  const p = [];
  const exprs = {
    unit: ['coalesce(r.unit_name, m.unit_code, \'Sin unidad\')', `LEFT JOIN LATERAL (SELECT unit_name FROM app.business_unit_rules r WHERE r.unit_code = m.unit_code AND r.source_id = m.source_id LIMIT 1) r ON true`],
    brand: ['coalesce(m.brand, \'Sin marca\')', ''],
    category: ['coalesce(p.category_name, \'Sin categoría\')', 'LEFT JOIN (SELECT DISTINCT source_id, categ_id, category_name FROM core.dim_product) p ON p.source_id = m.source_id AND p.categ_id = m.categ_id'],
    salesperson: ['coalesce(u.name, \'Sin vendedor\')', 'LEFT JOIN core.dim_user u ON u.source_id = m.source_id AND u.user_id = m.salesperson_id'],
  }[dim];
  const rows = (await c.query(`SELECT ${exprs[0]} AS name, sum(m.net_amount)::text AS net, sum(m.cost_amount)::text AS cost,
                                      sum(m.cost_known_net)::text AS known
                                 FROM mart.sales_day m ${exprs[1]} WHERE ${where(f, p, {range, companies})}
                                GROUP BY 1 ORDER BY sum(m.net_amount) DESC LIMIT 50`, p)).rows;
  return rows.map(r => ({name: r.name, net: num(r.net), cost: num(r.cost), known: num(r.known)}));
}

async function byPartner(c, f, companies, limit = 10) {
  const p = [];
  return (await c.query(`SELECT coalesce(d.name, 'Consumidor final') AS name, sum(m.net_amount)::text AS net,
                                sum(m.cost_amount)::text AS cost, sum(m.net_amount) FILTER (WHERE m.cost_amount IS NOT NULL)::text AS known,
                                count(DISTINCT m.origin || ':' || m.doc_id) AS docs, max(m.business_date)::text AS last
                           FROM core.fact_sales_line m LEFT JOIN core.dim_partner d ON d.source_id = m.source_id AND d.partner_id = m.partner_id
                          WHERE ${where(f, p, {mart: false, companies})}
                          GROUP BY 1 ORDER BY sum(m.net_amount) DESC LIMIT ${Number(limit)}`, p)).rows
    .map(r => ({name: r.name, net: num(r.net), cost: num(r.cost), known: num(r.known), docs: Number(r.docs), last: r.last}));
}

async function bySalespersonDetail(c, f, companies) {
  const p = [];
  return (await c.query(`SELECT coalesce(u.name, 'Sin vendedor') AS name, sum(m.net_amount)::text AS net, sum(m.cost_amount)::text AS cost,
                                sum(m.net_amount) FILTER (WHERE m.cost_amount IS NOT NULL)::text AS known,
                                count(DISTINCT m.partner_id) AS customers, count(DISTINCT m.origin || ':' || m.doc_id) AS docs
                           FROM core.fact_sales_line m LEFT JOIN core.dim_user u ON u.source_id = m.source_id AND u.user_id = m.salesperson_id
                          WHERE ${where(f, p, {mart: false, companies})} GROUP BY 1 ORDER BY sum(m.net_amount) DESC LIMIT 50`, p)).rows
    .map(r => ({name: r.name, net: num(r.net), cost: num(r.cost), known: num(r.known), customers: Number(r.customers), docs: Number(r.docs)}));
}

async function geography(c, f, companies) {
  const p = [];
  const rows = (await c.query(`SELECT coalesce(d.state_name, 'Sin provincia') AS province, coalesce(d.canton, 'Sin cantón') AS canton,
                                      coalesce(d.zone, 'Sin zona') AS zone, sum(m.net_amount)::text AS net,
                                      sum(m.cost_amount)::text AS cost, sum(m.net_amount) FILTER (WHERE m.cost_amount IS NOT NULL)::text AS known,
                                      count(DISTINCT m.partner_id) AS customers, count(DISTINCT m.origin || ':' || m.doc_id) AS docs
                                 FROM core.fact_sales_line m LEFT JOIN core.dim_partner d ON d.source_id = m.source_id AND d.partner_id = m.partner_id
                                WHERE ${where(f, p, {mart: false, companies})} GROUP BY 1, 2, 3`, p)).rows;
  const total = rows.reduce((s, r) => s + num(r.net), 0);
  const level = (list, key, depth) => {
    const groups = new Map();
    for (const r of list) { if (!groups.has(r[key])) groups.set(r[key], []); groups.get(r[key]).push(r); }
    return [...groups.entries()].map(([name, items]) => {
      const net = items.reduce((s, r) => s + num(r.net), 0);
      const cost = items.reduce((s, r) => s + num(r.cost), 0);
      const known = items.reduce((s, r) => s + num(r.known || 0), 0);
      // Distinct counts cannot be summed across children: approximated only at leaf level, flagged.
      const customers = items.reduce((s, r) => s + Number(r.customers), 0);
      const docs = items.reduce((s, r) => s + Number(r.docs), 0);
      return {n: name, v: Math.round(ratio(net, total) * 1000) / 10 || 0, clientes: customers, ticket: money2.format(ratio(net, docs) || 0),
        rent: fmtPct(known ? (known - cost) / known * 100 : null),
        children: depth < 2 ? level(items, depth === 0 ? 'canton' : 'zone', depth + 1) : undefined};
    }).sort((a, b) => b.v - a.v);
  };
  return {kind: 'geo', rows: level(rows, 'province', 0), note: 'Clientes por nivel superior suman clientes de niveles inferiores (puede contar un cliente en dos zonas).'};
}

async function orders(c, f, companies) {
  const p = [f.cutoff || f.to];
  const extra = [];
  if (companies) extra.push(`(o.source_id::text || ':' || o.company_id) = ANY($${p.push(companies)}::text[])`);
  if (f.salesperson) extra.push(`o.salesperson_id IN (SELECT user_id FROM core.dim_user WHERE name = $${p.push(f.salesperson)})`);
  const r = (await c.query(`SELECT coalesce(sum(pending_invoice_amount), 0)::text AS pending, coalesce(sum(backorder_amount), 0)::text AS backorder,
                                   avg($1::date - order_date) FILTER (WHERE pending_invoice_amount > 0)::text AS age,
                                   count(DISTINCT order_id) FILTER (WHERE pending_invoice_amount > 0 AND $1::date - order_date > 15) AS old
                              FROM core.fact_order_line o WHERE order_date <= $1::date ${extra.length ? 'AND ' + extra.join(' AND ') : ''}`, p)).rows[0];
  return {pending: num(r.pending), backorder: num(r.backorder), age: r.age === null ? null : num(r.age), old: Number(r.old)};
}

async function inventory(c, f, companies) {
  const p = [f.cutoff || f.to];
  const extra = companies ? `AND (i.source_id::text || ':' || i.company_id) = ANY($${p.push(companies)}::text[])` : '';
  const snap = `i.snapshot_date = (SELECT max(snapshot_date) FROM mart.inventory_day WHERE snapshot_date <= $1::date)`;
  const totals = (await c.query(`SELECT coalesce(sum(value), 0)::text AS value, count(DISTINCT product_id) FILTER (WHERE qty_internal > 0) AS skus,
                                        bool_and(value IS NOT NULL) AS valued, max(snapshot_date)::text AS snapshot
                                   FROM mart.inventory_day i WHERE ${snap} ${extra}`, p)).rows[0];
  const by = async expr => (await c.query(`SELECT ${expr} AS name, sum(i.value)::text AS value FROM mart.inventory_day i
      LEFT JOIN core.dim_product d ON d.source_id = i.source_id AND d.product_id = i.product_id WHERE ${snap} ${extra}
      GROUP BY 1 ORDER BY sum(i.value) DESC NULLS LAST LIMIT 12`, p)).rows.map(r => ({name: r.name, value: num(r.value)}));
  return {value: num(totals.value), skus: Number(totals.skus), snapshot: totals.snapshot, valued: totals.valued,
    brand: await by(`coalesce(d.brand, 'Sin marca')`), category: await by(`coalesce(d.category_name, 'Sin categoría')`)};
}

/**
 * Inventory dynamics from accounting data: delivered cost (core.fact_cost_line, the cost Odoo
 * booked at each delivery), valuation layers (value at any past date) and the current stock.
 */
async function inventoryDynamics(c, cutoff, companies, valueNow) {
  const p = [cutoff];
  const sc = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($2::text[])` : '';
  if (companies) p.push(companies);
  const one = async sql => (await c.query(sql, p)).rows[0];
  const cost = await one(`SELECT coalesce(sum(amount) FILTER (WHERE cost_date > $1::date - 365), 0)::text AS y,
                                 coalesce(sum(amount) FILTER (WHERE cost_date > $1::date - 90), 0)::text AS q
                            FROM core.fact_cost_line x WHERE amount > 0 AND cost_date <= $1::date ${sc('x')}`);
  const trend = (await c.query(`
    SELECT to_char(m, 'YYYY-MM') AS month, (SELECT coalesce(sum(v.value), 0) FROM core.fact_valuation_layer v
             WHERE v.created_at < (m + interval '1 month') ${sc('v')})::text AS value
      FROM generate_series(date_trunc('month', $1::date) - interval '11 months', date_trunc('month', $1::date), interval '1 month') m
     ORDER BY m`, p)).rows.map(r => ({month: r.month, value: num(r.value)}))
    .filter((t, i, all) => all.slice(0, i + 1).some(x => x.value > 0)); // history starts at the first valued month
  const at30 = await one(`SELECT coalesce(sum(value), 0)::text AS v FROM core.fact_valuation_layer x WHERE x.created_at < ($1::date - 29) ${sc('x')}`);
  const avg = trend.length ? trend.reduce((s, t) => s + t.value, 0) / trend.length : null;
  const yCost = num(cost.y), qCost = num(cost.q);
  const rotation = avg ? yCost / avg : null;
  const coverage = qCost ? valueNow / (qCost / 90) : null;
  const value30 = num(at30.v);
  // Per product: current stock and value, delivered cost and sales (12 months), last delivery.
  const products = (await c.query(`
    WITH stock AS (SELECT i.source_id, i.product_id, sum(i.qty_internal) AS qty, sum(i.value) AS value FROM mart.inventory_day i
                    WHERE i.snapshot_date = (SELECT max(snapshot_date) FROM mart.inventory_day WHERE snapshot_date <= $1::date) ${sc('i')}
                    GROUP BY 1, 2 HAVING sum(i.qty_internal) > 0),
         del AS (SELECT x.source_id, x.product_id, sum(x.amount) FILTER (WHERE x.cost_date > $1::date - 365) AS cost, max(x.cost_date) AS last
                   FROM core.fact_cost_line x WHERE x.amount > 0 AND x.cost_date <= $1::date ${sc('x')} GROUP BY 1, 2),
         sal AS (SELECT s.source_id, s.product_id, sum(s.net_amount) AS sales FROM core.fact_sales_line s
                  WHERE s.business_date > $1::date - 365 AND s.business_date <= $1::date ${sc('s')} GROUP BY 1, 2)
    SELECT coalesce(d.name, 'Producto ' || st.product_id) AS name, coalesce(d.category_name, 'Sin categoría') AS category,
           st.qty::text AS qty, coalesce(st.value, 0)::text AS value, coalesce(del.cost, 0)::text AS cost, coalesce(sal.sales, 0)::text AS sales,
           CASE WHEN del.last IS NULL THEN 9999 ELSE $1::date - del.last END AS days
      FROM stock st LEFT JOIN del USING (source_id, product_id) LEFT JOIN sal USING (source_id, product_id)
      LEFT JOIN core.dim_product d ON d.source_id = st.source_id AND d.product_id = st.product_id`, p)).rows
    .map(r => ({name: r.name, category: r.category, qty: num(r.qty), value: num(r.value), cost: num(r.cost), sales: num(r.sales), days: Number(r.days)}));
  // Rotation per product only with meaningful stock (>= $100): a near-zero stock makes the ratio meaningless.
  const valued = products.filter(x => x.value >= 100).map(x => ({...x, rot: x.cost / x.value}));
  const stale = products.filter(x => x.days >= 180 && x.value > 0);
  const obsolete = stale.reduce((s, x) => s + x.value, 0);
  const byCat = {};
  for (const x of stale) byCat[x.category] = (byCat[x.category] || 0) + x.value;
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  return {
    rotation, coverage, value30, variation: value30 ? (valueNow - value30) / value30 * 100 : null,
    obsolete, obsoletePct: valueNow ? obsolete / valueNow * 100 : null,
    topObsCategory: topCat ? {name: topCat[0], value: topCat[1]} : null,
    top: [...valued].sort((a, b) => b.rot - a.rot).slice(0, 5),
    bottom: [...valued].sort((a, b) => a.rot - b.rot || b.value - a.value).slice(0, 5),
    action: products.filter(x => x.days >= 90 && x.value > 0).sort((a, b) => b.value - a.value).slice(0, 10),
    trend,
  };
}

/** Logística: outgoing deliveries (core.fact_picking) and delivered lines/cost (core.fact_cost_line). */
async function logistics(c, f, companies) {
  const p = [f.from, f.to, f.prevFrom, f.prevTo, f.cutoff || f.to];
  const sc = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($6::text[])` : '';
  if (companies) p.push(companies);
  const q = async sql => (await c.query(`SELECT * FROM (${sql}) z WHERE ($1::date, $2::date, $3::date, $4::date, $5::date) IS NOT NULL`, p)).rows;
  const out = `pk.type_code = 'outgoing'`;
  const k = (await q(`SELECT count(*) FILTER (WHERE state = 'done' AND done_date BETWEEN $1 AND $2) AS done,
        count(*) FILTER (WHERE state = 'done' AND done_date BETWEEN $3 AND $4) AS prev,
        count(*) FILTER (WHERE state NOT IN ('done', 'cancel', 'draft')) AS pending,
        count(*) FILTER (WHERE state NOT IN ('done', 'cancel', 'draft') AND coalesce(deadline_date, scheduled_date) < $5) AS late,
        count(*) FILTER (WHERE state = 'done' AND done_date BETWEEN $1 AND $2 AND NOT in_full) AS partial,
        avg(done_date - order_date) FILTER (WHERE state = 'done' AND done_date BETWEEN $1 AND $2 AND order_date IS NOT NULL AND done_date >= order_date)::text AS lead,
        (count(*) FILTER (WHERE state = 'done' AND done_date BETWEEN $1 AND $2 AND in_full AND done_date <= coalesce(deadline_date, scheduled_date))::numeric
          / nullif(count(*) FILTER (WHERE state = 'done' AND done_date BETWEEN $1 AND $2), 0) * 100)::text AS otif
      FROM core.fact_picking pk WHERE ${out} ${sc('pk')}`))[0];
  const lines = (await q(`SELECT count(*) AS lines, count(DISTINCT product_id) AS skus, coalesce(sum(amount), 0)::text AS value
      FROM core.fact_cost_line x WHERE x.amount > 0 AND x.cost_date BETWEEN $1 AND $2 ${sc('x')}`))[0];
  const trend = (await q(`SELECT to_char(m, 'YYYY-MM') AS month, (SELECT count(*) FROM core.fact_picking pk WHERE ${out} AND pk.state = 'done'
        AND pk.done_date >= m AND pk.done_date < m + interval '1 month' ${sc('pk')}) AS count
      FROM generate_series(date_trunc('month', $5::date) - interval '11 months', date_trunc('month', $5::date), interval '1 month') m ORDER BY m`))
    .map(r => ({month: r.month, count: Number(r.count)})).filter((t, i, all) => all.slice(0, i + 1).some(x => x.count > 0));
  const by = async expr => (await q(`SELECT ${expr} AS name, count(*) AS count FROM core.fact_picking pk
      LEFT JOIN core.dim_partner d ON d.source_id = pk.source_id AND d.partner_id = pk.partner_id
     WHERE ${out} AND pk.state = 'done' AND pk.done_date BETWEEN $1 AND $2 ${sc('pk')} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`))
    .map(r => ({name: r.name, count: Number(r.count)}));
  const done = Number(k.done);
  const span = Math.max(1, Math.round((new Date(`${f.to}T00:00:00Z`) - new Date(`${f.from}T00:00:00Z`)) / 86400000) + 1);
  return {done, prevDone: Number(k.prev), pending: Number(k.pending), late: Number(k.late), partial: Number(k.partial),
    leadDays: num(k.lead), otif: num(k.otif), perDay: done ? done / span : null,
    lines: Number(lines.lines), skus: Number(lines.skus), value: num(lines.value), trend,
    province: await by(`coalesce(d.state_name, 'Sin provincia')`), zone: await by(`coalesce(d.zone, d.city, 'Sin zona')`)};
}

/** Compras: confirmed purchase lines, receipts and the stock coverage that drives replenishment. */
async function purchases(c, f, companies) {
  const p = [f.from, f.to, f.prevFrom, f.prevTo, f.cutoff || f.to];
  const sc = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($6::text[])` : '';
  if (companies) p.push(companies);
  const cat = f.category ? `AND pl.product_id IN (SELECT product_id FROM core.dim_product WHERE category_name = $${p.push(f.category)})` : '';
  // Every query receives the same parameter list; PostgreSQL requires each one to be referenced
  // (and typed), so each query is wrapped with a predicate that names the five dates.
  const q = async sql => (await c.query(`SELECT * FROM (${sql}) z WHERE ($1::date, $2::date, $3::date, $4::date, $5::date) IS NOT NULL`, p)).rows;
  const tot = (await q(`SELECT coalesce(sum(amount) FILTER (WHERE approve_date BETWEEN $1 AND $2), 0)::text AS cur,
                               coalesce(sum(amount) FILTER (WHERE approve_date BETWEEN $3 AND $4), 0)::text AS prev
                          FROM core.fact_purchase_line pl WHERE true ${sc('pl')} ${cat}`))[0];
  const perf = (await q(`SELECT sum(qty_received) FILTER (WHERE planned_date BETWEEN $1 AND $2 AND planned_date <= $5)::text AS rec,
                                sum(qty) FILTER (WHERE planned_date BETWEEN $1 AND $2 AND planned_date <= $5)::text AS ord,
                                coalesce(sum(CASE WHEN qty > qty_received THEN (qty - qty_received) * amount / nullif(qty, 0) END)
                                  FILTER (WHERE coalesce(receipt_status, '') <> 'full'), 0)::text AS back,
                                count(DISTINCT order_id) FILTER (WHERE coalesce(receipt_status, '') <> 'full' AND qty > qty_received) AS back_orders,
                                count(DISTINCT product_id) FILTER (WHERE coalesce(receipt_status, '') <> 'full' AND qty > qty_received) AS transit
                           FROM core.fact_purchase_line pl WHERE approve_date <= $5 ${sc('pl')} ${cat}`))[0];
  const lead = (await q(`SELECT avg(receipt_date - approve_date)::text AS d FROM (SELECT DISTINCT order_id, approve_date, receipt_date
                           FROM core.fact_purchase_line pl WHERE receipt_date BETWEEN $1 AND $2 AND receipt_date >= approve_date ${sc('pl')} ${cat}) o`))[0];
  const vendors = (await q(`SELECT coalesce(d.name, 'Proveedor ' || pl.partner_id) AS name, sum(pl.amount) FILTER (WHERE pl.approve_date BETWEEN $1 AND $2) AS value,
                                   sum(pl.qty_received) FILTER (WHERE pl.planned_date BETWEEN $1 AND $2 AND pl.planned_date <= $5)
                                     / nullif(sum(pl.qty) FILTER (WHERE pl.planned_date BETWEEN $1 AND $2 AND pl.planned_date <= $5), 0) * 100 AS fill,
                                   avg(pl.receipt_date - pl.approve_date) FILTER (WHERE pl.receipt_date BETWEEN $1 AND $2 AND pl.receipt_date >= pl.approve_date) AS lead,
                                   coalesce(sum(CASE WHEN pl.qty > pl.qty_received AND coalesce(pl.receipt_status, '') <> 'full'
                                                     THEN (pl.qty - pl.qty_received) * pl.amount / nullif(pl.qty, 0) END), 0) AS back
                              FROM core.fact_purchase_line pl LEFT JOIN core.dim_partner d ON d.source_id = pl.source_id AND d.partner_id = pl.partner_id
                             WHERE pl.approve_date <= $5 ${sc('pl')} ${cat} GROUP BY 1 HAVING sum(pl.amount) FILTER (WHERE pl.approve_date BETWEEN $1 AND $2) > 0
                             ORDER BY 2 DESC LIMIT 20`)).map(r => ({name: r.name, value: num(r.value), fill: num(r.fill), lead: num(r.lead), back: num(r.back)}));
  const group = async expr => (await q(`SELECT ${expr} AS name, sum(pl.amount)::text AS value FROM core.fact_purchase_line pl
      LEFT JOIN core.dim_product d ON d.source_id = pl.source_id AND d.product_id = pl.product_id
     WHERE pl.approve_date BETWEEN $1 AND $2 ${sc('pl')} ${cat} GROUP BY 1 ORDER BY sum(pl.amount) DESC LIMIT 12`)).map(r => ({name: r.name, value: num(r.value)}));
  const trend = (await q(`SELECT to_char(m, 'YYYY-MM') AS month, (SELECT coalesce(sum(pl.amount), 0) FROM core.fact_purchase_line pl
       WHERE pl.approve_date >= m AND pl.approve_date < m + interval '1 month' ${sc('pl')} ${cat})::text AS value
      FROM generate_series(date_trunc('month', $5::date) - interval '11 months', date_trunc('month', $5::date), interval '1 month') m ORDER BY m`))
    .map(r => ({month: r.month, value: num(r.value)})).filter((t, i, all) => all.slice(0, i + 1).some(x => x.value > 0));
  // Coverage per product: stock quantity / daily delivered quantity of the last 30 days.
  const cov = (await q(`
    WITH stock AS (SELECT i.source_id, i.product_id, sum(i.qty_internal) AS qty, sum(i.value) AS value FROM mart.inventory_day i
                    WHERE i.snapshot_date = (SELECT max(snapshot_date) FROM mart.inventory_day WHERE snapshot_date <= $5::date) ${sc('i')}
                    GROUP BY 1, 2 HAVING sum(i.qty_internal) > 0),
         out AS (SELECT x.source_id, x.product_id, sum(abs(x.quantity)) / 30.0 AS daily FROM core.fact_cost_line x
                  WHERE x.amount > 0 AND x.cost_date > $5::date - 30 AND x.cost_date <= $5::date ${sc('x')} GROUP BY 1, 2)
    SELECT count(*) FILTER (WHERE o.daily > 0 AND s.qty / o.daily < 7) AS risk,
           count(*) FILTER (WHERE o.daily > 0 AND s.qty / o.daily > 120) AS over,
           -- Same definition as Inventarios: total stock value / daily delivered cost (here, last 30 days).
           (sum(coalesce(s.value, 0)) / nullif((SELECT sum(x.amount) FROM core.fact_cost_line x WHERE x.amount > 0
              AND x.cost_date > $5::date - 30 AND x.cost_date <= $5::date ${sc('x')}) / 30.0, 0))::text AS coverage
      FROM stock s LEFT JOIN out o USING (source_id, product_id)`))[0];
  return {total: num(tot.cur), prev: num(tot.prev), fill: perf.ord && num(perf.ord) ? num(perf.rec) / num(perf.ord) * 100 : null,
    lead: num(lead.d), backValue: num(perf.back), backOrders: Number(perf.back_orders), transit: Number(perf.transit),
    vendors, brand: await group(`coalesce(d.brand, 'Sin marca')`), category: await group(`coalesce(d.category_name, 'Sin categoría')`),
    trend, risk: Number(cov.risk), over: Number(cov.over), coverage: num(cov.coverage)};
}

export async function receivableSummary(c, cutoff, companies) {
  const p = [cutoff];
  const extra = companies ? `AND (r.source_id::text || ':' || r.company_id) = ANY($${p.push(companies)}::text[])` : '';
  const row = (await c.query(`SELECT max(snapshot_date)::text AS snapshot, coalesce(sum(residual), 0)::text AS residual,
                                     coalesce(sum(overdue), 0)::text AS overdue, coalesce(sum(b0_30), 0)::text AS b0_30,
                                     coalesce(sum(b31_60), 0)::text AS b31_60, coalesce(sum(b61_90), 0)::text AS b61_90,
                                     coalesce(sum(b90p), 0)::text AS b90p, coalesce(sum(items), 0) AS items
                                FROM mart.receivable_day r
                               WHERE r.snapshot_date = (SELECT max(snapshot_date) FROM mart.receivable_day WHERE snapshot_date <= $1::date) ${extra}`, p)).rows[0];
  return row;
}

const kpi = (value, display, deltas = [], extra = {}) => ({kind: 'kpi', raw: value === null ? null : String(value), value: display, deltas, ...extra});
const missing = reason => ({kind: 'missing', reason});
const bars = rows => {
  const max = Math.max(1, ...rows.map(r => Math.abs(r.v)));
  return rows.map(r => ({n: r.n, v: Math.round(r.v / max * 1000) / 10, vt: r.vt}));
};

const NO_BUDGET = 'Sin presupuesto cargado: fuente de metas pendiente de definir con JUJ.';
const NO_ISE = 'Fórmula ISE (rangos, pesos, faltantes) pendiente de aprobación.';
const NO_AI = 'Resumen automático pendiente del backend IA/MCP (F7).';
const NO_RULES = 'Hallazgos automáticos pendientes: requieren métricas aprobadas y umbrales por tenant.';

/** Build every bound widget of a page. Unbound blocks are reported as missing (never demo numbers). */
export async function buildReport(c, pageId, filters, {companies = null, blocks = []} = {}) {
  const w = {};
  const f = filters;
  const needSales = ['nivel1', 'comercial', 'financiero', 'clientes', ...Object.keys(UNIT_PAGES)].includes(pageId);
  if (needSales) {
    const cur = await salesTotals(c, f, 'cur', companies);
    const prev = await salesTotals(c, f, 'prev', companies);
    const g = growth(cur.net, prev.net);
    const marginPct = cur.known ? (cur.known - cur.cost) / cur.known * 100 : null;
    const coverage = cur.net ? cur.known / cur.net * 100 : null;
    const partial = coverage !== null && coverage < 99.5 ? `Costo conocido para ${coverage.toFixed(0)}% de la venta` : undefined;
    // Same split as Odoo's invoice list: published invoices − credit notes (cancelled never count).
    const sp = [];
    const split = (await c.query(`SELECT coalesce(sum(s.net_amount) FILTER (WHERE s.net_amount > 0), 0)::text AS inv,
        coalesce(sum(s.net_amount) FILTER (WHERE s.net_amount < 0), 0)::text AS nc
      FROM core.fact_sales_line s WHERE ${where(f, sp, {alias: 's', mart: false, companies})}`, sp)).rows[0];
    const periodTxt = `${f.from.split('-').reverse().join('/')} al ${f.to.split('-').reverse().join('/')}`;
    const salesKpi = kpi(cur.netText, fmtMoney(cur.net), [{label: 'vs año anterior', value: signed(g), tone: toneOf(g)}],
      {metric: 'sales_net', note: `${periodTxt} · facturas ${fmtMoney(num(split.inv))} − notas de crédito ${fmtMoney(Math.abs(num(split.nc)))}`});
    const marginKpi = kpi(marginPct === null ? null : marginPct.toFixed(2), fmtPct(marginPct), [], {metric: 'gross_margin_pct', note: partial});
    const profit = cur.known ? cur.known - cur.cost : null;
    const d = await distincts(c, f, companies);
    const ticket = ratio(cur.net, d.docs);
    const units = async () => {
      const curU = await grouped(c, f, 'unit', companies);
      const prevU = new Map((await grouped(c, f, 'unit', companies, 'prev')).map(r => [r.name, r]));
      return curU.map(u => ({...u, prev: prevU.get(u.name)?.net ?? null}));
    };
    if (pageId === 'nivel1') {
      Object.assign(w, {
        'nivel1-01': salesKpi, 'nivel1-02': missing(NO_BUDGET),
        'nivel1-03': kpi(cur.known ? cur.profitText : null, fmtMoney(profit), [], {metric: 'gross_profit', note: partial}),
        'nivel1-04': marginKpi, 'nivel1-05': marginKpi, 'nivel1-06': missing(NO_ISE),
        'nivel1-07': {kind: 'table', rows: (await units()).map(u => [u.name, fmtMoney(u.net), '—', fmtMoney(u.prev), signed(growth(u.net, u.prev)),
          fmtPct(u.known ? (u.known - u.cost) / u.known * 100 : null), '—'])},
        'nivel1-08': missing(NO_ISE), 'nivel1-09': missing(NO_ISE), 'nivel1-10': missing(NO_RULES), 'nivel1-11': missing(NO_RULES),
        'nivel1-12': missing(NO_RULES), 'nivel1-13': missing('Estado por centro requiere umbrales evaluados en servidor.'),
      });
    }
    if (pageId === 'comercial') {
      const o = await orders(c, f, companies);
      const brands = await grouped(c, f, 'brand', companies);
      const prevBrands = new Map((await grouped(c, f, 'brand', companies, 'prev')).map(r => [r.name, r.net]));
      const cats = await grouped(c, f, 'category', companies);
      const share = list => bars(list.map(r => ({n: r.name, v: r.net, vt: fmtPct(ratio(r.net, cur.net) * 100)})));
      const top = await byPartner(c, f, companies, 10);
      const sellers = await bySalespersonDetail(c, f, companies);
      Object.assign(w, {
        'comercial-01': salesKpi, 'comercial-02': missing(NO_BUDGET), 'comercial-03': marginKpi,
        'comercial-04': kpi(d.customers, int.format(d.customers), [], {metric: 'customers_invoiced'}),
        'comercial-05': kpi(ticket === null ? null : ticket.toFixed(2), ticket === null ? '—' : money2.format(ticket), [], {metric: 'ticket_avg'}),
        'comercial-06': missing(NO_ISE),
        'comercial-07': kpi(o.pending, fmtMoney(o.pending), [], {metric: 'orders_pending_invoice'}),
        'comercial-08': kpi(o.backorder, fmtMoney(o.backorder), [], {metric: 'backorder_value'}),
        'comercial-09': kpi(o.age, o.age === null ? '—' : `${o.age.toFixed(0)} días`, [], {metric: 'pending_age_days'}),
        'comercial-10': kpi(o.old, int.format(o.old), [], {metric: 'orders_pending_15d'}),
        'comercial-11': {kind: 'table', rows: (await units()).map(u => [u.name, fmtMoney(u.net), signed(growth(u.net, u.prev)),
          fmtPct(u.known ? (u.known - u.cost) / u.known * 100 : null), '—'])},
        'comercial-12': {kind: 'toggle', data: {Marca: share(brands), 'Categoría': share(cats), 'Subcategoría': [], SKU: []},
          note: 'Subcategoría y SKU requieren jerarquía de categorías validada.'},
        'comercial-13': {kind: 'toggle', data: {
          Ventas: bars(brands.map(b => ({n: b.name, v: b.net, vt: fmtMoney(b.net)}))),
          Rentabilidad: bars(brands.filter(b => b.known).map(b => ({n: b.name, v: b.known - b.cost, vt: fmtMoney(b.known - b.cost)}))),
          Crecimiento: bars(brands.map(b => { const gr = growth(b.net, prevBrands.get(b.name) ?? null); return {n: b.name, v: gr ?? 0, vt: signed(gr)}; })),
          Margen: bars(brands.filter(b => b.known).map(b => { const m = (b.known - b.cost) / b.known * 100; return {n: b.name, v: m, vt: fmtPct(m)}; })),
        }},
        'comercial-14': {kind: 'table', rows: sellers.map(s => [s.name, fmtMoney(s.net), '—', '—',
          fmtPct(s.known ? (s.known - s.cost) / s.known * 100 : null), int.format(s.customers), money2.format(ratio(s.net, s.docs) || 0)])},
        'comercial-15': await geography(c, f, companies),
        'comercial-16': {kind: 'table', rows: top.map(t => [t.name, fmtMoney(t.net), fmtPct(t.known ? (t.known - t.cost) / t.known * 100 : null),
          money2.format(ratio(t.net, t.docs) || 0), fmtPct(ratio(t.net, cur.net) * 100)])},
        'comercial-17': missing(NO_AI), 'comercial-18': missing(NO_RULES),
      });
    }
    if (pageId === 'financiero') {
      // What the published data already answers: gross profit from the cost Odoo books at each
      // delivery, inventory turnover, receivable turnover. Expenses, EBITDA, balance-sheet ratios
      // and payables need the full ledger and the company's account mapping (still pending).
      const cutoff = f.cutoff || f.to;
      const invNow = await inventory(c, f, companies);
      const dyn = await inventoryDynamics(c, cutoff, companies, invNow.value);
      const rp = [cutoff];
      const rsc = companies ? `AND (r.source_id::text || ':' || r.company_id) = ANY($2::text[])` : '';
      const ssc = companies ? `AND (s.source_id::text || ':' || s.company_id) = ANY($2::text[])` : '';
      if (companies) rp.push(companies);
      const rec = (await c.query(`SELECT coalesce(sum(r.residual) FILTER (WHERE r.residual > 0), 0)::text AS debt,
          (SELECT coalesce(sum(s.net_amount), 0) FROM core.fact_sales_line s WHERE s.business_date > $1::date - 365 AND s.business_date <= $1::date ${ssc})::text AS sales
        FROM core.fact_receivable_item r WHERE r.doc_date <= $1::date ${rsc}`, rp)).rows[0];
      const arTurn = num(rec.debt) ? num(rec.sales) / num(rec.debt) : null;
      const metric = (value, raw, note) => ({kind: 'metric', value, raw: raw === null || raw === undefined ? null : String(raw), deltas: [], note});
      Object.assign(w, {
        'financiero-01': salesKpi,
        'financiero-02': kpi(profit, fmtMoney(profit), [{label: '% s/ventas', value: fmtPct(marginPct), tone: ''}],
          {metric: 'gross_profit', note: 'Venta facturada − costo contabilizado en cada entrega'}),
        'financiero-07': metric(fmtPct(marginPct), marginPct, 'Utilidad bruta ÷ venta con costo'),
        'financiero-19': metric(dyn.rotation === null ? '—' : `${dyn.rotation.toFixed(1)}x`, dyn.rotation, 'Costo entregado 12 meses ÷ inventario promedio'),
        'financiero-23': metric(dyn.rotation ? `${int.format(365 / dyn.rotation)} días` : '—', dyn.rotation ? 365 / dyn.rotation : null, 'Días de inventario (365 ÷ rotación)'),
        'financiero-20': metric(arTurn === null ? '—' : `${arTurn.toFixed(1)}x`, arTurn, 'Venta 12 meses ÷ cartera por cobrar a clientes'),
        'financiero-24': metric(arTurn ? `${int.format(365 / arTurn)} días cobro` : '—', arTurn ? 365 / arTurn : null,
          'Días promedio de cobro (pago a proveedores: pendiente de cuentas por pagar)'),
      });
    }
    if (pageId === 'clientes') {
      const ranking = await byPartner(c, f, companies, 25);
      Object.assign(w, {
        'clientes-01': kpi(d.customers, int.format(d.customers), [], {metric: 'customers_invoiced'}),
        'clientes-05': kpi(ticket === null ? null : ticket.toFixed(2), ticket === null ? '—' : money2.format(ticket), [], {metric: 'ticket_avg'}),
        'clientes-11': {kind: 'table', rows: ranking.map(r => [r.name, fmtMoney(r.net), int.format(r.docs), r.last])},
        'clientes-08': await geography(c, f, companies),
      });
    }
    if (UNIT_PAGES[pageId]) {
      Object.assign(w, {
        [`${pageId}-01`]: salesKpi.kind === 'kpi' ? {...salesKpi, kind: 'metric'} : salesKpi,
        [`${pageId}-02`]: missing(NO_BUDGET),
        [`${pageId}-03`]: {...marginKpi, kind: 'metric'},
        [`${pageId}-04`]: missing('Punto de equilibrio requiere gastos fijos por unidad (mapeo contable pendiente).'),
      });
    }
  }
  if (pageId === 'logistica') {
    const lg = await logistics(c, f, companies);
    const growth = lg.prevDone ? (lg.done - lg.prevDone) / lg.prevDone * 100 : null;
    const days = d => (d === null || !Number.isFinite(d) ? '—' : `${d.toFixed(1)} días`);
    Object.assign(w, {
      'logistica-01': kpi(lg.done, int.format(lg.done), [{label: 'Año Ant.', value: lg.prevDone ? `${int.format(lg.prevDone)} (${fmtPct(growth)})` : '—', tone: ''}],
        {metric: 'deliveries_done', note: 'Despachos a clientes validados en el período'}),
      'logistica-02': kpi(lg.pending, int.format(lg.pending), [{label: 'Retrasados', value: int.format(lg.late), tone: lg.late ? 'down' : ''}],
        {metric: 'deliveries_pending', note: 'Despachos abiertos al cierre'}),
      'logistica-03': kpi(lg.leadDays === null ? null : lg.leadDays.toFixed(1), days(lg.leadDays), [], {metric: 'dispatch_time',
        note: 'Del pedido de venta al despacho validado'}),
      'logistica-06': kpi(lg.otif === null ? null : lg.otif.toFixed(2), fmtPct(lg.otif), [], {metric: 'otif',
        note: 'Validados a tiempo (fecha límite o programada) y completos (sin entrega parcial)'}),
      'logistica-07': {kind: 'bars', rows: bars(lg.trend.map(t => ({n: t.month, v: t.count, vt: int.format(t.count)})))},
      'logistica-09': {kind: 'bars', rows: bars(lg.province.map(t => ({n: t.name, v: t.count, vt: int.format(t.count)})))},
      'logistica-10': {kind: 'bars', rows: bars(lg.zone.map(t => ({n: t.name, v: t.count, vt: int.format(t.count)})))},
      'logistica-12': {kind: 'table', rows: [['Despachados en el período', int.format(lg.done)], ['Pendientes', int.format(lg.pending)],
        ['Retrasados (vencidos sin despachar)', int.format(lg.late)], ['Parciales (con saldo pendiente)', int.format(lg.partial)]]},
      'logistica-13': {kind: 'metric', value: lg.perDay === null ? '—' : lg.perDay.toFixed(1), raw: lg.perDay === null ? null : String(lg.perDay), deltas: [],
        note: 'Despachos validados por día del período'},
      'logistica-14': {kind: 'metric', value: int.format(lg.lines), raw: String(lg.lines), deltas: [], note: 'Líneas de producto entregadas en el período'},
      'logistica-15': {kind: 'metric', value: int.format(lg.skus), raw: String(lg.skus), deltas: [], note: 'Productos distintos entregados'},
      'logistica-16': {kind: 'metric', value: fmtMoney(lg.value), raw: String(lg.value), deltas: [], note: 'A costo contable de la entrega'},
    });
  }
  if (pageId === 'compras') {
    const pu = await purchases(c, f, companies);
    const days = d => (d === null || !Number.isFinite(d) ? '—' : `${d.toFixed(1)} días`);
    const growth = pu.prev ? (pu.total - pu.prev) / pu.prev * 100 : null;
    Object.assign(w, {
      'compras-01': kpi(pu.total, fmtMoney(pu.total), [{label: 'Año Ant.', value: fmtMoney(pu.prev), tone: ''},
        {label: 'Crecim.', value: fmtPct(growth), tone: growth === null ? '' : growth > 0 ? 'down' : 'up'}], {metric: 'purchases_total'}),
      'compras-02': kpi(pu.fill === null ? null : pu.fill.toFixed(2), fmtPct(pu.fill), [], {metric: 'supplier_fill_rate',
        note: 'Recibido ÷ pedido en líneas con fecha prevista ya cumplida'}),
      'compras-03': kpi(pu.lead === null ? null : pu.lead.toFixed(1), days(pu.lead), [], {metric: 'supplier_lead_time',
        note: 'Aprobación de la orden → primera recepción'}),
      'compras-04': kpi(pu.backOrders, int.format(pu.backOrders), [{label: 'Valor', value: fmtMoney(pu.backValue), tone: ''}],
        {metric: 'purchase_backorders', note: 'Órdenes con recepción pendiente o parcial'}),
      'compras-06': {kind: 'bars', rows: bars(pu.brand.map(b => ({n: b.name, v: b.value, vt: fmtMoney(b.value)})))},
      'compras-07': {kind: 'bars', rows: bars(pu.vendors.slice(0, 10).map(b => ({n: b.name, v: b.value, vt: fmtMoney(b.value)})))},
      'compras-08': {kind: 'bars', rows: bars(pu.category.map(b => ({n: b.name, v: b.value, vt: fmtMoney(b.value)})))},
      'compras-10': {kind: 'table', rows: pu.vendors.slice(0, 15).map(v => [v.name, fmtMoney(v.value), fmtPct(pu.total ? v.value / pu.total * 100 : null),
        fmtPct(v.fill), days(v.lead), fmtMoney(v.back)])},
      'compras-11': {kind: 'metric', value: int.format(pu.risk), raw: String(pu.risk), deltas: [], note: 'Con existencia para menos de 7 días al ritmo de los últimos 30'},
      'compras-13': {kind: 'metric', value: int.format(pu.transit), raw: String(pu.transit), deltas: [], note: 'SKU con unidades por recibir'},
      'compras-14': {kind: 'metric', value: int.format(pu.over), raw: String(pu.over), deltas: [], note: 'Con existencia para más de 120 días'},
      'compras-15': {kind: 'metric', value: days(pu.coverage), raw: pu.coverage === null ? null : String(pu.coverage), deltas: [],
        note: 'Valor del inventario ÷ costo diario entregado (últimos 30 días)'},
      'compras-17': {kind: 'bars', rows: bars(pu.trend.map(t => ({n: t.month, v: t.value, vt: fmtMoney(t.value)})))},
    });
  }
  if (pageId === 'inventarios') {
    const inv = await inventory(c, f, companies);
    const adv = await inventoryDynamics(c, f.cutoff || f.to, companies, inv.value);
    const dayTxt = d => (d === null || !Number.isFinite(d) ? '—' : `${int.format(d)} días`);
    Object.assign(w, {
      'inventarios-02': kpi(adv.rotation === null ? null : adv.rotation.toFixed(2), adv.rotation === null ? '—' : `${adv.rotation.toFixed(1)}x`,
        [{label: 'Días', value: dayTxt(adv.rotation ? 365 / adv.rotation : null), tone: ''}],
        {metric: 'inventory_turnover', note: 'Costo de lo entregado en 12 meses ÷ inventario promedio de 12 meses'}),
      'inventarios-03': kpi(adv.coverage === null ? null : adv.coverage.toFixed(0), dayTxt(adv.coverage), [],
        {metric: 'inventory_coverage_days', note: 'Valor del inventario ÷ costo diario entregado (últimos 90 días)'}),
      'inventarios-04': kpi(adv.variation === null ? null : adv.variation.toFixed(2), fmtPct(adv.variation),
        [{label: 'vs. hace 30 días', value: fmtMoney(adv.value30), tone: adv.variation > 0 ? 'down' : 'up'}], {metric: 'inventory_variation'}),
      'inventarios-06': kpi(adv.obsolete, fmtMoney(adv.obsolete), [{label: '% del total', value: fmtPct(adv.obsoletePct), tone: 'down'}],
        {metric: 'inventory_obsolete', note: 'Productos con existencia y sin ninguna entrega en 180 días'}),
      'inventarios-11': {kind: 'table', rows: adv.top.map(r => [r.name, int.format(r.qty), fmtMoney(r.sales), `${r.rot.toFixed(1)}x`])},
      'inventarios-12': {kind: 'table', rows: adv.bottom.map(r => [r.name, int.format(r.qty), fmtMoney(r.sales), `${r.rot.toFixed(1)}x`])},
      'inventarios-13': {kind: 'table', rows: adv.action.map(r => [r.days >= 180 ? 'Sin movimiento +180d' : 'Lento +90d', r.name,
        r.days >= 9999 ? 'Nunca entregado' : int.format(r.days), fmtMoney(r.value)])},
      'inventarios-14': {kind: 'metric', value: fmtMoney(adv.obsolete), raw: String(adv.obsolete), deltas: [], note: `${fmtPct(adv.obsoletePct)} del inventario total`},
      'inventarios-15': {kind: 'metric', value: fmtPct(adv.obsoletePct), raw: String(adv.obsoletePct), deltas: [], note: 'Inventario inmovilizado sobre el total'},
      'inventarios-17': {kind: 'metric', value: adv.topObsCategory?.name || '—', raw: null, deltas: [],
        note: adv.topObsCategory ? `${fmtMoney(adv.topObsCategory.value)} inmovilizados` : ''},
      'inventarios-18': {kind: 'bars', rows: bars(adv.trend.map(t => ({n: t.month, v: t.value, vt: fmtMoney(t.value)})))},
      'inventarios-01': kpi(inv.value, fmtMoney(inv.value), [], {metric: 'inventory_value',
        note: inv.snapshot ? `Corte ${inv.snapshot}${inv.valued ? '' : ' · productos sin valoración'}` : 'Sin corte publicado'}),
      'inventarios-05': kpi(inv.skus, int.format(inv.skus), [], {metric: 'sku_active'}),
      'inventarios-07': {kind: 'bars', rows: bars(inv.brand.map(b => ({n: b.name, v: b.value || 0, vt: fmtMoney(b.value)})))},
      'inventarios-09': {kind: 'bars', rows: bars(inv.category.map(b => ({n: b.name, v: b.value || 0, vt: fmtMoney(b.value)})))},
    });
  }
  for (const b of blocks) if (!w[b.id]) w[b.id] = missing('Sin fuente conectada para este indicador (ver matriz de bloques).');
  return w;
}

/**
 * Current value of each threshold rule that published data can answer, at the close date.
 * Rules without a source (liquidity, SLA, rotation...) are absent: the panel shows them as
 * "sin dato" and never raises an alert from a guessed number.
 */
export async function thresholdValues(c, businessDate, companies = null) {
  const p = [businessDate];
  const scope = alias => companies ? `AND (${alias}.source_id::text || ':' || ${alias}.company_id) = ANY($${p.length + 1}::text[])` : '';
  if (companies) p.push(companies);
  const month = (await c.query(`
    SELECT coalesce(sum(s.net_amount), 0)::text AS net, count(DISTINCT s.origin || ':' || s.doc_id) AS docs
      FROM core.fact_sales_line s
     WHERE s.business_date >= date_trunc('month', $1::date) AND s.business_date <= $1::date ${scope('s')}`, p)).rows[0];
  const top = (await c.query(`
    WITH y AS (SELECT s.partner_id, sum(s.net_amount) AS net FROM core.fact_sales_line s
                WHERE s.business_date >= date_trunc('year', $1::date) AND s.business_date <= $1::date ${scope('s')} GROUP BY 1)
    SELECT (SELECT sum(net) FROM (SELECT net FROM y ORDER BY net DESC LIMIT 3) t)::text AS top3, sum(net)::text AS total FROM y`, p)).rows[0];
  // Overdue share of what customers OWE: debts only (positive residual), past due by maturity
  // or, without one, by document date (as Odoo's aged receivable). Unapplied credits/advances
  // (negative residual) are not debt and would make the percentage meaningless.
  const rec = (await c.query(`
    SELECT coalesce(sum(r.residual) FILTER (WHERE r.residual > 0), 0)::text AS debt,
           coalesce(sum(r.residual) FILTER (WHERE r.residual > 0 AND coalesce(r.date_maturity, r.doc_date) < $1::date), 0)::text AS overdue
      FROM core.fact_receivable_item r WHERE r.doc_date <= $1::date ${scope('r')}`, p)).rows[0];
  const values = {};
  values['com-meta-mensual'] = num(month.net);
  if (Number(month.docs)) values['com-ticket'] = num(month.net) / Number(month.docs);
  if (num(top.total)) values['com-concentracion'] = num(top.top3) / num(top.total) * 100;
  if (num(rec.debt)) values['fin-cartera'] = num(rec.overdue) / num(rec.debt) * 100;
  for (const k of Object.keys(values)) values[k] = Math.round(values[k] * 100) / 100;
  return values;
}

/**
 * Compact fact pack for Omega IA: monthly series and rankings, so any period or ranking
 * question ("¿cuánto vendí en octubre?", "¿quién compra más?") is answered from data directly.
 */
export async function aiFacts(c, businessDate, companies = null) {
  const p = [businessDate];
  const sc = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($2::text[])` : '';
  if (companies) p.push(companies);
  const rows = async sql => (await c.query(sql, p)).rows;
  const money = v => (v === null || v === undefined ? '—' : `$${Math.round(Number(v)).toLocaleString('es-EC')}`);
  const pct = v => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`);
  const sales = await rows(`SELECT to_char(s.business_date, 'YYYY-MM') AS m,
      sum(s.net_amount) FILTER (WHERE s.net_amount > 0) AS inv, sum(s.net_amount) FILTER (WHERE s.net_amount < 0) AS nc,
      sum(s.net_amount) AS net, sum(s.cost_amount) AS cost, sum(s.net_amount) FILTER (WHERE s.cost_amount IS NOT NULL) AS known,
      count(DISTINCT s.origin || ':' || s.doc_id) AS docs, count(DISTINCT s.partner_id) AS customers
    FROM core.fact_sales_line s WHERE s.business_date > $1::date - 730 AND s.business_date <= $1::date ${sc('s')} GROUP BY 1 ORDER BY 1`);
  const buys = await rows(`SELECT to_char(pl.approve_date, 'YYYY-MM') AS m, sum(pl.amount) AS amount, count(DISTINCT pl.order_id) AS orders
    FROM core.fact_purchase_line pl WHERE pl.approve_date > $1::date - 730 AND pl.approve_date <= $1::date ${sc('pl')} GROUP BY 1 ORDER BY 1`);
  const top = async (key, joinSql, label) => rows(`SELECT ${label} AS name, sum(s.net_amount) AS net,
      (sum(s.net_amount) FILTER (WHERE s.cost_amount IS NOT NULL) - sum(s.cost_amount)) / nullif(sum(s.net_amount) FILTER (WHERE s.cost_amount IS NOT NULL), 0) * 100 AS margin
    FROM core.fact_sales_line s ${joinSql}
    WHERE s.business_date >= date_trunc('year', $1::date) AND s.business_date <= $1::date ${sc('s')} GROUP BY ${key} ORDER BY 2 DESC LIMIT 10`);
  const customers = await top('1', `LEFT JOIN core.dim_partner d ON d.source_id = s.source_id AND d.partner_id = s.partner_id`, `coalesce(d.name, 'Cliente ' || s.partner_id)`);
  const products = await top('1', `LEFT JOIN core.dim_product d ON d.source_id = s.source_id AND d.product_id = s.product_id`, `coalesce(d.name, 'Producto ' || s.product_id)`);
  const sellers = await top('1', `LEFT JOIN core.dim_user d ON d.source_id = s.source_id AND d.user_id = s.salesperson_id`, `coalesce(d.name, 'Sin vendedor')`);
  const categories = await top('1', `LEFT JOIN core.dim_product d ON d.source_id = s.source_id AND d.product_id = s.product_id`, `coalesce(d.category_name, 'Sin categoría')`);
  const rec = (await rows(`SELECT sum(r.residual) FILTER (WHERE r.residual > 0) AS debt,
      sum(r.residual) FILTER (WHERE r.residual > 0 AND coalesce(r.date_maturity, r.doc_date) < $1::date) AS overdue,
      sum(r.residual) FILTER (WHERE r.residual < 0) AS credits FROM core.fact_receivable_item r WHERE r.doc_date <= $1::date ${sc('r')}`))[0];
  const lines = [`## Hechos del último cierre (${businessDate}). Ventas = facturas publicadas − notas de crédito, sin IVA. Costo = costo contabilizado por Odoo en cada entrega.`,
    'Ventas por mes (mes | facturas | notas de crédito | venta neta | costo | margen bruto | documentos | clientes):',
    ...sales.map(r => `${r.m} | ${money(r.inv)} | ${money(r.nc)} | ${money(r.net)} | ${money(r.cost)} | ${pct(r.known ? (r.known - r.cost) / r.known * 100 : null)} | ${r.docs} | ${r.customers}`),
    'Compras por mes (mes | compras confirmadas | órdenes):', ...buys.map(r => `${r.m} | ${money(r.amount)} | ${r.orders}`),
    `Top 10 clientes del año (nombre | venta | margen): ${customers.map(r => `${r.name} | ${money(r.net)} | ${pct(r.margin)}`).join(' ; ')}`,
    `Top 10 productos del año: ${products.map(r => `${r.name} | ${money(r.net)} | ${pct(r.margin)}`).join(' ; ')}`,
    `Vendedores del año: ${sellers.map(r => `${r.name} | ${money(r.net)} | ${pct(r.margin)}`).join(' ; ')}`,
    `Categorías del año: ${categories.map(r => `${r.name} | ${money(r.net)} | ${pct(r.margin)}`).join(' ; ')}`,
    `Cartera: deuda de clientes ${money(rec?.debt)}, vencida ${money(rec?.overdue)} (${pct(rec?.debt ? rec.overdue / rec.debt * 100 : null)}), saldos a favor sin aplicar ${money(rec?.credits)}.`];
  return lines.join('\n');
}

const LIKE_ESCAPE = /[\\%_]/g;

/**
 * Valorización por bodega (current state of the published data).
 * Value = quantity in internal locations x product unit cost, where the unit cost is
 * sum(value) / sum(quantity) of its valuation layers (what Odoo reports for AVCO/FIFO).
 * Filters: bodega (warehouse id), categoria (name), q (name or internal reference),
 * orden (valor|cantidad) and the user's company scope.
 */
export async function warehouseValuation(c, query = {}, companies = null) {
  const p = [];
  const where = ['f.internal', 'f.quantity <> 0'];
  if (companies) where.push(`(f.source_id::text || ':' || f.company_id) = ANY($${p.push(companies)}::text[])`);
  const base = where.slice();
  const wh = String(query.bodega || '').trim();
  if (/^-?\d{1,12}$/.test(wh)) where.push(`coalesce(l.warehouse_id, -1) = $${p.push(Number(wh))}::bigint`);
  const loc = String(query.ubicacion || '').trim();
  if (/^\d{1,12}$/.test(loc)) where.push(`f.location_id = $${p.push(Number(loc))}::bigint`);
  const cat = String(query.categoria || '').trim().slice(0, 120);
  if (cat && cat !== 'Todas') where.push(`coalesce(d.category_name, 'Sin categoría') = $${p.push(cat)}`);
  const text = String(query.q || '').trim().slice(0, 80);
  if (text) {
    const like = `%${text.replace(LIKE_ESCAPE, m => '\\' + m)}%`;
    where.push(`(d.name ILIKE $${p.push(like)} OR d.default_code ILIKE $${p.length})`);
  }
  const from = `
    WITH cost AS (SELECT source_id, company_id, product_id, sum(value) / nullif(sum(quantity), 0) AS unit_cost
                    FROM core.fact_valuation_layer GROUP BY 1, 2, 3)
    SELECT f.source_id, f.company_id, f.product_id, f.quantity, coalesce(l.warehouse_id, -1) AS warehouse_id,
           f.location_id, coalesce(l.complete_name, l.name, 'Ubicación ' || f.location_id) AS location,
           coalesce(w.name, 'Sin bodega') AS warehouse, w.code, coalesce(d.name, 'Producto ' || f.product_id) AS product,
           d.default_code, coalesce(d.category_name, 'Sin categoría') AS category,
           c.unit_cost, f.quantity * coalesce(c.unit_cost, 0) AS value
      FROM core.fact_stock_quant f
      LEFT JOIN core.dim_location l ON l.source_id = f.source_id AND l.location_id = f.location_id
      LEFT JOIN core.dim_warehouse w ON w.source_id = f.source_id AND w.warehouse_id = l.warehouse_id
      LEFT JOIN core.dim_product d ON d.source_id = f.source_id AND d.product_id = f.product_id
      LEFT JOIN cost c ON c.source_id = f.source_id AND c.company_id = f.company_id AND c.product_id = f.product_id`;
  const rows = `(${from} WHERE ${where.join(' AND ')}) x`;
  const totals = (await c.query(`SELECT coalesce(sum(value), 0)::text AS value, coalesce(sum(quantity), 0)::text AS qty,
      count(DISTINCT product_id) AS skus, count(DISTINCT warehouse_id) AS warehouses,
      count(DISTINCT product_id) FILTER (WHERE unit_cost IS NULL) AS without_cost FROM ${rows}`, p)).rows[0];
  const warehouses = (await c.query(`SELECT warehouse_id::text AS id, warehouse AS name, max(code) AS code,
      sum(value)::text AS value, sum(quantity)::text AS qty, count(DISTINCT product_id) AS skus
      FROM ${rows} GROUP BY 1, 2 ORDER BY sum(value) DESC NULLS LAST LIMIT 100`, p)).rows;
  const categories = (await c.query(`SELECT category AS name, sum(value)::text AS value FROM ${rows}
      GROUP BY 1 ORDER BY sum(value) DESC NULLS LAST LIMIT 12`, p)).rows;
  const locations = (await c.query(`SELECT location_id::text AS id, location AS name, warehouse, sum(value)::text AS value,
      sum(quantity)::text AS qty, count(DISTINCT product_id) AS skus
      FROM ${rows} GROUP BY 1, 2, 3 ORDER BY sum(value) DESC NULLS LAST LIMIT 60`, p)).rows;
  const order = query.orden === 'cantidad' ? 'sum(quantity)' : 'sum(value)';
  const products = (await c.query(`SELECT product AS name, max(default_code) AS code, category, max(unit_cost)::text AS unit_cost,
      sum(quantity)::text AS qty, sum(value)::text AS value, count(DISTINCT warehouse_id) AS warehouses
      FROM ${rows} GROUP BY product_id, product, category ORDER BY ${order} DESC NULLS LAST LIMIT 200`, p)).rows;
  // Options ignore the warehouse/category/text filters (only the company scope): they never vanish.
  const bp = companies ? [companies] : [];
  const optRows = `(${from} WHERE ${base.join(' AND ')}) x`;
  const options = {
    warehouses: (await c.query(`SELECT DISTINCT warehouse_id::text AS id, warehouse AS name FROM ${optRows} ORDER BY 2`, bp)).rows,
    categories: (await c.query(`SELECT DISTINCT category AS name FROM ${optRows} ORDER BY 1`, bp)).rows.map(r => r.name),
    locations: (await c.query(`SELECT DISTINCT location_id::text AS id, location AS name, warehouse_id::text AS warehouse_id
      FROM ${optRows} ORDER BY 2`, bp)).rows,
  };
  return {totals, warehouses, locations, categories, products, options};
}
