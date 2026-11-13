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
    category: ['coalesce(p.category_top, p.category_name, \'Sin categoría\')', 'LEFT JOIN (SELECT DISTINCT source_id, categ_id, category_name, category_top FROM core.dim_product) p ON p.source_id = m.source_id AND p.categ_id = m.categ_id'],
    subcategory: ['coalesce(p.category_name, \'Sin categoría\')', 'LEFT JOIN (SELECT DISTINCT source_id, categ_id, category_name FROM core.dim_product) p ON p.source_id = m.source_id AND p.categ_id = m.categ_id'],
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
    brand: await by(`coalesce(d.brand, 'Sin marca')`), category: await by(`coalesce(d.category_top, d.category_name, 'Sin categoría')`),
    subcategory: await by(`coalesce(d.category_name, 'Sin categoría')`)};
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
           coalesce(d.brand, 'Sin marca') AS brand,
           st.qty::text AS qty, coalesce(st.value, 0)::text AS value, coalesce(del.cost, 0)::text AS cost, coalesce(sal.sales, 0)::text AS sales,
           CASE WHEN del.last IS NULL THEN 9999 ELSE $1::date - del.last END AS days
      FROM stock st LEFT JOIN del USING (source_id, product_id) LEFT JOIN sal USING (source_id, product_id)
      LEFT JOIN core.dim_product d ON d.source_id = st.source_id AND d.product_id = st.product_id`, p)).rows
    .map(r => ({name: r.name, category: r.category, brand: r.brand, qty: num(r.qty), value: num(r.value), cost: num(r.cost), sales: num(r.sales), days: Number(r.days)}));
  // Rotation per product only with meaningful stock (>= $100): a near-zero stock makes the ratio meaningless.
  const valued = products.filter(x => x.value >= 100).map(x => ({...x, rot: x.cost / x.value}));
  const stale = products.filter(x => x.days >= 180 && x.value > 0);
  const obsolete = stale.reduce((s, x) => s + x.value, 0);
  const byCat = {};
  for (const x of stale) byCat[x.category] = (byCat[x.category] || 0) + x.value;
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  const byBrand = {};
  for (const x of stale) byBrand[x.brand] = (byBrand[x.brand] || 0) + x.value;
  const topBrand = Object.entries(byBrand).sort((a, b) => b[1] - a[1])[0];
  return {
    rotation, coverage, value30, variation: value30 ? (valueNow - value30) / value30 * 100 : null,
    obsolete, obsoletePct: valueNow ? obsolete / valueNow * 100 : null,
    topObsCategory: topCat ? {name: topCat[0], value: topCat[1]} : null,
    topObsBrand: topBrand ? {name: topBrand[0], value: topBrand[1]} : null, staleCount: stale.length,
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
           -- Demand in the last 30 days, under 7 days of stock (or none) and nothing on order.
           (SELECT count(*) FROM out o2 LEFT JOIN stock s2 USING (source_id, product_id)
             WHERE o2.daily > 0 AND coalesce(s2.qty, 0) / o2.daily < 7
               AND NOT EXISTS (SELECT 1 FROM core.fact_purchase_line pl WHERE pl.source_id = o2.source_id AND pl.product_id = o2.product_id
                                  AND pl.qty > pl.qty_received AND coalesce(pl.receipt_status, '') <> 'full')) AS need,
           -- Same definition as Inventarios: total stock value / daily delivered cost (here, last 30 days).
           (sum(coalesce(s.value, 0)) / nullif((SELECT sum(x.amount) FROM core.fact_cost_line x WHERE x.amount > 0
              AND x.cost_date > $5::date - 30 AND x.cost_date <= $5::date ${sc('x')}) / 30.0, 0))::text AS coverage
      FROM stock s LEFT JOIN out o USING (source_id, product_id)`))[0];
  return {total: num(tot.cur), prev: num(tot.prev), fill: perf.ord && num(perf.ord) ? num(perf.rec) / num(perf.ord) * 100 : null,
    lead: num(lead.d), backValue: num(perf.back), backOrders: Number(perf.back_orders), transit: Number(perf.transit),
    vendors, brand: await group(`coalesce(d.brand, 'Sin marca')`), category: await group(`coalesce(d.category_top, d.category_name, 'Sin categoría')`),
    subcategory: await group(`coalesce(d.category_name, 'Sin categoría')`),
    trend, risk: Number(cov.risk), over: Number(cov.over), need: Number(cov.need), coverage: num(cov.coverage)};
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

// Blocks that need a source the client has not provided yet (stated in the panel, never estimated).
const BLOCKED = {
};
const NO_BUDGET = 'Sin presupuesto de ventas: cárgalo en Configuración → Presupuestos y unidades, o guarda la meta mensual en Umbrales y alertas.';
const NO_ISE = 'Fórmula ISE (rangos, pesos, faltantes) pendiente de aprobación.';
const NO_AI = 'Resumen automático pendiente del backend IA/MCP (F7).';
const NO_RULES = 'Hallazgos automáticos pendientes: requieren métricas aprobadas y umbrales por tenant.';

