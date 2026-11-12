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
    const salesKpi = kpi(cur.netText, fmtMoney(cur.net), [{label: 'vs año anterior', value: signed(g), tone: toneOf(g)}], {metric: 'sales_net'});
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
    if (pageId === 'financiero') w['financiero-01'] = salesKpi;
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
  if (pageId === 'inventarios') {
    const inv = await inventory(c, f, companies);
    Object.assign(w, {
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