/** Build every bound widget of a page. Unbound blocks are reported as missing (never demo numbers). */
export async function buildReport(c, pageId, filters, {companies = null, blocks = []} = {}) {
  const w = {};
  const f = filters;
  const ctx = {}; // figures already computed for the page, reused by the insight blocks
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
    Object.assign(ctx, {cur, prev, g, marginPct, profit, d, ticket, coverage});
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
      ctx.orders = o;
      const brands = await grouped(c, f, 'brand', companies);
      const prevBrands = new Map((await grouped(c, f, 'brand', companies, 'prev')).map(r => [r.name, r.net]));
      const cats = await grouped(c, f, 'category', companies);
      const subcats = await grouped(c, f, 'subcategory', companies);
      const skus = (await salesBy(c, f, companies, 'sku')).slice(0, 12);
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
        'comercial-12': {kind: 'toggle', data: {Marca: share(brands), 'Categoría': share(cats), 'Subcategoría': share(subcats), SKU: share(skus)}},
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
      Object.assign(ctx, {dyn, arTurn});
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
        [`${pageId}-02`]: missing('Cumplimiento por unidad requiere presupuesto por unidad y las reglas de unidades de negocio (pendientes de JUJ).'),
        [`${pageId}-03`]: {...marginKpi, kind: 'metric'},
        [`${pageId}-04`]: missing('Punto de equilibrio requiere gastos fijos por unidad (mapeo contable pendiente).'),
      });
    }
  }
  if (pageId === 'logistica') {
    const lg = await logistics(c, f, companies);
    ctx.lg = lg;
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
    ctx.pu = pu;
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
    Object.assign(ctx, {inv, adv});
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
  await fillInsights(c, pageId, f, companies, w, ctx);
  await fillInputs(c, pageId, f, companies, w, ctx);
  for (const [id, reason] of Object.entries(BLOCKED)) if (id.startsWith(`${pageId}-`) && !w[id]) w[id] = missing(reason);
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
  const worst = async (joinSql, label) => rows(`SELECT ${label} AS name, sum(s.net_amount) AS net,
      (sum(s.net_amount) FILTER (WHERE s.cost_amount IS NOT NULL) - sum(s.cost_amount)) / nullif(sum(s.net_amount) FILTER (WHERE s.cost_amount IS NOT NULL), 0) * 100 AS margin
    FROM core.fact_sales_line s ${joinSql}
    WHERE s.business_date >= date_trunc('year', $1::date) AND s.business_date <= $1::date ${sc('s')}
    GROUP BY 1 HAVING sum(s.net_amount) FILTER (WHERE s.cost_amount IS NOT NULL) > 0 ORDER BY 3 ASC LIMIT 8`);
  const worstCustomers = await worst(`LEFT JOIN core.dim_partner d ON d.source_id = s.source_id AND d.partner_id = s.partner_id`, `coalesce(d.name, 'Cliente ' || s.partner_id)`);
  const worstProducts = await worst(`LEFT JOIN core.dim_product d ON d.source_id = s.source_id AND d.product_id = s.product_id`, `coalesce(d.name, 'Producto ' || s.product_id)`);
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
    `Clientes con MENOR margen del año (todos los clientes): ${worstCustomers.map(r => `${r.name} | ${money(r.net)} | ${pct(r.margin)}`).join(' ; ')}`,
    `Productos con MENOR margen del año: ${worstProducts.map(r => `${r.name} | ${money(r.net)} | ${pct(r.margin)}`).join(' ; ')}`,
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

// ---------------------------------------------------------------------------------------------
// Insight blocks: lists, executive summaries, matrix, ISE and customer dynamics. Everything is
// derived from the published close; rules that are OMEGA proposals (ISE weights, status ranges)
// say so in the block itself.
// ---------------------------------------------------------------------------------------------
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dmy = d => (d ? d.split('-').reverse().join('/') : '—');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const list = items => ({kind: 'list', items});
const text = paragraphs => ({kind: 'text', paragraphs: paragraphs.filter(Boolean)});
const marginOf = r => (r.known ? (r.known - r.cost) / r.known * 100 : null);

const SALES_DIMS = {
  brand: `coalesce(pr.brand, 'Sin marca')`,
  category: `coalesce(pr.category_top, pr.category_name, 'Sin categoría')`,
  province: `coalesce(pa.state_name, 'Sin provincia')`,
  seller: `coalesce(u.name, 'Sin vendedor')`,
  customer: `coalesce(pa.name, 'Consumidor final')`,
  sku: `coalesce(pr.name, 'Producto ' || m.product_id)`,
};

/** Sales, cost and counts grouped by one dimension for the period in f (all page filters apply). */
async function salesBy(c, f, companies, dim) {
  const p = [];
  return (await c.query(`SELECT ${SALES_DIMS[dim]} AS name, sum(m.net_amount)::text AS net, coalesce(sum(m.cost_amount), 0)::text AS cost,
        coalesce(sum(m.net_amount) FILTER (WHERE m.cost_amount IS NOT NULL), 0)::text AS known,
        count(DISTINCT m.partner_id) AS customers, count(DISTINCT m.origin || ':' || m.doc_id) AS docs
      FROM core.fact_sales_line m
      LEFT JOIN core.dim_product pr ON pr.source_id = m.source_id AND pr.product_id = m.product_id
      LEFT JOIN core.dim_partner pa ON pa.source_id = m.source_id AND pa.partner_id = m.partner_id
      LEFT JOIN core.dim_user u ON u.source_id = m.source_id AND u.user_id = m.salesperson_id
     WHERE ${where(f, p, {mart: false, companies})} GROUP BY 1 ORDER BY sum(m.net_amount) DESC`, p)).rows
    .map(r => ({name: r.name, net: num(r.net), cost: num(r.cost), known: num(r.known), customers: Number(r.customers), docs: Number(r.docs)}));
}

/**
 * Comparison windows for growth. Year over year when the previous year has sales; otherwise
 * (short history) the last 90 days against the 90 before, and the label says which one.
 */
async function growthBasis(c, f, companies) {
  const p = [];
  const prev = num((await c.query(`SELECT coalesce(sum(m.net_amount), 0)::text AS v FROM core.fact_sales_line m
      WHERE ${where(f, p, {mart: false, range: 'prev', companies})}`, p)).rows[0].v);
  if (prev > 0) return {cur: f, prev: {...f, from: f.prevFrom, to: f.prevTo}, label: 'vs año anterior'};
  const end = f.cutoff || f.to;
  return {cur: {...f, from: addDays(end, -89), to: end}, prev: {...f, from: addDays(end, -179), to: addDays(end, -90)},
    label: 'últimos 90 días vs los 90 anteriores'};
}

async function growthBy(c, basis, companies, dim) {
  const cur = await salesBy(c, basis.cur, companies, dim);
  const prev = new Map((await salesBy(c, basis.prev, companies, dim)).map(r => [r.name, r]));
  return cur.map(r => ({...r, prevNet: prev.get(r.name)?.net ?? 0, growth: growth(r.net, prev.get(r.name)?.net ?? 0)}));
}

/** One row per (seller, customer): first/last purchase, period sales and 90-day windows. */
async function customerBase(c, f, companies) {
  const end = f.cutoff || f.to;
  const p = [f.from, f.to, end];
  const sc = companies ? `AND (m.source_id::text || ':' || m.company_id) = ANY($4::text[])` : '';
  if (companies) p.push(companies);
  const rows = (await c.query(`SELECT coalesce(u.name, 'Sin vendedor') AS seller, m.source_id::text || ':' || coalesce(m.partner_id, 0) AS pid,
        coalesce(pa.name, 'Consumidor final') AS name, min(m.business_date)::text AS first, max(m.business_date)::text AS last,
        coalesce(sum(m.net_amount) FILTER (WHERE m.business_date BETWEEN $1::date AND $2::date), 0)::text AS net,
        coalesce(sum(m.cost_amount) FILTER (WHERE m.business_date BETWEEN $1::date AND $2::date), 0)::text AS cost,
        coalesce(sum(m.net_amount) FILTER (WHERE m.business_date BETWEEN $1::date AND $2::date AND m.cost_amount IS NOT NULL), 0)::text AS known,
        count(DISTINCT m.origin || ':' || m.doc_id) FILTER (WHERE m.business_date BETWEEN $1::date AND $2::date) AS docs,
        coalesce(sum(m.net_amount) FILTER (WHERE m.business_date > $3::date - 90), 0)::text AS n90,
        coalesce(sum(m.net_amount) FILTER (WHERE m.business_date > $3::date - 180 AND m.business_date <= $3::date - 90), 0)::text AS p90,
        count(*) FILTER (WHERE m.business_date > $3::date - 365) AS y365
      FROM core.fact_sales_line m
      LEFT JOIN core.dim_partner pa ON pa.source_id = m.source_id AND pa.partner_id = m.partner_id
      LEFT JOIN core.dim_user u ON u.source_id = m.source_id AND u.user_id = m.salesperson_id
     WHERE m.business_date <= $3::date ${sc} GROUP BY 1, 2, 3`, p)).rows
    .map(r => ({seller: r.seller, pid: r.pid, name: r.name, first: r.first, last: r.last, net: num(r.net), cost: num(r.cost), known: num(r.known),
      docs: Number(r.docs), n90: num(r.n90), p90: num(r.p90), y365: Number(r.y365)}));
  const by = new Map();
  for (const r of rows) {
    const x = by.get(r.pid) || {pid: r.pid, name: r.name, first: r.first, last: r.last, net: 0, cost: 0, known: 0, docs: 0, n90: 0, p90: 0,
      firstSeller: r.seller, lastSeller: r.seller};
    if (r.first < x.first) { x.first = r.first; x.firstSeller = r.seller; }
    if (r.last >= x.last) { x.last = r.last; x.lastSeller = r.seller; }
    for (const k of ['net', 'cost', 'known', 'docs', 'n90', 'p90']) x[k] += r[k];
    by.set(r.pid, x);
  }
  const customers = [...by.values()];
  const history = (await c.query(`SELECT min(m.business_date)::text AS d FROM core.fact_sales_line m WHERE m.business_date <= $3::date ${sc}
      AND ($1::date, $2::date) IS NOT NULL`, p)).rows[0].d;
  const start90 = addDays(end, -89);
  const isNew = x => x.first >= f.from && x.first <= f.to;
  const active = x => x.last >= start90;
  const lost = x => x.last < start90 && x.last >= addDays(end, -179);
  return {rows, customers, history, end, isNew, active, lost};
}

/** OMEGA's proposed health index: weighted 0-100 components, re-weighted over the ones with data. */
function ise(parts, basisLabel) {
  const avail = parts.filter(x => x.score !== null && Number.isFinite(x.score));
  const wsum = avail.reduce((s, x) => s + x.weight, 0);
  if (avail.length < 2) return null;
  const score = Math.round(avail.reduce((s, x) => s + x.score * x.weight, 0) / wsum);
  const tone = score >= 80 ? 'g' : score >= 60 ? 'a' : 'r';
  return {kind: 'ise', score, tone, status: tone === 'g' ? 'Bueno' : tone === 'a' ? 'Atención' : 'Crítico',
    components: parts.map(x => [x.label, x.weight, x.score === null || !Number.isFinite(x.score) ? null : Math.round(x.score)]),
    formula: `Propuesta OMEGA, pendiente de aprobación. Cada componente se lleva a 0–100: crecimiento ${basisLabel} (−20% = 0, 0% = 50, +20% = 100) `
      + 'y margen bruto (20% o más = 100). Se ponderan con los pesos indicados; los componentes sin dato (por ejemplo, presupuesto sin cargar) '
      + 'no cuentan y su peso se reparte entre los demás. Bueno ≥ 80, Atención 60–79, Crítico < 60.'};
}
const growthScore = g => (g === null || !Number.isFinite(g) ? null : clamp(50 + g * 2.5, 0, 100));
const marginScore = m => (m === null || !Number.isFinite(m) ? null : clamp(m / 20 * 100, 0, 100));

async function salesHealth(c, f, companies, ctx) {
  const basis = await growthBasis(c, f, companies);
  const [a, b] = [await salesBy(c, basis.cur, companies, 'customer'), await salesBy(c, basis.prev, companies, 'customer')];
  const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
  const curNet = sum(a, 'net'), prevNet = sum(b, 'net');
  const curT = ratio(curNet, sum(a, 'docs')), prevT = ratio(prevNet, sum(b, 'docs'));
  const gSales = growth(curNet, prevNet), gCust = growth(a.length, b.length), gTicket = growth(curT, prevT);
  const index = ise([
    {label: 'Ventas', weight: 30, score: growthScore(gSales)},
    {label: 'Rentabilidad', weight: 25, score: marginScore(ctx.marginPct)},
    {label: 'Presupuesto', weight: 20, score: null},
    {label: 'Clientes Facturados', weight: 15, score: growthScore(gCust)},
    {label: 'Ticket Promedio', weight: 10, score: growthScore(gTicket)},
  ], basis.label);
  return {basis, gSales, gCust, gTicket, index};
}

const iseKpi = x => (x ? kpi(x.score, `${x.score} /100`, [{label: x.status, value: 'Propuesta OMEGA', tone: x.tone === 'g' ? 'up' : x.tone === 'r' ? 'down' : ''}],
  {metric: 'ise', note: 'Fórmula propuesta, pendiente de aprobación'}) : missing('ISE sin datos suficientes: necesita al menos dos componentes.'));

function bestWorst(rows, total) {
  // Only items with weight (≥ 2% of sales or prior sales) enter the comparison.
  const pool = rows.filter(r => r.growth !== null && (r.net >= total * 0.02 || r.prevNet >= total * 0.02));
  if (pool.length < 2) return null;
  const s = [...pool].sort((x, y) => y.growth - x.growth);
  return [s[0], s[s.length - 1]];
}

/** Light per-area status used by Nivel 1 (OMEGA proposed ranges). */
async function areaSignals(c, f, companies) {
  const end = f.cutoff || f.to;
  const p = [f.from, f.to, end];
  const sc = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($4::text[])` : '';
  if (companies) p.push(companies);
  const one = async sql => (await c.query(`SELECT * FROM (${sql}) z WHERE ($1::date, $2::date, $3::date) IS NOT NULL`, p)).rows[0];
  const fill = await one(`SELECT (sum(qty_received) / nullif(sum(qty), 0) * 100)::text AS v FROM core.fact_purchase_line pl
      WHERE planned_date BETWEEN $1 AND $2 AND planned_date <= $3 ${sc('pl')}`);
  const otif = await one(`SELECT (count(*) FILTER (WHERE in_full AND done_date <= coalesce(deadline_date, scheduled_date))::numeric
        / nullif(count(*), 0) * 100)::text AS v, count(*) AS n FROM core.fact_picking pk
      WHERE pk.type_code = 'outgoing' AND pk.state = 'done' AND pk.done_date BETWEEN $1 AND $2 ${sc('pk')}`);
  const stale = await one(`WITH st AS (SELECT i.source_id, i.product_id, sum(i.value) AS value FROM mart.inventory_day i
        WHERE i.snapshot_date = (SELECT max(snapshot_date) FROM mart.inventory_day WHERE snapshot_date <= $3::date) ${sc('i')} GROUP BY 1, 2 HAVING sum(i.qty_internal) > 0)
      SELECT (sum(st.value) FILTER (WHERE NOT EXISTS (SELECT 1 FROM core.fact_cost_line x WHERE x.source_id = st.source_id AND x.product_id = st.product_id
                AND x.amount > 0 AND x.cost_date > $3::date - 180 AND x.cost_date <= $3::date)) / nullif(sum(st.value), 0) * 100)::text AS v FROM st`);
  const tv = await thresholdValues(c, end, companies);
  return {fill: num(fill?.v), otif: Number(otif?.n) ? num(otif.v) : null, obsolete: num(stale?.v), cartera: tv['fin-cartera'] ?? null,
    concentration: tv['com-concentracion'] ?? null};
}
const band = (v, good, warn, higherIsBetter = true) => (v === null || !Number.isFinite(v) ? null
  : higherIsBetter ? (v >= good ? 'g' : v >= warn ? 'a' : 'r') : (v <= good ? 'g' : v <= warn ? 'a' : 'r'));
const STATUS = {g: 'Bueno', a: 'Atención', r: 'Crítico'};

async function fillInsights(c, pageId, f, companies, w, ctx) {
  const set = (id, v) => { if (!w[id] || w[id].kind === 'missing') w[id] = v; };
  const period = `${dmy(f.from)} al ${dmy(f.to)}`;

  if (pageId === 'financiero') await fillFinance(c, f, companies, w, ctx);

  // Cumplimiento: venta del período ÷ meta mensual guardada en Umbrales y alertas × meses del período.
  if ((pageId === 'nivel1' || pageId === 'comercial') && ctx.cur) {
    const goal = (await c.query(`SELECT warn_value::text AS v FROM app.threshold_rules WHERE id = 'com-meta-mensual' AND enabled`)).rows[0];
    const monthly = goal ? num(goal.v) : null;
    const months = (Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86400000 / 30.44 + 1 / 30.44;
    if (monthly > 0) {
      const target = monthly * months, pctGoal = ctx.cur.net / target * 100;
      set(`${pageId}-02`, kpi(pctGoal.toFixed(2), fmtPct(pctGoal), [{label: 'Meta del período', value: fmtMoney(target), tone: pctGoal >= 100 ? 'up' : 'down'}],
        {metric: 'budget_attainment', note: `Meta mensual ${fmtMoney(monthly)} (Umbrales y alertas) × ${months.toFixed(1)} meses`}));
    }
  }

  if (pageId === 'clientes') {
    const cb = await customerBase(c, f, companies);
    const C = cb.customers;
    const activeN = C.filter(cb.active).length;
    const newC = C.filter(cb.isNew), lostC = C.filter(cb.lost);
    const shortHistory = cb.history && cb.history > f.from;
    const histNote = cb.history ? `Historia publicada desde ${dmy(cb.history)}` : 'Sin historia publicada';
    set('clientes-02', kpi(activeN, int.format(activeN), [{label: 'Inactivos +90d', value: int.format(C.length - activeN), tone: ''}],
      {metric: 'customers_active_90d', note: `Con al menos una factura entre ${dmy(addDays(cb.end, -89))} y ${dmy(cb.end)}`}));
    set('clientes-03', kpi(newC.length, int.format(newC.length), [], {metric: 'customers_new',
      note: `Primera compra dentro del período · ${histNote}${shortHistory ? ' (todo cliente de la historia cuenta como nuevo)' : ''}`}));
    set('clientes-04', kpi(lostC.length, int.format(lostC.length), [], {metric: 'customers_lost',
      note: 'Compraron entre 180 y 90 días atrás y no volvieron en los últimos 90'}));
    const months = Math.max(1, (Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86400000 / 30.44);
    const buyers = C.filter(x => x.docs > 0);
    const freq = buyers.length ? buyers.reduce((s, x) => s + x.docs, 0) / buyers.length / months : null;
    set('clientes-06', {kind: 'metric', value: freq === null ? '—' : `${freq.toFixed(1)}x/mes`, raw: freq === null ? null : String(freq), deltas: [],
      note: 'Documentos por cliente facturado y por mes del período'});

    const period_ = buyers.map(x => ({...x, profit: x.known - x.cost, ticket: ratio(x.net, x.docs)}));
    const basis = await growthBasis(c, f, companies);
    const gr = await growthBy(c, basis, companies, 'customer');
    const top = (rows, key, fmt) => bars([...rows].sort((a, b) => b[key] - a[key]).slice(0, 10).map(r => ({n: r.name, v: r[key], vt: fmt(r[key])})));
    set('clientes-07', {kind: 'toggle', data: {
      Ventas: top(period_, 'net', fmtMoney),
      Rentabilidad: top(period_.filter(x => x.known), 'profit', fmtMoney),
      Crecimiento: top(gr.filter(r => r.prevNet > 0 && r.growth !== null), 'growth', signed),
      'Ticket Promedio': top(period_.filter(x => x.docs >= 2), 'ticket', v => money2.format(v)),
    }, note: `Crecimiento ${basis.label}`});

    const sellers = new Map();
    const S = name => { if (!sellers.has(name)) sellers.set(name, {assigned: new Set(), billed: new Set(), net: 0, docs: 0, nw: 0, lost: 0}); return sellers.get(name); };
    for (const r of cb.rows) {
      const s = S(r.seller);
      if (r.y365 > 0) s.assigned.add(r.pid);
      if (r.docs > 0) { s.billed.add(r.pid); s.net += r.net; s.docs += r.docs; }
    }
    for (const x of newC) S(x.firstSeller).nw += 1;
    for (const x of lostC) S(x.lastSeller).lost += 1;
    set('clientes-09', {kind: 'table', rows: [...sellers.entries()].filter(([, s]) => s.assigned.size || s.billed.size)
      .sort((a, b) => b[1].net - a[1].net)
      .map(([name, s]) => [name, int.format(s.assigned.size), int.format(s.billed.size), int.format(s.nw), int.format(s.lost),
        s.docs ? money2.format(s.net / s.docs) : '—'])});

    const sorted = [...buyers].sort((a, b) => b.net - a.net);
    const total = sorted.reduce((s, x) => s + x.net, 0);
    const part = (a, b) => sorted.slice(a, b).reduce((s, x) => s + x.net, 0);
    set('clientes-10', {kind: 'bars', rows: total > 0 ? [['Top 5 (A)', part(0, 5)], ['Siguiente 15 (B)', part(5, 20)], ['Resto (C)', part(20)]]
      .map(([n, v]) => ({n, v: Math.round(v / total * 1000) / 10, vt: fmtPct(v / total * 100)})) : []});

    const brands = await salesBy(c, f, companies, 'brand');
    set('clientes-12', {kind: 'table', rows: brands.slice(0, 15).map(b => [b.name, int.format(b.customers), fmtMoney(b.net), money2.format(ratio(b.net, b.docs) || 0)])});

    const drops = C.filter(x => x.p90 > 0 && x.n90 < x.p90 * 0.8);
    const rises = C.filter(x => x.p90 > 0 && x.n90 > x.p90 * 1.2);
    const negative = buyers.filter(x => x.known > 0 && x.known - x.cost < 0);
    const lostValue = lostC.reduce((s, x) => s + x.p90, 0);
    set('clientes-13', list([
      {t: 'Clientes que dejaron de comprar', d: lostC.length ? `${int.format(lostC.length)} clientes · compraban ${fmtMoney(lostValue)} cada 90 días` : 'Ninguno en la ventana de 90 días', tone: lostC.length ? 'r' : 'g'},
      {t: 'Clientes con caída superior al 20%', d: `${int.format(drops.length)} clientes (últimos 90 días vs los 90 anteriores)`, tone: drops.length ? 'a' : 'g'},
      {t: 'Clientes con alto crecimiento', d: `${int.format(rises.length)} clientes crecen más de 20%`, tone: 'g'},
      {t: 'Clientes con margen negativo', d: negative.length ? `${int.format(negative.length)} clientes con venta bajo costo en el período` : 'Ninguno en el período', tone: negative.length ? 'r' : 'g'},
    ]));
    const potential = [
      ...lostC.map(x => ({name: x.name, w: x.p90, s: `Dejó de comprar: última factura ${dmy(x.last)} (compraba ${fmtMoney(x.p90)} cada 90 días)`})),
      ...drops.map(x => ({name: x.name, w: x.p90 - x.n90, s: `Redujo compras ${fmtPct((1 - x.n90 / x.p90) * 100)} en los últimos 90 días`})),
    ].sort((a, b) => b.w - a.w).slice(0, 10);
    set('clientes-14', {kind: 'table', rows: potential.map(x => [x.name, x.s])});

    const top5 = total ? part(0, 5) / total * 100 : null;
    set('clientes-15', text([
      `Del ${period} se facturaron ${int.format(buyers.length)} clientes por ${fmtMoney(total)}, con una frecuencia de ${freq === null ? '—' : freq.toFixed(1)} documentos por cliente al mes.`,
      `Hoy hay ${int.format(activeN)} clientes activos en los últimos 90 días; ${int.format(newC.length)} compraron por primera vez en el período y ${int.format(lostC.length)} dejaron de comprar.`,
      top5 === null ? '' : `Los 5 principales concentran ${fmtPct(top5)} de la venta${top5 > 60 ? ': la dependencia es alta y conviene ampliar la base' : ''}.`,
      negative.length ? `${int.format(negative.length)} clientes compran con margen negativo: revisa precios y descuentos.` : '',
      shortHistory ? `${histNote}: las comparaciones de clientes nuevos y perdidos ganan precisión con 12 meses de historia.` : '',
    ]));
  }

  if (pageId === 'compras' && ctx.pu) {
    const pu = ctx.pu;
    const g = growth(pu.total, pu.prev);
    set('compras-09', {kind: 'bars', rows: bars(pu.subcategory.map(b => ({n: b.name, v: b.value, vt: fmtMoney(b.value)})))});
    set('compras-12', {kind: 'metric', value: int.format(pu.need), raw: String(pu.need), deltas: [],
      note: 'Con demanda en 30 días, menos de 7 días de existencia y sin orden de compra abierta'});
    const items = [];
    if (pu.fill !== null) items.push({t: pu.fill < 95 ? 'Fill rate de proveedores bajo' : 'Fill rate de proveedores en rango', d: `${fmtPct(pu.fill)} recibido de lo pedido`, tone: pu.fill < 90 ? 'r' : pu.fill < 95 ? 'a' : 'g'});
    if (pu.lead !== null) items.push({t: 'Lead time de proveedores', d: `${pu.lead.toFixed(1)} días de la aprobación a la recepción`, tone: pu.lead > 15 ? 'a' : 'g'});
    if (pu.backOrders) items.push({t: 'Órdenes con recepción pendiente', d: `${int.format(pu.backOrders)} órdenes · ${fmtMoney(pu.backValue)} por recibir`, tone: 'a'});
    if (pu.need) items.push({t: 'SKU por comprar', d: `${int.format(pu.need)} productos con riesgo de quiebre y sin orden abierta`, tone: 'r'});
    if (pu.over) items.push({t: 'Sobrestock', d: `${int.format(pu.over)} productos con más de 120 días de existencia`, tone: 'a'});
    set('compras-18', list(items.length ? items : [{t: 'Sin alertas de compras', d: 'Los indicadores del período están en rango', tone: 'g'}]));
    const v0 = pu.vendors[0];
    set('compras-19', text([
      `Del ${period} se compraron ${fmtMoney(pu.total)}${g === null ? '' : ` (${signed(g)} vs año anterior)`}${v0 ? `; el principal proveedor es ${v0.name} con ${fmtPct(pu.total ? v0.value / pu.total * 100 : null)}` : ''}.`,
      pu.fill === null ? '' : `Los proveedores entregaron ${fmtPct(pu.fill)} de lo pedido${pu.lead === null ? '' : `, en ${pu.lead.toFixed(1)} días promedio`}.`,
      `Quedan ${int.format(pu.backOrders)} órdenes por recibir (${fmtMoney(pu.backValue)}). ${int.format(pu.need)} productos necesitan compra ya y ${int.format(pu.over)} tienen sobrestock.`,
    ]));
  }

  if (pageId === 'inventarios' && ctx.inv) {
    const {inv, adv} = ctx;
    const end = f.cutoff || f.to;
    const p = [end];
    const sc = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($2::text[])` : '';
    if (companies) p.push(companies);
    // Main vendor of each product: the one with the largest purchased amount.
    const vend = (await c.query(`WITH v AS (SELECT DISTINCT ON (pl.source_id, pl.product_id) pl.source_id, pl.product_id, pl.partner_id
          FROM core.fact_purchase_line pl WHERE pl.approve_date <= $1::date ${sc('pl')}
         GROUP BY pl.source_id, pl.product_id, pl.partner_id ORDER BY pl.source_id, pl.product_id, sum(pl.amount) DESC)
      SELECT coalesce(d.name, 'Sin compras registradas') AS name, sum(i.value)::text AS value
        FROM mart.inventory_day i LEFT JOIN v ON v.source_id = i.source_id AND v.product_id = i.product_id
        LEFT JOIN core.dim_partner d ON d.source_id = v.source_id AND d.partner_id = v.partner_id
       WHERE i.snapshot_date = (SELECT max(snapshot_date) FROM mart.inventory_day WHERE snapshot_date <= $1::date) ${sc('i')}
       GROUP BY 1 ORDER BY sum(i.value) DESC NULLS LAST LIMIT 12`, p)).rows.map(r => ({name: r.name, value: num(r.value)}));
    set('inventarios-08', {kind: 'bars', rows: bars(vend.map(b => ({n: b.name, v: b.value || 0, vt: fmtMoney(b.value)})))});
    set('inventarios-10', {kind: 'bars', rows: bars(inv.subcategory.map(b => ({n: b.name, v: b.value || 0, vt: fmtMoney(b.value)})))});
    set('inventarios-16', {kind: 'metric', value: adv.topObsBrand?.name || '—', raw: null, deltas: [],
      note: adv.topObsBrand ? `${fmtMoney(adv.topObsBrand.value)} sin entregas en 180 días` : 'Sin inventario inmovilizado'});
    set('inventarios-19', text([
      `Al corte ${dmy(inv.snapshot)} el inventario vale ${fmtMoney(inv.value)} en ${int.format(inv.skus)} SKU${adv.variation === null ? '' : ` (${signed(adv.variation)} vs hace 30 días)`}.`,
      adv.rotation === null ? '' : `Rota ${adv.rotation.toFixed(1)} veces al año (${int.format(365 / adv.rotation)} días de inventario)${adv.coverage === null ? '' : ` y cubre ${int.format(adv.coverage)} días al ritmo de los últimos 90`}.`,
      adv.obsolete ? `${fmtMoney(adv.obsolete)} (${fmtPct(adv.obsoletePct)}) no se mueve hace más de 180 días${adv.topObsBrand ? `; la marca con más capital detenido es ${adv.topObsBrand.name}` : ''}. Prioriza liquidar o devolver esos productos.` : 'No hay inventario sin movimiento por más de 180 días.',
    ]));
  }

  if (pageId === 'logistica' && ctx.lg) await fillLogisticsOps(c, f, companies, w, set);

  if (pageId === 'logistica' && ctx.lg) {
    const lg = ctx.lg;
    const items = [];
    if (lg.late) items.push({t: 'Despachos retrasados', d: `${int.format(lg.late)} vencidos sin despachar`, tone: 'r'});
    if (lg.otif !== null) items.push({t: lg.otif < 95 ? 'OTIF bajo la meta de 95%' : 'OTIF en rango', d: `${fmtPct(lg.otif)} a tiempo y completos`, tone: lg.otif < 85 ? 'r' : lg.otif < 95 ? 'a' : 'g'});
    if (lg.partial) items.push({t: 'Entregas parciales', d: `${int.format(lg.partial)} despachos con saldo pendiente`, tone: 'a'});
    if (lg.leadDays !== null) items.push({t: 'Tiempo de despacho', d: `${lg.leadDays.toFixed(1)} días del pedido al despacho`, tone: lg.leadDays > 2 ? 'a' : 'g'});
    set('logistica-17', list(items.length ? items : [{t: 'Sin alertas logísticas', d: 'Sin despachos en el período', tone: 'g'}]));
    const g = lg.prevDone ? (lg.done - lg.prevDone) / lg.prevDone * 100 : null;
    set('logistica-18', text([
      `Del ${period} se validaron ${int.format(lg.done)} despachos${g === null ? '' : ` (${signed(g)} vs año anterior)`}, ${lg.perDay === null ? '—' : lg.perDay.toFixed(1)} por día, con ${int.format(lg.lines)} líneas y ${fmtMoney(lg.value)} a costo.`,
      lg.leadDays === null ? '' : `El pedido tarda ${lg.leadDays.toFixed(1)} días en despacharse y el OTIF es ${fmtPct(lg.otif)}.`,
      `Quedan ${int.format(lg.pending)} despachos abiertos, ${int.format(lg.late)} ya vencidos${lg.late ? ': atiéndelos primero' : ''}.`,
      w['logistica-04']?.kind === 'kpi' ? `El costo logístico es ${w['logistica-04'].value} de la venta y la exactitud de inventario ${w['logistica-05']?.value ?? '—'}.` : '',
    ]));
  }

  if (pageId === 'comercial' && ctx.cur) {
    const h = await salesHealth(c, f, companies, ctx);
    set('comercial-06', h.index || missing('ISE sin datos suficientes: necesita al menos dos componentes.'));
    const rows = [];
    for (const [label, dim] of [['Marca', 'brand'], ['Categoría', 'category'], ['Provincia', 'province'], ['Vendedor', 'seller'], ['Cliente', 'customer']]) {
      const g = await growthBy(c, h.basis, companies, dim);
      const bw = bestWorst(g, g.reduce((s, r) => s + r.net, 0));
      rows.push(bw ? [label, `${bw[0].name} (${signed(bw[0].growth)})`, `${bw[1].name} (${signed(bw[1].growth)})`] : [label, '—', '—']);
    }
    set('comercial-18', {kind: 'matrix', rows, note: `Crecimiento ${h.basis.label}; solo entran elementos con al menos 2% de la venta.`});
    const o = ctx.orders;
    set('comercial-17', text([
      `Del ${period} la venta neta fue ${fmtMoney(ctx.cur.net)}${ctx.g === null ? '' : ` (${signed(ctx.g)} vs año anterior)`}, con margen bruto de ${fmtPct(ctx.marginPct)} y ${int.format(ctx.d.customers)} clientes facturados.`,
      h.gSales === null ? '' : `En ${h.basis.label} la venta varía ${signed(h.gSales)} y el ticket ${signed(h.gTicket)}.`,
      rows[0][1] !== '—' ? `La marca que más crece es ${rows[0][1]}; la que más cae es ${rows[0][2]}.` : '',
      o ? `Hay ${fmtMoney(o.pending)} por facturar y ${fmtMoney(o.backorder)} en backorder${o.old ? `; ${int.format(o.old)} pedidos llevan más de 15 días` : ''}.` : '',
      h.index ? `ISE comercial ${h.index.score}/100 (${h.index.status}), según la fórmula propuesta por OMEGA.` : '',
    ]));
  }

  if (pageId === 'nivel1' && ctx.cur) {
    const h = await salesHealth(c, f, companies, ctx);
    set('nivel1-06', iseKpi(h.index));
    set('nivel1-09', h.index || missing('ISE sin datos suficientes: necesita al menos dos componentes.'));
    set('nivel1-08', missing('ISE por unidad requiere las reglas de unidades de negocio (pendientes de JUJ).'));
    const sig = await areaSignals(c, f, companies);
    const cb = await customerBase(c, f, companies);
    const lostN = cb.customers.filter(cb.lost).length, activeN = cb.customers.filter(cb.active).length;
    const risks = [];
    if (ctx.marginPct !== null && ctx.marginPct < 15) risks.push({w: 15 - ctx.marginPct, t: 'Margen bruto bajo', d: `${fmtPct(ctx.marginPct)} sobre la venta con costo`, tone: ctx.marginPct < 10 ? 'r' : 'a'});
    if (sig.cartera !== null && sig.cartera > 8) risks.push({w: sig.cartera / 2, t: 'Cartera vencida alta', d: `${fmtPct(sig.cartera)} de la cartera está vencida`, tone: sig.cartera > 20 ? 'r' : 'a'});
    if (sig.obsolete !== null && sig.obsolete > 10) risks.push({w: sig.obsolete / 2, t: 'Inventario inmovilizado', d: `${fmtPct(sig.obsolete)} sin entregas en 180 días`, tone: sig.obsolete > 25 ? 'r' : 'a'});
    if (h.gSales !== null && h.gSales < 0) risks.push({w: -h.gSales, t: 'Venta en caída', d: `${signed(h.gSales)} ${h.basis.label}`, tone: h.gSales < -10 ? 'r' : 'a'});
    if (sig.concentration !== null && sig.concentration >= 40) risks.push({w: sig.concentration / 4, t: 'Dependencia de pocos clientes', d: `Los 3 principales concentran ${fmtPct(sig.concentration)}`, tone: sig.concentration >= 60 ? 'r' : 'a'});
    if (lostN) risks.push({w: lostN / Math.max(1, activeN) * 50, t: 'Clientes perdidos', d: `${int.format(lostN)} dejaron de comprar en los últimos 90 días`, tone: 'a'});
    if (sig.otif !== null && sig.otif < 95) risks.push({w: (95 - sig.otif) / 2, t: 'Despachos fuera de tiempo', d: `OTIF ${fmtPct(sig.otif)}`, tone: sig.otif < 85 ? 'r' : 'a'});
    set('nivel1-10', list(risks.length ? risks.sort((a, b) => b.w - a.w).slice(0, 5).map(({w: _, ...x}) => x)
      : [{t: 'Sin riesgos relevantes', d: 'Los indicadores del cierre están en rango', tone: 'g'}]));
    const opps = [];
    for (const [label, dim] of [['Marca', 'brand'], ['Categoría', 'category'], ['Provincia', 'province'], ['Cliente', 'customer']]) {
      const g = await growthBy(c, h.basis, companies, dim);
      const bw = bestWorst(g, g.reduce((s, r) => s + r.net, 0));
      if (bw && bw[0].growth > 0) opps.push({t: `${label} con mayor crecimiento: ${bw[0].name}`, d: `${signed(bw[0].growth)} ${h.basis.label}`, tone: 'g'});
    }
    set('nivel1-11', list(opps.length ? opps : [{t: 'Sin crecimientos destacados', d: `Comparación ${h.basis.label}`, tone: 'a'}]));
    const {evaluateAlerts} = await import('./alerts.mjs');
    const alerts = await evaluateAlerts(c, f.cutoff || f.to, companies);
    set('nivel1-12', list(alerts.length ? alerts.map(a => ({t: a.label, d: a.text.split(': ').slice(1).join(': '), tone: 'r'}))
      : [{t: 'Ningún umbral excedido', d: 'Configura metas y alertas en Umbrales y alertas', tone: 'g'}]));
    const centers = [
      ['Comercial', band(h.gSales, 0, -10)],
      ['Clientes', band(activeN ? lostN / activeN * 100 : null, 5, 15, false)],
      ['Compras', band(sig.fill, 95, 85)],
      ['Inventarios', band(sig.obsolete, 10, 25, false)],
      ['Logística', band(sig.otif, 95, 85)],
      ['Financiero', band(sig.cartera, 8, 20, false)],
    ];
    set('nivel1-13', {kind: 'table', rows: centers.map(([n, t]) => [n, t ? STATUS[t] : 'Sin dato'])});
  }
}

// ---------------------------------------------------------------------------------------------
// Financiero from the monthly trial balance (core.fact_account_month, Odoo balance = debit −
// credit). P&L by function follows the Ecuadorian chart (Superintendencia de Compañías): 4
// income (402 other), 5 costs, 601 selling, 602 administrative, 603 financial (60301 interest),
// 604 and 7 other expenses; balance-sheet classes come from Odoo's account type.
// ---------------------------------------------------------------------------------------------
const FIN_CLASS = `CASE
    WHEN f.account_type = 'asset_cash' THEN 'cash'
    WHEN f.account_type = 'asset_receivable' THEN 'ar'
    WHEN f.account_type IN ('asset_current', 'asset_prepayments') AND f.code LIKE '10103%' THEN 'inv'
    WHEN f.account_type IN ('asset_current', 'asset_prepayments') THEN 'ca'
    WHEN f.account_type LIKE 'asset%' THEN 'nca'
    WHEN f.account_type = 'liability_payable' THEN 'ap'
    WHEN f.account_type IN ('liability_current', 'liability_credit_card') THEN 'cl'
    WHEN f.account_type LIKE 'liability%' THEN 'ncl'
    WHEN f.account_type LIKE 'equity%' THEN 'eq'
    WHEN f.code LIKE '402%' OR f.account_type = 'income_other' THEN 'orev'
    WHEN f.code LIKE '4%' OR f.account_type = 'income' THEN 'rev'
    WHEN f.code LIKE '5%' OR f.account_type = 'expense_direct_cost' THEN 'cogs'
    WHEN f.code LIKE '601%' THEN 'sell'
    WHEN f.code LIKE '602%' THEN 'adm'
    WHEN f.code LIKE '60301%' THEN 'int'
    WHEN f.code LIKE '603%' THEN 'fin'
    ELSE 'oexp' END`;
const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

async function ledger(c, end, companies) {
  const p = [end];
  const sc = companies ? `AND (f.source_id::text || ':' || f.company_id) = ANY($2::text[])` : '';
  if (companies) p.push(companies);
  const rows = (await c.query(`SELECT to_char(f.month, 'YYYY-MM') AS m, ${FIN_CLASS} AS k,
        (f.name ILIKE '%depreciaci%' OR f.name ILIKE '%amortizaci%') AS dep, sum(f.balance)::text AS b
      FROM core.fact_account_month f WHERE f.month <= $1::date ${sc} GROUP BY 1, 2, 3 ORDER BY 1`, p)).rows;
  return rows.map(r => ({m: r.m, k: r.k, dep: r.dep, b: num(r.b)}));
}

/** P&L of a set of months and balance sheet at the end of a month (cumulative). */
function finFigures(rows, fromM, toM) {
  const pl = {rev: 0, orev: 0, cogs: 0, sell: 0, adm: 0, int: 0, fin: 0, oexp: 0, dep: 0};
  const bs = {cash: 0, ar: 0, inv: 0, ca: 0, nca: 0, ap: 0, cl: 0, ncl: 0, eq: 0};
  let cashStart = 0;
  for (const r of rows) {
    if (r.m <= toM && r.k in bs) bs[r.k] += r.b;
    if (r.m < fromM && r.k === 'cash') cashStart += r.b;
    if (r.m >= fromM && r.m <= toM && r.k in pl) {
      // Income is credit (negative balance): shown positive. Costs and expenses are debit.
      pl[r.k] += r.k === 'rev' || r.k === 'orev' ? -r.b : r.b;
      if (r.dep && r.k !== 'rev' && r.k !== 'orev') pl.dep += r.b;
    }
  }
  const sales = pl.rev;
  const gross = sales - pl.cogs;
  const operating = gross - pl.sell - pl.adm;
  const ebitda = operating + pl.dep;
  const net = sales + pl.orev - pl.cogs - pl.sell - pl.adm - pl.int - pl.fin - pl.oexp;
  const assetsC = bs.cash + bs.ar + bs.inv + bs.ca;
  const assets = assetsC + bs.nca;
  const liabC = -(bs.ap + bs.cl);
  const liab = liabC - bs.ncl;
  return {pl, sales, gross, operating, ebitda, net, cashEnd: bs.cash, cashFlow: bs.cash - cashStart, assetsC, assets, liabC, liab,
    equity: assets - liab, inventory: bs.inv, payables: -bs.ap,
    expenses: pl.sell + pl.adm + pl.int + pl.fin + pl.oexp};
}

async function fillFinance(c, f, companies, w, ctx) {
  const set = (id, v) => { if (!w[id] || w[id].kind === 'missing') w[id] = v; };
  const end = f.cutoff || f.to;
  const rows = await ledger(c, f.to < end ? f.to : end, companies);
  if (!rows.length) return; // no trial balance published yet: blocks stay as missing
  const fromM = f.from.slice(0, 7), toM = (f.to < end ? f.to : end).slice(0, 7);
  const x = finFigures(rows, fromM, toM);
  const pct = v => (x.sales ? v / x.sales * 100 : null);
  const metric = (value, raw, note) => ({kind: 'metric', value, raw: raw === null || raw === undefined || !Number.isFinite(raw) ? null : String(raw), deltas: [], note});
  const times = v => (v === null || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}x`);
  const days = v => (v === null || !Number.isFinite(v) ? '—' : `${int.format(v)} días`);
  const share = v => [{label: '% s/ventas', value: fmtPct(pct(v)), tone: v < 0 ? 'down' : ''}];
  set('financiero-03', kpi(x.ebitda, fmtMoney(x.ebitda), share(x.ebitda), {metric: 'ebitda', note: 'Utilidad operacional + depreciaciones y amortizaciones (contabilidad)'}));
  set('financiero-04', kpi(x.net, fmtMoney(x.net), share(x.net), {metric: 'net_income', note: 'Antes de participación laboral e impuesto a la renta'}));
  set('financiero-05', metric(fmtMoney(x.cashFlow), x.cashFlow, `Variación de caja y bancos del período · saldo ${fmtMoney(x.cashEnd)}`));
  const wc = x.assetsC - x.liabC;
  set('financiero-06', metric(fmtMoney(wc), wc, 'Activo corriente − pasivo corriente'));
  set('financiero-18', metric(fmtMoney(wc), wc, 'Activo corriente − pasivo corriente'));
  set('financiero-08', metric(fmtPct(pct(x.operating)), pct(x.operating), 'Utilidad operacional ÷ ventas (contabilidad)'));
  set('financiero-09', metric(fmtPct(pct(x.net)), pct(x.net), 'Utilidad neta ÷ ventas'));
  const roe = x.equity > 0 ? x.net / x.equity * 100 : null, roa = x.assets > 0 ? x.net / x.assets * 100 : null;
  set('financiero-10', metric(roe === null ? '—' : fmtPct(roe), roe, x.equity > 0 ? 'Utilidad neta del período ÷ patrimonio' : 'Patrimonio contable no positivo: ROE no aplica'));
  set('financiero-11', metric(roa === null ? '—' : fmtPct(roa), roa, 'Utilidad neta del período ÷ activo total'));
  const cm = x.sales ? x.gross / x.sales : null;
  const breakEven = cm && cm > 0 ? (x.pl.sell + x.pl.adm) / cm : null;
  const reached = breakEven ? x.sales / breakEven * 100 : null;
  set('financiero-12', metric(fmtPct(reached), reached, breakEven ? `Equilibrio en ${fmtMoney(breakEven)} de venta (gastos de venta y administración como fijos)` : 'Margen de contribución no positivo'));
  const liq = x.liabC > 0 ? x.assetsC / x.liabC : null;
  set('financiero-13', metric(times(liq), liq, 'Activo corriente ÷ pasivo corriente'));
  const acid = x.liabC > 0 ? (x.assetsC - x.inventory) / x.liabC : null;
  set('financiero-14', metric(times(acid), acid, '(Activo corriente − inventario) ÷ pasivo corriente'));
  const debt = x.assets > 0 ? x.liab / x.assets * 100 : null;
  set('financiero-15', metric(fmtPct(debt), debt, 'Pasivo total ÷ activo total'));
  const cover = x.pl.int > 0 ? x.operating / x.pl.int : null;
  set('financiero-16', metric(cover === null ? 'Sin intereses' : times(cover), cover, 'Utilidad operacional ÷ gastos por intereses'));
  // Payables turnover: purchases of the last 12 months ÷ supplier payables at the close.
  const pp = [end];
  const psc = companies ? `AND (pl.source_id::text || ':' || pl.company_id) = ANY($2::text[])` : '';
  if (companies) pp.push(companies);
  const buy = num((await c.query(`SELECT coalesce(sum(pl.amount), 0)::text AS v FROM core.fact_purchase_line pl
      WHERE pl.approve_date > $1::date - 365 AND pl.approve_date <= $1::date ${psc}`, pp)).rows[0].v);
  const apTurn = x.payables > 0 ? buy / x.payables : null;
  set('financiero-21', metric(times(apTurn), apTurn, 'Compras 12 meses ÷ cuentas por pagar a proveedores'));
  const invDays = ctx.dyn?.rotation ? 365 / ctx.dyn.rotation : null, arDays = ctx.arTurn ? 365 / ctx.arTurn : null, apDays = apTurn ? 365 / apTurn : null;
  const cce = invDays !== null && arDays !== null && apDays !== null ? invDays + arDays - apDays : null;
  set('financiero-17', metric(days(cce), cce, 'Días de inventario + días de cobro − días de pago'));
  set('financiero-22', metric(days(cce), cce, 'Días de inventario + días de cobro − días de pago'));
  if (arDays !== null) w['financiero-24'] = metric(`${int.format(arDays)} / ${apDays === null ? '—' : int.format(apDays)} días`, arDays,
    'Días promedio de cobro / días promedio de pago a proveedores');
  set('financiero-25', metric(fmtMoney(x.pl.adm), x.pl.adm, `${fmtPct(pct(x.pl.adm))} de las ventas · cuentas 602`));
  set('financiero-26', metric(fmtMoney(x.pl.sell), x.pl.sell, `${fmtPct(pct(x.pl.sell))} de las ventas · cuentas 601`));
  set('financiero-27', metric(fmtMoney(x.pl.int + x.pl.fin), x.pl.int + x.pl.fin, `${fmtPct(pct(x.pl.int + x.pl.fin))} de las ventas · cuentas 603`));
  set('financiero-28', metric(fmtMoney(x.expenses), x.expenses, `${fmtPct(pct(x.expenses))} de las ventas · sin costo de ventas`));
  // Monthly series of the selected period.
  const months = [...new Set(rows.map(r => r.m))].filter(m => m >= fromM && m <= toM);
  const series = months.map(m => ({m, label: `${MONTH_SHORT[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`, ...finFigures(rows, m, m)}));
  const serie = (get, fmt) => ({kind: 'bars', rows: bars(series.map(s => ({n: s.label, v: get(s) ?? 0, vt: fmt(get(s))})))});
  set('financiero-29', serie(s => s.ebitda, fmtMoney));
  set('financiero-30', serie(s => s.net, fmtMoney));
  set('financiero-31', serie(s => (s.liabC > 0 ? s.assetsC / s.liabC : null), times));
  set('financiero-32', serie(s => s.cashFlow, fmtMoney));
  set('financiero-33', {kind: 'table', rows: [['Ventas Netas', fmtMoney(x.sales)], ['Utilidad Bruta', fmtMoney(x.gross)], ['EBITDA', fmtMoney(x.ebitda)],
    ['Utilidad Neta', fmtMoney(x.net)], ['Flujo de Caja', fmtMoney(x.cashFlow)], ['Capital de Trabajo', fmtMoney(wc)]]});
  const alerts = [];
  if (x.net < 0) alerts.push({w: 10, t: 'Pérdida en el período', d: `Utilidad neta ${fmtMoney(x.net)} (${fmtPct(pct(x.net))})`, tone: 'r'});
  if (liq !== null && liq < 1) alerts.push({w: 9, t: 'Liquidez bajo 1', d: `Activo corriente cubre ${times(liq)} el pasivo corriente`, tone: 'r'});
  if (debt !== null && debt > 70) alerts.push({w: 8, t: 'Endeudamiento alto', d: `${fmtPct(debt)} del activo financiado con deuda`, tone: debt > 100 ? 'r' : 'a'});
  if (x.cashFlow < 0) alerts.push({w: 6, t: 'Caja en descenso', d: `${fmtMoney(x.cashFlow)} en el período`, tone: 'a'});
  if (arDays !== null && arDays > 60) alerts.push({w: 7, t: 'Cobro lento', d: `${int.format(arDays)} días promedio de cobro`, tone: arDays > 90 ? 'r' : 'a'});
  if (cce !== null && cce > 60) alerts.push({w: 5, t: 'Ciclo de caja largo', d: `${int.format(cce)} días entre pagar y cobrar`, tone: 'a'});
  if (pct(x.operating) !== null && pct(x.operating) < 3) alerts.push({w: 7, t: 'Margen operacional bajo', d: fmtPct(pct(x.operating)), tone: pct(x.operating) < 0 ? 'r' : 'a'});
  set('financiero-34', list(alerts.length ? alerts.sort((a, b) => b.w - a.w).slice(0, 5).map(({w: _, ...r}) => r)
    : [{t: 'Sin alertas financieras', d: 'Indicadores del período en rango', tone: 'g'}]));
  const first = rows[0]?.m;
  set('financiero-35', text([
    `Del ${dmy(f.from)} al ${dmy(f.to < end ? f.to : end)} la contabilidad registra ventas por ${fmtMoney(x.sales)}, utilidad bruta de ${fmtMoney(x.gross)} (${fmtPct(pct(x.gross))}), EBITDA de ${fmtMoney(x.ebitda)} y utilidad neta de ${fmtMoney(x.net)} (${fmtPct(pct(x.net))}).`,
    `La utilidad bruta contable incluye en el costo la mano de obra directa (cuentas 501); el margen sobre el costo de la mercadería entregada es ${fmtPct(ctx.marginPct)}.`,
    `Los gastos suman ${fmtMoney(x.expenses)}: venta ${fmtMoney(x.pl.sell)}, administración ${fmtMoney(x.pl.adm)} y financieros ${fmtMoney(x.pl.int + x.pl.fin)}.`,
    `Liquidez ${times(liq)}, endeudamiento ${fmtPct(debt)} y capital de trabajo ${fmtMoney(wc)}. La caja varió ${fmtMoney(x.cashFlow)}.`,
    first ? `Balance armado desde el primer mes contable publicado (${first}): si falta el asiento de apertura, los saldos de balance no incluyen lo anterior a esa fecha.` : '',
  ]));
}

// Logística from accounting and warehouse operations (core.fact_account_month, core.fact_stock_ops_month).
// Logistics accounts are detected by name (freight, fuel, vehicles, transport, loaders) and listed in the block.
const LOGISTICS_ACCOUNTS = `(f.name ~* '(flete|combustible|veh[ií]cul|transporte|estibador|peaje|encomienda|mensajer)')`;
async function fillLogisticsOps(c, f, companies, w, set) {
  const end = f.cutoff || f.to;
  const to = f.to < end ? f.to : end;
  const p = [f.from, to];
  const sc = a => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($3::text[])` : '';
  if (companies) p.push(companies);
  const accounts = (await c.query(`SELECT f.name, sum(f.balance)::text AS v FROM core.fact_account_month f
      WHERE f.month >= date_trunc('month', $1::date) AND f.month <= $2::date AND f.code ~ '^[67]' AND ${LOGISTICS_ACCOUNTS} ${sc('f')}
      GROUP BY 1 ORDER BY sum(f.balance) DESC`, p)).rows.map(r => ({name: r.name, v: num(r.v)}));
  const hasLedger = (await c.query(`SELECT EXISTS (SELECT 1 FROM core.fact_account_month f WHERE ($1::date, $2::date) IS NOT NULL ${sc('f')}) AS x`, p)).rows[0].x;
  if (hasLedger) {
    const sales = num((await c.query(`SELECT coalesce(sum(s.net_amount), 0)::text AS v FROM core.fact_sales_line s
        WHERE s.business_date BETWEEN $1::date AND $2::date ${sc('s')}`, p)).rows[0].v);
    const cost = accounts.reduce((t, a) => t + a.v, 0);
    const share = sales ? cost / sales * 100 : null;
    set('logistica-04', kpi(share === null ? null : share.toFixed(2), fmtPct(share), [{label: 'sobre ventas', value: fmtMoney(cost), tone: ''}],
      {metric: 'logistics_cost', note: accounts.length ? `Cuentas: ${accounts.slice(0, 5).map(a => a.name).join(', ')}` : 'Sin cuentas de fletes, combustible o vehículos con movimiento'}));
  }
  // Inventory accuracy, last 90 days: 1 − |adjusted value| ÷ inventory value at the close.
  const q = [end];
  const sq = companies ? `AND (o.source_id::text || ':' || o.company_id) = ANY($2::text[])` : '';
  const si = companies ? `AND (i.source_id::text || ':' || i.company_id) = ANY($2::text[])` : '';
  if (companies) q.push(companies);
  const ops = (await c.query(`SELECT kind, sum(moves) AS moves, sum(products) AS products, sum(value_abs)::text AS abs, sum(hours)::text AS hours,
        count(*) AS months
      FROM core.fact_stock_ops_month o WHERE o.month > date_trunc('month', $1::date - 90) AND o.month <= $1::date ${sq} GROUP BY 1`, q)).rows;
  const any = (await c.query(`SELECT count(*) AS n FROM core.fact_stock_ops_month o WHERE $1::date IS NOT NULL ${sq}`, q)).rows[0];
  if (!Number(any.n)) return;
  const adj = ops.find(r => r.kind === 'adjust');
  const stock = num((await c.query(`SELECT coalesce(sum(i.value), 0)::text AS v FROM mart.inventory_day i
      WHERE i.snapshot_date = (SELECT max(snapshot_date) FROM mart.inventory_day WHERE snapshot_date <= $1::date) ${si}`, q)).rows[0].v);
  const adjAbs = adj ? num(adj.abs) : 0;
  const accuracy = stock > 0 ? Math.max(0, 100 - adjAbs / stock * 100) : null;
  set('logistica-05', kpi(accuracy === null ? null : accuracy.toFixed(2), fmtPct(accuracy),
    [{label: 'Meta', value: '97%', tone: accuracy === null ? '' : accuracy >= 97 ? 'up' : 'down'}],
    {metric: 'inventory_accuracy', note: `Ajustes de inventario de los últimos 3 meses: ${fmtMoney(adjAbs)} en ${int.format(adj ? Number(adj.products) : 0)} productos, sobre ${fmtMoney(stock)} en stock`}));
  // Preparation time in the selected period: creation of the delivery → validation.
  const pp = [f.from, to];
  if (companies) pp.push(companies);
  const prep = (await c.query(`SELECT sum(moves) AS n, sum(hours)::text AS h FROM core.fact_stock_ops_month o
      WHERE o.kind = 'prep' AND o.month >= date_trunc('month', $1::date) AND o.month <= $2::date ${companies ? `AND (o.source_id::text || ':' || o.company_id) = ANY($3::text[])` : ''}`, pp)).rows[0];
  const n = Number(prep.n || 0);
  const daysPrep = n ? num(prep.h) / n / 24 : null;
  set('logistica-11', {kind: 'metric', value: daysPrep === null ? '—' : `${daysPrep.toFixed(1)} días`, raw: daysPrep === null ? null : String(daysPrep), deltas: [],
    note: n ? `De la creación del despacho a su validación · ${int.format(n)} despachos` : 'Sin despachos validados en el período'});
}

// ---------------------------------------------------------------------------------------------
// Blocks fed by company inputs (Configuración → Presupuestos y unidades): budgets, campaigns and
// business-unit rules. Without the input the block says exactly what to load; never estimated.
// ---------------------------------------------------------------------------------------------
const NEED_UNITS = 'Define las unidades de negocio en Configuración → Presupuestos y unidades.';
const NEED_BUDGET = kind => `Sin presupuesto de ${kind}: cárgalo en Configuración → Presupuestos y unidades.`;
const NEED_CAMPAIGNS = 'Sin campañas cargadas: súbelas en Configuración → Presupuestos y unidades.';

/** Budget of a kind for the period, prorated by days in partial months. */
async function budgetFor(c, kind, f, {unit, by} = {}) {
  const p = [kind, f.from, f.to];
  const filt = unit ? `AND unit_name = $${p.push(unit)}` : '';
  const rows = (await c.query(`SELECT unit_name, brand,
        sum(amount * (least($3::date, (month + interval '1 month - 1 day')::date) - greatest($2::date, month) + 1)
            / extract(day FROM (month + interval '1 month - 1 day')))::text AS amount
      FROM app.budgets WHERE kind = $1 AND month <= $3::date AND (month + interval '1 month - 1 day')::date >= $2::date ${filt}
      GROUP BY 1, 2`, p)).rows.map(r => ({unit: r.unit_name, brand: r.brand, amount: num(r.amount)}));
  if (!rows.length) return null;
  if (by === 'brand') {
    const m = new Map();
    for (const r of rows) if (r.brand) m.set(r.brand, (m.get(r.brand) || 0) + r.amount);
    return m;
  }
  if (by === 'unit') {
    const m = new Map();
    for (const r of rows) if (r.unit && !r.brand) m.set(r.unit, (m.get(r.unit) || 0) + r.amount);
    return m;
  }
  // Total: plain rows if present; else the unit split; else the brand split (never both added).
  const pick = rows.filter(r => !r.unit && !r.brand);
  const level = pick.length ? pick : rows.some(r => r.unit && !r.brand) ? rows.filter(r => r.unit && !r.brand) : rows.filter(r => r.brand && !r.unit);
  const list = level.length ? level : rows;
  return list.reduce((s, r) => s + r.amount, 0);
}

async function unitNames(c) {
  return (await c.query('SELECT DISTINCT unit_name FROM app.business_unit_rules ORDER BY 1')).rows.map(r => r.unit_name);
}

async function fillInputs(c, pageId, f, companies, w, ctx) {
  const set = (id, v) => { if (!w[id] || w[id].kind === 'missing') w[id] = v; };
  const attain = (actual, target) => (target > 0 ? actual / target * 100 : null);

  // Cumplimiento general: sales budget when loaded (the monthly goal of Umbrales stays as fallback).
  if ((pageId === 'nivel1' || pageId === 'comercial') && ctx.cur) {
    const target = await budgetFor(c, 'ventas', f);
    if (target) {
      const pct = attain(ctx.cur.net, target);
      w[`${pageId}-02`] = kpi(pct === null ? null : pct.toFixed(2), fmtPct(pct), [{label: 'Presupuesto', value: fmtMoney(target), tone: pct >= 100 ? 'up' : 'down'}],
        {metric: 'budget_attainment', note: 'Venta neta del período ÷ presupuesto de ventas (meses parciales prorrateados)'});
    }
  }

  // Business units: budget attainment, break-even, per-unit ISE, deliveries.
  if (UNIT_PAGES[pageId] && ctx.cur) {
    const units = await unitNames(c);
    const name = UNIT_PAGES[pageId];
    if (!units.includes(name)) {
      w[`${pageId}-02`] = missing(`${NEED_UNITS} La unidad "${name}" aún no tiene regla.`);
      w[`${pageId}-04`] = missing(`${NEED_UNITS} La unidad "${name}" aún no tiene regla.`);
    } else {
      const target = await budgetFor(c, 'ventas', f, {unit: name});
      const pct = target ? attain(ctx.cur.net, target) : null;
      w[`${pageId}-02`] = target ? {kind: 'metric', value: fmtPct(pct), raw: pct === null ? null : String(pct), deltas: [],
        note: `${fmtMoney(ctx.cur.net)} de ${fmtMoney(target)} presupuestados`} : missing(NEED_BUDGET('ventas de la unidad'));
      const fixed = await budgetFor(c, 'gastos_fijos', f, {unit: name});
      const cm = ctx.marginPct !== null ? ctx.marginPct / 100 : null;
      if (!fixed) w[`${pageId}-04`] = missing('Sin gastos fijos de la unidad: cárgalos (tipo gastos_fijos) en Configuración → Presupuestos y unidades.');
      else if (!cm || cm <= 0) w[`${pageId}-04`] = missing('Margen de la unidad no positivo: no hay punto de equilibrio.');
      else {
        const be = fixed / cm;
        w[`${pageId}-04`] = {kind: 'metric', value: fmtMoney(be), raw: String(be), deltas: [],
          note: `Venta del período ${fmtMoney(ctx.cur.net)} (${fmtPct(ctx.cur.net / be * 100)} del equilibrio) · gastos fijos ${fmtMoney(fixed)} ÷ margen ${fmtPct(ctx.marginPct)}`};
      }
    }
  }

  if (pageId === 'nivel1' && ctx.cur) {
    const units = await unitNames(c);
    if (!units.length) w['nivel1-08'] = missing(NEED_UNITS);
    else {
      const rows = [];
      for (const u of units) {
        const fu = {...f, unit: u};
        const t = await salesTotals(c, fu, 'cur', companies);
        const margin = t.known ? (t.known - t.cost) / t.known * 100 : null;
        const h = await salesHealth(c, fu, companies, {marginPct: margin});
        const target = await budgetFor(c, 'ventas', f, {unit: u});
        let index = h.index;
        if (index && target) {
          // Budget component (20%) joins when the unit has a budget: 100% attainment = 100 points.
          const comps = index.components.map(([l, wgt, sc]) => [l, wgt, l === 'Presupuesto' ? clamp(attain(t.net, target), 0, 100) : sc]);
          const avail = comps.filter(x => x[2] !== null);
          const score = Math.round(avail.reduce((s, x) => s + x[2] * x[1], 0) / avail.reduce((s, x) => s + x[1], 0));
          index = {...index, score, status: score >= 80 ? 'Bueno' : score >= 60 ? 'Atención' : 'Crítico'};
        }
        rows.push([u, index ? String(index.score) : '—', index ? index.status : 'Sin dato']);
      }
      w['nivel1-08'] = {kind: 'table', rows};
    }
  }

  if (pageId === 'logistica') {
    const units = await unitNames(c);
    if (!units.length) w['logistica-08'] = missing(NEED_UNITS);
    else {
      const p = [f.from, f.to];
      const sc = companies ? `AND (pk.source_id::text || ':' || pk.company_id) = ANY($3::text[])` : '';
      if (companies) p.push(companies);
      const rows = (await c.query(`SELECT coalesce(r.unit_name, 'Sin unidad') AS name, count(*) AS n FROM core.fact_picking pk
          LEFT JOIN LATERAL (SELECT unit_name FROM app.business_unit_rules r WHERE r.unit_code = pk.unit_code LIMIT 1) r ON true
         WHERE pk.type_code = 'outgoing' AND pk.state = 'done' AND pk.done_date BETWEEN $1::date AND $2::date ${sc}
         GROUP BY 1 ORDER BY 2 DESC`, p)).rows.map(r => ({n: r.name, v: Number(r.n)}));
      const total = rows.reduce((s, r) => s + r.v, 0);
      w['logistica-08'] = {kind: 'bars', rows: bars(rows.map(r => ({n: r.n, v: r.v, vt: `${int.format(r.v)} (${fmtPct(total ? r.v / total * 100 : null)})`})))};
    }
  }

  if (pageId === 'compras' && ctx.pu) {
    const pu = ctx.pu;
    const target = await budgetFor(c, 'compras', f);
    if (!target) { w['compras-05'] = missing(NEED_BUDGET('compras')); w['compras-16'] = missing(NEED_BUDGET('compras por marca')); }
    else {
      const pct = attain(pu.total, target);
      w['compras-05'] = kpi(pct === null ? null : pct.toFixed(2), fmtPct(pct), [{label: 'acumulado', value: `${fmtMoney(pu.total)} de ${fmtMoney(target)}`, tone: ''}],
        {metric: 'purchase_budget_attainment', note: 'Compras aprobadas del período ÷ presupuesto de compras'});
      const byBrand = await budgetFor(c, 'compras', f, {by: 'brand'});
      if (!byBrand || !byBrand.size) w['compras-16'] = missing(NEED_BUDGET('compras por marca'));
      else {
        const actual = new Map(pu.brand.map(b => [b.name, b.value]));
        // pu.brand holds the top 12 brands; budgeted brands outside it are read directly.
        const rows = [];
        for (const [brand, budget] of byBrand) {
          let value = actual.get(brand);
          if (value === undefined) {
            const p = [f.from, f.to, brand];
            const sc = companies ? `AND (pl.source_id::text || ':' || pl.company_id) = ANY($4::text[])` : '';
            if (companies) p.push(companies);
            value = num((await c.query(`SELECT coalesce(sum(pl.amount), 0)::text AS v FROM core.fact_purchase_line pl
                JOIN core.dim_product d ON d.source_id = pl.source_id AND d.product_id = pl.product_id
               WHERE pl.approve_date BETWEEN $1::date AND $2::date AND d.brand = $3 ${sc}`, p)).rows[0].v);
          }
          const pctB = attain(value, budget);
          rows.push({n: brand, v: pctB ?? 0, vt: `${fmtPct(pctB)} · ${fmtMoney(value)} de ${fmtMoney(budget)}`});
        }
        w['compras-16'] = {kind: 'bars', rows: rows.sort((a, b) => b.v - a.v).map(r => ({...r, v: Math.round(r.v * 10) / 10}))};
      }
    }
  }

  if (pageId === 'marketing') await fillMarketing(c, f, companies, w);
}

/** Marketing: repurchase and new customers from sales; campaigns and investment from the inputs. */
async function fillMarketing(c, f, companies, w) {
  const end = f.cutoff || f.to;
  const to = f.to < end ? f.to : end;
  const sc = (a, n) => companies ? `AND (${a}.source_id::text || ':' || ${a}.company_id) = ANY($${n}::text[])` : '';
  // Retail units when defined (the block is "Recompra Retail"); all sales otherwise, and the note says so.
  const retail = (await c.query(`SELECT DISTINCT unit_code FROM app.business_unit_rules WHERE unit_name ILIKE 'retail%'`)).rows.map(r => r.unit_code);
  const scopeNote = retail.length ? 'unidades Retail' : 'todas las ventas; aún no hay unidades Retail definidas';
  const rp = [f.from, to, retail];
  if (companies) rp.push(companies);
  const rFilter = `(cardinality($3::text[]) = 0 OR m.unit_code = ANY($3::text[])) AND m.partner_id IS NOT NULL ${sc('m', 4)}`;
  const rep = async (from, toD) => {
    const q = [from, toD, retail]; if (companies) q.push(companies);
    const r = (await c.query(`SELECT count(*) FILTER (WHERE docs >= 2) AS again, count(*) AS total FROM (
        SELECT m.partner_id, count(DISTINCT m.origin || ':' || m.doc_id) AS docs FROM core.fact_sales_line m
         WHERE m.business_date BETWEEN $1::date AND $2::date AND m.net_amount > 0 AND ${rFilter} GROUP BY 1) x`, q)).rows[0];
    return Number(r.total) ? Number(r.again) / Number(r.total) * 100 : null;
  };
  const recompra = await rep(f.from, to);
  const prevRecompra = await rep(f.prevFrom, f.prevTo);
  w['marketing-06'] = kpi(recompra === null ? null : recompra.toFixed(2), fmtPct(recompra), [{label: 'Año Ant.', value: fmtPct(prevRecompra), tone: recompra !== null && prevRecompra !== null ? (recompra >= prevRecompra ? 'up' : 'down') : ''}],
    {metric: 'repurchase_rate', note: `Clientes con 2 o más compras en el período · ${scopeNote}`});
  // 12-month trend: share of each month's customers that had bought in the previous 90 days.
  const trend = (await c.query(`WITH s AS (SELECT DISTINCT m.partner_id, m.business_date FROM core.fact_sales_line m
        WHERE m.business_date <= $2::date AND m.business_date > $2::date - 470 AND m.net_amount > 0 AND ${rFilter} AND $1::date IS NOT NULL),
      mon AS (SELECT generate_series(date_trunc('month', $2::date) - interval '11 months', date_trunc('month', $2::date), interval '1 month')::date AS m)
      SELECT to_char(mon.m, 'YYYY-MM') AS month, count(DISTINCT s.partner_id) AS buyers,
             count(DISTINCT s.partner_id) FILTER (WHERE EXISTS (SELECT 1 FROM s s2 WHERE s2.partner_id = s.partner_id
                 AND s2.business_date < mon.m AND s2.business_date >= mon.m - 90)) AS again
        FROM mon LEFT JOIN s ON s.business_date >= mon.m AND s.business_date < (mon.m + interval '1 month')::date
       GROUP BY mon.m ORDER BY mon.m`, rp)).rows.filter(r => Number(r.buyers) > 0)
    .map(r => ({n: `${MONTH_SHORT[Number(r.month.slice(5)) - 1]} ${r.month.slice(2, 4)}`, v: Number(r.again) / Number(r.buyers) * 100}));
  w['marketing-11'] = {kind: 'bars', rows: trend.map(t => ({n: t.n, v: Math.round(t.v * 10) / 10, vt: fmtPct(t.v)}))};

  // New customers in the period (first purchase ever inside it).
  const np = [f.from, to]; if (companies) np.push(companies);
  const newCustomers = Number((await c.query(`SELECT count(*) AS n FROM (SELECT m.partner_id, min(m.business_date) AS first FROM core.fact_sales_line m
      WHERE m.partner_id IS NOT NULL AND m.business_date <= $2::date ${sc('m', 3)} GROUP BY 1) x WHERE first >= $1::date`, np)).rows[0].n);
  const goal = await budgetFor(c, 'marketing', f);
  w['marketing-05'] = kpi(newCustomers, int.format(newCustomers), [{label: 'Meta', value: '—', tone: ''}],
    {metric: 'customers_new', note: 'Clientes con su primera compra dentro del período'});

  // Campaigns overlapping the period, each measured with the sales of its brand/unit in its dates.
  const camps = (await c.query(`SELECT id, name, status, start_date::text AS s, end_date::text AS e, brand, unit_name, investment::text AS inv
      FROM app.marketing_campaigns WHERE start_date <= $2::date AND end_date >= $1::date ORDER BY start_date`, [f.from, to])).rows;
  const totalSales = num((await c.query(`SELECT coalesce(sum(m.net_amount), 0)::text AS v FROM core.fact_sales_line m
      WHERE m.business_date BETWEEN $1::date AND $2::date ${sc('m', 3)}`, np)).rows[0].v);
  const measure = async camp => {
    const q = [camp.s, camp.e < to ? camp.e : to];
    const parts = [];
    if (camp.brand) parts.push(`m.product_id IN (SELECT product_id FROM core.dim_product WHERE brand = $${q.push(camp.brand)})`);
    if (camp.unit_name) parts.push(`m.unit_code IN (SELECT unit_code FROM app.business_unit_rules WHERE unit_name = $${q.push(camp.unit_name)})`);
    if (companies) parts.push(`(m.source_id::text || ':' || m.company_id) = ANY($${q.push(companies)}::text[])`);
    const extra = parts.length ? `AND ${parts.join(' AND ')}` : '';
    const r = (await c.query(`SELECT coalesce(sum(m.net_amount), 0)::text AS net, coalesce(sum(m.cost_amount), 0)::text AS cost,
          coalesce(sum(m.net_amount) FILTER (WHERE m.cost_amount IS NOT NULL), 0)::text AS known,
          count(DISTINCT m.partner_id) FILTER (WHERE m.partner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.fact_sales_line o
            WHERE o.source_id = m.source_id AND o.partner_id = m.partner_id AND o.business_date < $1::date)) AS captured
        FROM core.fact_sales_line m WHERE m.business_date BETWEEN $1::date AND $2::date ${extra}`, q)).rows[0];
    const net = num(r.net), known = num(r.known), cost = num(r.cost), inv = num(camp.inv);
    const marginAmt = known ? (known - cost) / known * net : null;
    return {...camp, net, inv, captured: Number(r.captured), roi: inv > 0 && marginAmt !== null ? (marginAmt - inv) / inv * 100 : null, marginAmt};
  };
  const measured = [];
  for (const camp of camps) measured.push(await measure(camp));
  const done = measured.filter(x => x.status === 'ejecutada');
  if (!camps.length) {
    for (const id of ['marketing-01', 'marketing-02', 'marketing-03', 'marketing-04', 'marketing-07', 'marketing-09', 'marketing-10'])
      w[id] = missing(NEED_CAMPAIGNS);
  } else {
    const inv = done.reduce((s, x) => s + x.inv, 0);
    const sales = done.reduce((s, x) => s + x.net, 0);
    const margin = done.reduce((s, x) => s + (x.marginAmt || 0), 0);
    const roi = inv > 0 ? (margin - inv) / inv * 100 : null;
    const captured = done.reduce((s, x) => s + x.captured, 0);
    w['marketing-01'] = kpi(inv, fmtMoney(inv), [{label: 'Cumpl.', value: goal ? fmtPct(inv / goal * 100) : 'sin presupuesto', tone: ''}],
      {metric: 'marketing_investment', note: 'Inversión de campañas ejecutadas en el período'});
    w['marketing-02'] = kpi(done.length, int.format(done.length), [{label: 'Planificadas', value: int.format(camps.length), tone: ''}], {metric: 'campaigns_done'});
    w['marketing-03'] = kpi(sales, fmtMoney(sales), [{label: 'Participación', value: fmtPct(totalSales ? sales / totalSales * 100 : null), tone: ''}],
      {metric: 'campaign_sales', note: 'Venta de la marca/unidad de cada campaña durante sus fechas'});
    w['marketing-04'] = kpi(roi === null ? null : roi.toFixed(2), signed(roi), [{label: 'promedio', value: 'sobre margen bruto', tone: ''}],
      {metric: 'campaign_roi', note: '(Margen bruto de la venta de campaña − inversión) ÷ inversión'});
    w['marketing-07'] = {kind: 'table', rows: [...measured].sort((a, b) => (b.roi ?? -1e9) - (a.roi ?? -1e9))
      .map(x => [`${x.name}${x.status === 'planificada' ? ' (planificada)' : ''}`, fmtMoney(x.inv), fmtMoney(x.net), signed(x.roi), int.format(x.captured)])};
    const byUnit = new Map();
    for (const x of done) { const k = x.unit_name || 'Todas las unidades'; const g = byUnit.get(k) || {inv: 0, net: 0, m: 0}; g.inv += x.inv; g.net += x.net; g.m += x.marginAmt || 0; byUnit.set(k, g); }
    w['marketing-09'] = {kind: 'table', rows: [...byUnit.entries()].map(([k, g]) => [k, fmtMoney(g.inv), fmtMoney(g.net), signed(g.inv ? (g.m - g.inv) / g.inv * 100 : null)])};
    w['marketing-10'] = {kind: 'metric', value: int.format(captured), raw: String(captured), deltas: [], note: `de ${int.format(newCustomers)} clientes nuevos del período`};
  }
  // Brand impact: real sales and growth for every brand; investment from the campaigns.
  const basis = await growthBasis(c, f, companies);
  const brands = (await growthBy(c, basis, companies, 'brand')).slice(0, 12);
  const brandSales = new Map((await salesBy(c, f, companies, 'brand')).map(b => [b.name, b.net]));
  const invByBrand = new Map();
  for (const x of done) if (x.brand) invByBrand.set(x.brand, (invByBrand.get(x.brand) || 0) + x.inv);
  w['marketing-08'] = {kind: 'table', rows: brands.map(b => [b.name, invByBrand.has(b.name) ? fmtMoney(invByBrand.get(b.name)) : '—', fmtMoney(brandSales.get(b.name) ?? b.net), signed(b.growth)])};
  const items = [];
  for (const x of done.filter(x => x.roi !== null && x.roi < 0)) items.push({t: 'Campaña con ROI negativo', d: `${x.name}: ${signed(x.roi)}`, tone: 'r'});
  const noCamp = brands.filter(b => !invByBrand.has(b.name)).slice(0, 3).map(b => b.name);
  if (camps.length && noCamp.length) items.push({t: 'Marcas sin campañas', d: noCamp.join(', '), tone: 'a'});
  if (recompra !== null && prevRecompra !== null) items.push({t: recompra >= prevRecompra ? 'Recompra al alza' : 'Recompra a la baja', d: `${fmtPct(recompra)} vs ${fmtPct(prevRecompra)} año anterior`, tone: recompra >= prevRecompra ? 'g' : 'a'});
  else if (recompra !== null) items.push({t: 'Recompra del período', d: `${fmtPct(recompra)} de los clientes compró 2 o más veces`, tone: recompra >= 30 ? 'g' : 'a'});
  if (!camps.length) items.push({t: 'Sin campañas registradas', d: 'Carga las campañas para medir inversión y ROI', tone: 'a'});
  w['marketing-12'] = list(items.slice(0, 5));
  w['marketing-13'] = text([
    camps.length ? `Del ${dmy(f.from)} al ${dmy(to)} se ejecutaron ${int.format(done.length)} de ${int.format(camps.length)} campañas, con ${fmtMoney(done.reduce((s, x) => s + x.inv, 0))} de inversión${goal ? ` (${fmtPct(done.reduce((s, x) => s + x.inv, 0) / goal * 100)} del presupuesto)` : ''}.` : 'No hay campañas registradas en el período: la inversión y el ROI se miden al cargarlas.',
    `Se captaron ${int.format(newCustomers)} clientes nuevos y la recompra es ${fmtPct(recompra)} (${scopeNote}).`,
    brands[0] ? `La marca que más vende es ${brands[0].name} (${fmtMoney(brands[0].net)}).` : '',
  ]);
}
