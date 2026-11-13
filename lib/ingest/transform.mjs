// Normalization staging -> core -> mart, limited to affected keys and dates.
// Rules (to be validated with JUJ, see docs/METRICS.md):
// - Sales = posted customer invoices/credit notes product lines (net = -balance,
//   company currency) + POS lines of paid/done orders WITHOUT invoice. An invoiced
//   POS order is only counted through its invoice (no double count).
// - Cost = anglo-saxon COGS lines (expense_direct_cost) of the same move/product,
//   or POS total_cost; NULL when unknown (margin is then partial, never invented).
// - Previous state (before) and new state both feed the affected date set, so
//   moving a document to another date/salesperson fixes the old and new groups.

const n = ids => [...new Set(ids.filter(v => v !== null && v !== undefined).map(Number))];

function attr(ctx, attribute, dataset) {
  return ctx.attributeMap.find(a => a.attribute === attribute && a.dataset === dataset)?.field || null;
}

async function ids(client, sql, params) {
  return (await client.query(sql, params)).rows.map(r => Number(r.id));
}

const UNIT_RULE = (jsonCompany, jsonJournal, jsonPos, jsonTeam, dateExpr) => `
  LEFT JOIN LATERAL (
    SELECT r.unit_code, r.channel FROM app.business_unit_rules r
     WHERE r.source_id = $2
       AND ((r.match_type = 'company' AND r.match_value = ${jsonCompany})
         OR (r.match_type = 'journal' AND r.match_value = ${jsonJournal})
         OR (r.match_type = 'pos_config' AND r.match_value = ${jsonPos})
         OR (r.match_type = 'team' AND r.match_value = ${jsonTeam}))
       AND (r.valid_from IS NULL OR r.valid_from <= ${dateExpr})
       AND (r.valid_to IS NULL OR r.valid_to > ${dateExpr})
     ORDER BY r.priority, r.id LIMIT 1) u ON true`;

async function rebuildDims(client, ctx, a) {
  const {tenantId, sourceId} = ctx;
  const states = a.of('res_country_state');
  const partners = n([...a.of('res_partner'), ...(states.length ? await ids(client,
    `SELECT record_id AS id FROM staging.records WHERE source_id = $1 AND dataset = 'res_partner' AND (data->>'state_id')::bigint = ANY($2::bigint[])`,
    [sourceId, states]) : [])]);
  const categs = a.of('product_category');
  const tmpls = n([...a.of('product_template'), ...(categs.length ? await ids(client,
    `SELECT record_id AS id FROM staging.records WHERE source_id = $1 AND dataset = 'product_template' AND (data->>'categ_id')::bigint = ANY($2::bigint[])`,
    [sourceId, categs]) : [])]);
  const products = n([...a.of('product_product'), ...(tmpls.length ? await ids(client,
    `SELECT record_id AS id FROM staging.records WHERE source_id = $1 AND dataset = 'product_product' AND (data->>'product_tmpl_id')::bigint = ANY($2::bigint[])`,
    [sourceId, tmpls]) : [])]);
  const users = a.of('res_users');
  const companies = a.of('res_company');

  if (companies.length) {
    await client.query('DELETE FROM core.dim_company WHERE source_id = $1 AND company_id = ANY($2::bigint[])', [sourceId, companies]);
    await client.query(`INSERT INTO core.dim_company(tenant_id, source_id, company_id, name, currency_id)
      SELECT $1, $2, record_id, data->>'name', (data->>'currency_id')::bigint FROM staging.records
       WHERE source_id = $2 AND dataset = 'res_company' AND NOT deleted AND record_id = ANY($3::bigint[])`, [tenantId, sourceId, companies]);
  }
  if (users.length) {
    await client.query('DELETE FROM core.dim_user WHERE source_id = $1 AND user_id = ANY($2::bigint[])', [sourceId, users]);
    await client.query(`INSERT INTO core.dim_user(tenant_id, source_id, user_id, name, active)
      SELECT $1, $2, record_id, data->>'name', (data->>'active')::boolean FROM staging.records
       WHERE source_id = $2 AND dataset = 'res_users' AND record_id = ANY($3::bigint[]) AND NOT deleted`, [tenantId, sourceId, users]);
  }
  if (partners.length) {
    const zone = attr(ctx, 'zone', 'res_partner');
    const canton = attr(ctx, 'canton', 'res_partner');
    await client.query('DELETE FROM core.dim_partner WHERE source_id = $1 AND partner_id = ANY($2::bigint[])', [sourceId, partners]);
    await client.query(`INSERT INTO core.dim_partner(tenant_id, source_id, partner_id, name, commercial_partner_id, state_id, state_name, city, zone, canton, active)
      SELECT $1, $2, p.record_id, p.data->>'name', (p.data->>'commercial_partner_id')::bigint, (p.data->>'state_id')::bigint,
             st.data->>'name', p.data->>'city',
             CASE WHEN $4::text IS NULL THEN NULL WHEN jsonb_typeof(p.data->'extra'->$4) = 'object' THEN p.data->'extra'->$4->>'name' ELSE p.data->'extra'->>$4 END,
             CASE WHEN $5::text IS NULL THEN NULL WHEN jsonb_typeof(p.data->'extra'->$5) = 'object' THEN p.data->'extra'->$5->>'name' ELSE p.data->'extra'->>$5 END,
             (p.data->>'active')::boolean
        FROM staging.records p
        LEFT JOIN staging.records st ON st.source_id = p.source_id AND st.dataset = 'res_country_state' AND st.record_id = (p.data->>'state_id')::bigint
       WHERE p.source_id = $2 AND p.dataset = 'res_partner' AND p.record_id = ANY($3::bigint[]) AND NOT p.deleted`,
      [tenantId, sourceId, partners, zone, canton]);
  }
  if (products.length) {
    const brand = attr(ctx, 'brand', 'product_template');
    await client.query('DELETE FROM core.dim_product WHERE source_id = $1 AND product_id = ANY($2::bigint[])', [sourceId, products]);
    // Archived products keep their row (active=false): history stays filterable.
    await client.query(`INSERT INTO core.dim_product(tenant_id, source_id, product_id, tmpl_id, name, default_code, categ_id, category_name, brand, product_type, active, category_top)
      SELECT $1, $2, p.record_id, t.record_id, t.data->>'name', coalesce(p.data->>'default_code', t.data->>'default_code'),
             (t.data->>'categ_id')::bigint, c.data->>'name',
             CASE WHEN $4::text IS NULL THEN NULL WHEN jsonb_typeof(t.data->'extra'->$4) = 'object' THEN t.data->'extra'->$4->>'name' ELSE t.data->'extra'->>$4 END,
             t.data->>'type', (p.data->>'active')::boolean AND coalesce((t.data->>'active')::boolean, true),
             -- Top level of the category path ("BEBIDAS / GASEOSAS" -> "BEBIDAS"); Odoo's root "All" is skipped.
             nullif(split_part(regexp_replace(coalesce(c.data->>'complete_name', c.data->>'name'), '^All( / )?', ''), ' / ', 1), '')
        FROM staging.records p
        LEFT JOIN staging.records t ON t.source_id = p.source_id AND t.dataset = 'product_template' AND t.record_id = (p.data->>'product_tmpl_id')::bigint
        LEFT JOIN staging.records c ON c.source_id = p.source_id AND c.dataset = 'product_category' AND c.record_id = (t.data->>'categ_id')::bigint
       WHERE p.source_id = $2 AND p.dataset = 'product_product' AND p.record_id = ANY($3::bigint[])`,
      [tenantId, sourceId, products, brand]);
  }
  return {partners, products, users};
}

async function salesDocs(client, ctx, a) {
  const {sourceId} = ctx;
  const amlIds = a.of('account_move_line');
  const fromLines = amlIds.length ? await ids(client,
    `SELECT DISTINCT (data->>'move_id')::bigint AS id FROM staging.records WHERE source_id = $1 AND dataset = 'account_move_line' AND record_id = ANY($2::bigint[])`,
    [sourceId, amlIds]) : [];
  const moves = n([...a.of('account_move'), ...fromLines, ...a.prevOf('account_move_line').map(d => d?.move_id)]);
  const posLines = a.of('pos_order_line');
  const fromPos = posLines.length ? await ids(client,
    `SELECT DISTINCT (data->>'order_id')::bigint AS id FROM staging.records WHERE source_id = $1 AND dataset = 'pos_order_line' AND record_id = ANY($2::bigint[])`,
    [sourceId, posLines]) : [];
  const pos = n([...a.of('pos_order'), ...fromPos, ...a.prevOf('pos_order_line').map(d => d?.order_id)]);
  return {moves, pos};
}

async function rebuildSalesFacts(client, ctx, moves, pos) {
  const {tenantId, sourceId, timezone} = ctx;
  if (moves.length) {
    await client.query(`DELETE FROM core.fact_sales_line WHERE source_id = $1 AND origin = 'invoice' AND doc_id = ANY($2::bigint[])`, [sourceId, moves]);
    const date = `coalesce((m.data->>'invoice_date')::date, (m.data->>'date')::date)`;
    await client.query(`
      INSERT INTO core.fact_sales_line(tenant_id, source_id, line_key, origin, doc_id, line_id, company_id, business_date, partner_id,
                                       product_id, salesperson_id, journal_id, pos_config_id, unit_code, channel, quantity, net_amount, cost_amount)
      SELECT $1, $2, 'aml:' || l.record_id, 'invoice', m.record_id, l.record_id, (l.data->>'company_id')::bigint, ${date},
             coalesce((m.data->>'commercial_partner_id')::bigint, (m.data->>'partner_id')::bigint),
             (l.data->>'product_id')::bigint, (m.data->>'invoice_user_id')::bigint, (m.data->>'journal_id')::bigint, NULL,
             u.unit_code, u.channel,
             CASE WHEN m.data->>'move_type' = 'out_refund' THEN -1 ELSE 1 END * coalesce((l.data->>'quantity')::numeric, 0),
             -((l.data->>'balance')::numeric),
             CASE WHEN cg.cogs IS NULL THEN NULL
                  ELSE round(cg.cogs * abs(coalesce((l.data->>'quantity')::numeric, 0)) / nullif(q.qty, 0), 4) END
        FROM staging.records l
        JOIN staging.records m ON m.source_id = l.source_id AND m.dataset = 'account_move' AND m.record_id = (l.data->>'move_id')::bigint AND NOT m.deleted
        ${UNIT_RULE(`l.data->>'company_id'`, `m.data->>'journal_id'`, `NULL`, `m.data->>'team_id'`, date)}
        LEFT JOIN LATERAL (
          SELECT sum((cl.data->>'balance')::numeric) AS cogs FROM staging.records cl
            JOIN staging.records ac ON ac.source_id = cl.source_id AND ac.dataset = 'account_account' AND ac.record_id = (cl.data->>'account_id')::bigint
           WHERE cl.source_id = l.source_id AND cl.dataset = 'account_move_line' AND NOT cl.deleted
             AND (cl.data->>'move_id')::bigint = m.record_id AND cl.data->>'display_type' = 'cogs'
             AND cl.data->>'product_id' = l.data->>'product_id' AND ac.data->>'account_type' = 'expense_direct_cost') cg ON true
        LEFT JOIN LATERAL (
          SELECT sum(abs(coalesce((pl.data->>'quantity')::numeric, 0))) AS qty FROM staging.records pl
           WHERE pl.source_id = l.source_id AND pl.dataset = 'account_move_line' AND NOT pl.deleted
             AND (pl.data->>'move_id')::bigint = m.record_id AND pl.data->>'display_type' = 'product'
             AND pl.data->>'product_id' = l.data->>'product_id') q ON true
       WHERE l.source_id = $2 AND l.dataset = 'account_move_line' AND NOT l.deleted AND l.data->>'display_type' = 'product'
         AND m.data->>'move_type' IN ('out_invoice', 'out_refund') AND m.data->>'state' = 'posted'
         AND m.record_id = ANY($3::bigint[])`, [tenantId, sourceId, moves]);
  }
  if (pos.length) {
    await client.query(`DELETE FROM core.fact_sales_line WHERE source_id = $1 AND origin = 'pos' AND doc_id = ANY($2::bigint[])`, [sourceId, pos]);
    const date = `((o.data->>'date_order')::timestamptz AT TIME ZONE $4)::date`;
    await client.query(`
      INSERT INTO core.fact_sales_line(tenant_id, source_id, line_key, origin, doc_id, line_id, company_id, business_date, partner_id,
                                       product_id, salesperson_id, journal_id, pos_config_id, unit_code, channel, quantity, net_amount, cost_amount)
      SELECT $1, $2, 'pos:' || l.record_id, 'pos', o.record_id, l.record_id, (o.data->>'company_id')::bigint, ${date},
             (o.data->>'partner_id')::bigint, (l.data->>'product_id')::bigint, (o.data->>'user_id')::bigint, NULL,
             (o.data->>'config_id')::bigint, u.unit_code, u.channel,
             coalesce((l.data->>'qty')::numeric, 0), (l.data->>'price_subtotal')::numeric, (l.data->>'total_cost')::numeric
        FROM staging.records l
        JOIN staging.records o ON o.source_id = l.source_id AND o.dataset = 'pos_order' AND o.record_id = (l.data->>'order_id')::bigint AND NOT o.deleted
        ${UNIT_RULE(`o.data->>'company_id'`, `NULL`, `o.data->>'config_id'`, `NULL`, date)}
       WHERE l.source_id = $2 AND l.dataset = 'pos_order_line' AND NOT l.deleted
         AND o.data->>'state' IN ('paid', 'done') AND (o.data->>'account_move') IS NULL
         AND o.record_id = ANY($3::bigint[])`, [tenantId, sourceId, pos, timezone]);
  }
}

async function datesFor(client, sourceId, moves, pos, products, partners, users) {
  if (!moves.length && !pos.length && !products.length && !partners.length && !users.length) return [];
  return (await client.query(`
    SELECT DISTINCT business_date::text AS d FROM core.fact_sales_line
     WHERE source_id = $1 AND ((origin = 'invoice' AND doc_id = ANY($2::bigint[])) OR (origin = 'pos' AND doc_id = ANY($3::bigint[]))
        OR product_id = ANY($4::bigint[]) OR partner_id = ANY($5::bigint[]) OR salesperson_id = ANY($6::bigint[]))`,
  [sourceId, moves, pos, products, partners, users])).rows.map(r => r.d);
}

async function rebuildSalesMart(client, ctx, dates) {
  if (!dates.length) return;
  const {tenantId, sourceId} = ctx;
  await client.query('DELETE FROM mart.sales_day WHERE source_id = $1 AND business_date = ANY($2::date[])', [sourceId, dates]);
  await client.query(`
    INSERT INTO mart.sales_day(tenant_id, source_id, company_id, business_date, origin, unit_code, channel, salesperson_id, brand,
                               categ_id, state_id, net_amount, cost_amount, cost_known_net, quantity, lines)
    SELECT $1, f.source_id, f.company_id, f.business_date, f.origin, f.unit_code, f.channel, f.salesperson_id, p.brand, p.categ_id,
           c.state_id, sum(f.net_amount), coalesce(sum(f.cost_amount), 0),
           coalesce(sum(f.net_amount) FILTER (WHERE f.cost_amount IS NOT NULL), 0), sum(f.quantity), count(*)
      FROM core.fact_sales_line f
      LEFT JOIN core.dim_product p ON p.source_id = f.source_id AND p.product_id = f.product_id
      LEFT JOIN core.dim_partner c ON c.source_id = f.source_id AND c.partner_id = f.partner_id
     WHERE f.source_id = $2 AND f.business_date = ANY($3::date[])
     GROUP BY f.source_id, f.company_id, f.business_date, f.origin, f.unit_code, f.channel, f.salesperson_id, p.brand, p.categ_id, c.state_id`,
  [tenantId, sourceId, dates]);
}

async function rebuildReceivables(client, ctx, a, moves) {
  const {tenantId, sourceId} = ctx;
  const accountsChanged = a.of('account_account').length > 0;
  const lineIds = n([...a.of('account_move_line')]);
  if (!lineIds.length && !moves.length && !accountsChanged) return;
  const scope = accountsChanged ? 'true' : `(l.record_id = ANY($3::bigint[]) OR (l.data->>'move_id')::bigint = ANY($4::bigint[]))`;
  await client.query(`DELETE FROM core.fact_receivable_item r WHERE r.source_id = $1 AND (${accountsChanged ? 'true'
    : 'r.line_id = ANY($2::bigint[]) OR r.move_id = ANY($3::bigint[])'})`, accountsChanged ? [sourceId] : [sourceId, lineIds, moves]);
  await client.query(`
    INSERT INTO core.fact_receivable_item(tenant_id, source_id, line_id, move_id, company_id, partner_id, doc_date, date_maturity, amount, residual)
    SELECT $1, $2, l.record_id, (l.data->>'move_id')::bigint, (l.data->>'company_id')::bigint,
           coalesce((m.data->>'commercial_partner_id')::bigint, (l.data->>'partner_id')::bigint),
           (l.data->>'date')::date, coalesce((l.data->>'date_maturity')::date, (l.data->>'date')::date),
           (l.data->>'balance')::numeric, (l.data->>'amount_residual')::numeric
      FROM staging.records l
      JOIN staging.records ac ON ac.source_id = l.source_id AND ac.dataset = 'account_account' AND ac.record_id = (l.data->>'account_id')::bigint
      LEFT JOIN staging.records m ON m.source_id = l.source_id AND m.dataset = 'account_move' AND m.record_id = (l.data->>'move_id')::bigint
     WHERE l.source_id = $2 AND l.dataset = 'account_move_line' AND NOT l.deleted AND ac.data->>'account_type' = 'asset_receivable'
       AND coalesce(l.data->>'parent_state', m.data->>'state') = 'posted' AND ${scope}`,
  accountsChanged ? [tenantId, sourceId] : [tenantId, sourceId, lineIds, moves]);
}

async function rebuildOrders(client, ctx, a) {
  const {tenantId, sourceId, timezone} = ctx;
  const lines = a.of('sale_order_line');
  const fromLines = lines.length ? await ids(client,
    `SELECT DISTINCT (data->>'order_id')::bigint AS id FROM staging.records WHERE source_id = $1 AND dataset = 'sale_order_line' AND record_id = ANY($2::bigint[])`,
    [sourceId, lines]) : [];
  const orders = n([...a.of('sale_order'), ...fromLines, ...a.prevOf('sale_order_line').map(d => d?.order_id)]);
  if (!orders.length) return;
  await client.query('DELETE FROM core.fact_order_line WHERE source_id = $1 AND order_id = ANY($2::bigint[])', [sourceId, orders]);
  await client.query(`
    INSERT INTO core.fact_order_line(tenant_id, source_id, line_id, order_id, company_id, order_date, partner_id, product_id, salesperson_id,
                                     state, qty_ordered, qty_delivered, qty_invoiced, amount_untaxed, pending_invoice_amount, backorder_amount)
    SELECT $1, $2, l.record_id, o.record_id, (o.data->>'company_id')::bigint, ((o.data->>'date_order')::timestamptz AT TIME ZONE $4)::date,
           (o.data->>'partner_id')::bigint, (l.data->>'product_id')::bigint, (o.data->>'user_id')::bigint, o.data->>'state',
           (l.data->>'product_uom_qty')::numeric, (l.data->>'qty_delivered')::numeric, (l.data->>'qty_invoiced')::numeric,
           (l.data->>'price_subtotal')::numeric,
           -- Pending to invoice = what Odoo itself considers invoiceable and not invoiced
           -- (qty_to_invoice follows the product's invoice policy: ordered or delivered).
           -- "Ordered - invoiced" counted undelivered quantities as pending invoices.
           round((l.data->>'price_subtotal')::numeric / nullif((l.data->>'product_uom_qty')::numeric, 0)
                 * greatest(coalesce((l.data->>'qty_to_invoice')::numeric,
                                     (l.data->>'product_uom_qty')::numeric - (l.data->>'qty_invoiced')::numeric), 0), 4),
           -- Backorder = undelivered quantity of orders Odoo still expects to ship. An order whose
           -- deliveries are all done/cancelled (delivery_status 'full') keeps a dead remainder
           -- that never ships (in staging: 2.401 orders, $21,5 M) and is excluded.
           CASE WHEN o.data->>'delivery_status' = 'full' THEN 0 ELSE
           round((l.data->>'price_subtotal')::numeric / nullif((l.data->>'product_uom_qty')::numeric, 0)
                 * greatest((l.data->>'product_uom_qty')::numeric - (l.data->>'qty_delivered')::numeric, 0), 4) END
      FROM staging.records l
      JOIN staging.records o ON o.source_id = l.source_id AND o.dataset = 'sale_order' AND o.record_id = (l.data->>'order_id')::bigint AND NOT o.deleted
     WHERE l.source_id = $2 AND l.dataset = 'sale_order_line' AND NOT l.deleted AND (l.data->>'display_type') IS NULL
       AND o.data->>'state' IN ('sale', 'done') AND o.record_id = ANY($3::bigint[])`, [tenantId, sourceId, orders, timezone]);
}

async function rebuildStock(client, ctx, a) {
  const {tenantId, sourceId} = ctx;
  const locations = a.of('stock_location');
  const warehouses = a.of('stock_warehouse');
  if (warehouses.length) {
    await client.query('DELETE FROM core.dim_warehouse WHERE source_id = $1 AND warehouse_id = ANY($2::bigint[])', [sourceId, warehouses]);
    await client.query(`
      INSERT INTO core.dim_warehouse(tenant_id, source_id, warehouse_id, name, code, company_id, active)
      SELECT $1, $2, record_id, data->>'name', data->>'code', (data->>'company_id')::bigint, coalesce((data->>'active')::boolean, true)
        FROM staging.records WHERE source_id = $2 AND dataset = 'stock_warehouse' AND NOT deleted AND record_id = ANY($3::bigint[])`,
    [tenantId, sourceId, warehouses]);
  }
  if (locations.length) {
    await client.query('DELETE FROM core.dim_location WHERE source_id = $1 AND location_id = ANY($2::bigint[])', [sourceId, locations]);
    await client.query(`
      INSERT INTO core.dim_location(tenant_id, source_id, location_id, name, complete_name, usage, warehouse_id, company_id, active)
      SELECT $1, $2, record_id, data->>'name', data->>'complete_name', data->>'usage', (data->>'warehouse_id')::bigint,
             (data->>'company_id')::bigint, coalesce((data->>'active')::boolean, true)
        FROM staging.records WHERE source_id = $2 AND dataset = 'stock_location' AND NOT deleted AND record_id = ANY($3::bigint[])`,
    [tenantId, sourceId, locations]);
  }
  const quants = n([...a.of('stock_quant'), ...(locations.length ? await ids(client,
    `SELECT record_id AS id FROM staging.records WHERE source_id = $1 AND dataset = 'stock_quant' AND (data->>'location_id')::bigint = ANY($2::bigint[])`,
    [sourceId, locations]) : [])]);
  if (quants.length) {
    await client.query('DELETE FROM core.fact_stock_quant WHERE source_id = $1 AND quant_id = ANY($2::bigint[])', [sourceId, quants]);
    await client.query(`
      INSERT INTO core.fact_stock_quant(tenant_id, source_id, quant_id, company_id, product_id, location_id, internal, quantity, reserved)
      SELECT $1, $2, q.record_id, (q.data->>'company_id')::bigint, (q.data->>'product_id')::bigint, (q.data->>'location_id')::bigint,
             coalesce(loc.data->>'usage' = 'internal', false), (q.data->>'quantity')::numeric, (q.data->>'reserved_quantity')::numeric
        FROM staging.records q
        LEFT JOIN staging.records loc ON loc.source_id = q.source_id AND loc.dataset = 'stock_location' AND loc.record_id = (q.data->>'location_id')::bigint
       WHERE q.source_id = $2 AND q.dataset = 'stock_quant' AND NOT q.deleted AND q.record_id = ANY($3::bigint[])`, [tenantId, sourceId, quants]);
  }
  const layers = a.of('stock_valuation_layer');
  if (layers.length) {
    await client.query('DELETE FROM core.fact_valuation_layer WHERE source_id = $1 AND layer_id = ANY($2::bigint[])', [sourceId, layers]);
    await client.query(`
      INSERT INTO core.fact_valuation_layer(tenant_id, source_id, layer_id, company_id, product_id, quantity, value, created_at)
      SELECT $1, $2, record_id, (data->>'company_id')::bigint, (data->>'product_id')::bigint, (data->>'quantity')::numeric,
             (data->>'value')::numeric, (data->>'create_date')::timestamptz
        FROM staging.records WHERE source_id = $2 AND dataset = 'stock_valuation_layer' AND NOT deleted AND record_id = ANY($3::bigint[])`,
    [tenantId, sourceId, layers]);
  }
}

/**
 * Cost of sales from Odoo's own delivery entries (continental accounting, real-time valuation):
 * journal items exported because they sit on a category's stock output account and come from a
 * stock move (see nova_stock_account). They are neither customer-invoice lines nor receivables.
 * An invoice line without cost of its own (no anglo-saxon cogs) gets quantity x the unit cost
 * booked for that product on the invoice date, or on the closest delivery date (earlier first).
 * Returns the business dates whose sales mart must be recomputed.
 */
async function applyStockCost(client, ctx, a, moves) {
  const {tenantId, sourceId} = ctx;
  const lineIds = a.of('account_move_line');
  let products = [];
  if (lineIds.length) {
    products = (await client.query(
      `SELECT DISTINCT product_id FROM (
         SELECT (data->>'product_id')::bigint AS product_id FROM staging.records WHERE source_id = $1 AND dataset = 'account_move_line' AND record_id = ANY($2::bigint[])
         UNION SELECT product_id FROM core.fact_cost_line WHERE source_id = $1 AND line_id = ANY($2::bigint[])) x WHERE product_id IS NOT NULL`,
      [sourceId, lineIds])).rows.map(r => r.product_id);
    await client.query('DELETE FROM core.fact_cost_line WHERE source_id = $1 AND line_id = ANY($2::bigint[])', [sourceId, lineIds]);
    await client.query(`
      INSERT INTO core.fact_cost_line(tenant_id, source_id, line_id, company_id, cost_date, product_id, quantity, amount)
      SELECT $1, $2, l.record_id, (l.data->>'company_id')::bigint, (l.data->>'date')::date, (l.data->>'product_id')::bigint,
             coalesce((l.data->>'quantity')::numeric, 0), (l.data->>'balance')::numeric
        FROM staging.records l
        JOIN staging.records ac ON ac.source_id = l.source_id AND ac.dataset = 'account_account' AND ac.record_id = (l.data->>'account_id')::bigint
       WHERE l.source_id = $2 AND l.dataset = 'account_move_line' AND NOT l.deleted AND l.record_id = ANY($3::bigint[])
         AND ac.data->>'account_type' NOT IN ('asset_receivable', 'income', 'income_other')
         AND coalesce(l.data->>'display_type', '') <> 'cogs'
         AND (l.data->>'date') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM staging.records m WHERE m.source_id = l.source_id AND m.dataset = 'account_move'
                          AND m.record_id = (l.data->>'move_id')::bigint AND NOT m.deleted)`,
    [tenantId, sourceId, lineIds]);
  }
  if (!products.length && !moves.length) return [];
  return (await client.query(`
    UPDATE core.fact_sales_line s SET cost_amount = (
      SELECT round(s.quantity * d.unit, 4) FROM (
        -- Odoo books deliveries with a negative quantity (stock leaving) and a positive cost.
        SELECT c.cost_date, sum(c.amount) / nullif(sum(abs(c.quantity)), 0) AS unit FROM core.fact_cost_line c
         WHERE c.source_id = s.source_id AND c.company_id = s.company_id AND c.product_id = s.product_id AND c.amount > 0 AND c.quantity <> 0
         GROUP BY c.cost_date) d
       WHERE d.unit IS NOT NULL ORDER BY (d.cost_date > s.business_date), abs(d.cost_date - s.business_date) LIMIT 1)
     WHERE s.source_id = $1 AND s.origin = 'invoice' AND s.cost_amount IS NULL AND s.product_id IS NOT NULL
       AND (s.product_id = ANY($2::bigint[]) OR s.doc_id = ANY($3::bigint[]))
    RETURNING s.business_date::text AS d`, [sourceId, products, moves])).rows.map(r => r.d);
}

/** Stock pickings (all types; the Logística report reads the outgoing ones). */
async function rebuildPickings(client, ctx, a) {
  const {tenantId, sourceId, timezone} = ctx;
  const picks = a.of('stock_picking');
  if (!picks.length) return;
  // A new backorder changes its parent's "in full" flag: rebuild the parents too.
  const all = n([...picks, ...await ids(client,
    `SELECT DISTINCT (data->>'backorder_id')::bigint AS id FROM staging.records WHERE source_id = $1 AND dataset = 'stock_picking'
      AND record_id = ANY($2::bigint[]) AND data->>'backorder_id' IS NOT NULL`, [sourceId, picks])]);
  await client.query('DELETE FROM core.fact_picking WHERE source_id = $1 AND picking_id = ANY($2::bigint[])', [sourceId, all]);
  const local = col => `((${col})::timestamptz AT TIME ZONE $4)::date`;
  await client.query(`
    WITH so AS (SELECT data->>'name' AS name, min(${local("data->>'date_order'")}) AS order_date,
                       min(data->>'team_id') AS team_id FROM staging.records
                 WHERE source_id = $2 AND dataset = 'sale_order' AND NOT deleted GROUP BY 1),
         split AS (SELECT DISTINCT (data->>'backorder_id')::bigint AS parent FROM staging.records
                    WHERE source_id = $2 AND dataset = 'stock_picking' AND NOT deleted AND data->>'backorder_id' IS NOT NULL AND data->>'state' <> 'cancel')
    INSERT INTO core.fact_picking(tenant_id, source_id, picking_id, company_id, partner_id, type_code, state, order_date,
                                  scheduled_date, deadline_date, done_date, is_backorder, in_full, unit_code)
    SELECT $1, $2, p.record_id, (p.data->>'company_id')::bigint, (p.data->>'partner_id')::bigint, t.data->>'code', p.data->>'state',
           so.order_date, ${local("p.data->>'scheduled_date'")}, ${local("p.data->>'date_deadline'")}, ${local("p.data->>'date_done'")},
           p.data->>'backorder_id' IS NOT NULL, split.parent IS NULL, u.unit_code
      FROM staging.records p
      LEFT JOIN staging.records t ON t.source_id = p.source_id AND t.dataset = 'stock_picking_type' AND t.record_id = (p.data->>'picking_type_id')::bigint
      LEFT JOIN so ON so.name = p.data->>'origin'
      LEFT JOIN split ON split.parent = p.record_id
      ${UNIT_RULE(`p.data->>'company_id'`, `NULL`, `NULL`, `so.team_id`, `coalesce(${local("p.data->>'date_done'")}, so.order_date)`)}
     WHERE p.source_id = $2 AND p.dataset = 'stock_picking' AND NOT p.deleted AND p.record_id = ANY($3::bigint[])`,
  [tenantId, sourceId, all, timezone]);
}

/** Confirmed purchase order lines (quantities and amounts kept per line, no duplication). */
async function rebuildPurchases(client, ctx, a) {
  const {tenantId, sourceId, timezone} = ctx;
  const lines = a.of('purchase_order_line');
  const orders = n([...a.of('purchase_order'), ...(lines.length ? await ids(client,
    `SELECT DISTINCT (data->>'order_id')::bigint AS id FROM staging.records WHERE source_id = $1 AND dataset = 'purchase_order_line' AND record_id = ANY($2::bigint[])`,
    [sourceId, lines]) : [])]);
  if (!orders.length) return;
  await client.query('DELETE FROM core.fact_purchase_line WHERE source_id = $1 AND order_id = ANY($2::bigint[])', [sourceId, orders]);
  const local = col => `((${col})::timestamptz AT TIME ZONE $4)::date`;
  await client.query(`
    INSERT INTO core.fact_purchase_line(tenant_id, source_id, line_id, order_id, company_id, partner_id, product_id, approve_date,
                                        planned_date, receipt_date, state, receipt_status, qty, qty_received, amount)
    SELECT $1, $2, l.record_id, o.record_id, (o.data->>'company_id')::bigint, (o.data->>'partner_id')::bigint, (l.data->>'product_id')::bigint,
           ${local("coalesce(o.data->>'date_approve', o.data->>'date_order')")}, ${local("l.data->>'date_planned'")},
           ${local("o.data->>'effective_date'")}, o.data->>'state', o.data->>'receipt_status',
           coalesce((l.data->>'product_qty')::numeric, 0), coalesce((l.data->>'qty_received')::numeric, 0), coalesce((l.data->>'price_subtotal')::numeric, 0)
      FROM staging.records l
      JOIN staging.records o ON o.source_id = l.source_id AND o.dataset = 'purchase_order' AND o.record_id = (l.data->>'order_id')::bigint AND NOT o.deleted
     WHERE l.source_id = $2 AND l.dataset = 'purchase_order_line' AND NOT l.deleted AND (l.data->>'display_type') IS NULL
       AND o.data->>'state' IN ('purchase', 'done') AND o.record_id = ANY($3::bigint[])`, [tenantId, sourceId, orders, timezone]);
}

/** Monthly trial balance: a small snapshot dataset, rebuilt whole whenever it arrives. */
async function rebuildAccountMonths(client, ctx, a) {
  const {tenantId, sourceId} = ctx;
  if (!a.of('account_balance_month').length && !(a.prevOf?.('account_balance_month') || []).length) return;
  await client.query('DELETE FROM core.fact_account_month WHERE source_id = $1', [sourceId]);
  await client.query(`
    INSERT INTO core.fact_account_month(tenant_id, source_id, company_id, account_id, code, name, account_type, month, debit, credit, balance)
    SELECT $1, $2, (r.data->>'company_id')::bigint, (r.data->>'account_id')::bigint, r.data->>'code', r.data->>'name', r.data->>'account_type',
           (r.data->>'month')::date, coalesce((r.data->>'debit')::numeric, 0), coalesce((r.data->>'credit')::numeric, 0),
           coalesce((r.data->>'balance')::numeric, 0)
      FROM staging.records r
     WHERE r.source_id = $2 AND r.dataset = 'account_balance_month' AND NOT r.deleted
       AND r.data->>'account_id' IS NOT NULL AND r.data->>'month' IS NOT NULL
    ON CONFLICT (source_id, account_id, month) DO UPDATE
       SET debit = core.fact_account_month.debit + EXCLUDED.debit, credit = core.fact_account_month.credit + EXCLUDED.credit,
           balance = core.fact_account_month.balance + EXCLUDED.balance`, [tenantId, sourceId]);
}

/** Monthly warehouse operations: small snapshot dataset, rebuilt whole whenever it arrives. */
async function rebuildStockOps(client, ctx, a) {
  const {tenantId, sourceId} = ctx;
  if (!a.of('stock_ops_month').length && !(a.prevOf?.('stock_ops_month') || []).length) return;
  await client.query('DELETE FROM core.fact_stock_ops_month WHERE source_id = $1', [sourceId]);
  await client.query(`
    INSERT INTO core.fact_stock_ops_month(tenant_id, source_id, company_id, kind, month, moves, products, value_net, value_abs, hours)
    SELECT $1, $2, (r.data->>'company_id')::bigint, r.data->>'kind', (r.data->>'month')::date,
           sum(coalesce((r.data->>'moves')::int, 0)), sum(coalesce((r.data->>'products')::int, 0)),
           sum(coalesce((r.data->>'value_net')::numeric, 0)), sum(coalesce((r.data->>'value_abs')::numeric, 0)),
           sum(coalesce((r.data->>'hours')::numeric, 0))
      FROM staging.records r
     WHERE r.source_id = $2 AND r.dataset = 'stock_ops_month' AND NOT r.deleted
       AND r.data->>'company_id' IS NOT NULL AND r.data->>'kind' IS NOT NULL AND r.data->>'month' IS NOT NULL
     GROUP BY 3, 4, 5`, [tenantId, sourceId]);
}

/** Companies, journals, POS and sales teams with names: what a business-unit rule can match. */
async function rebuildUnitSources(client, ctx) {
  const {tenantId, sourceId} = ctx;
  await client.query('DELETE FROM core.dim_unit_source WHERE source_id = $1', [sourceId]);
  await client.query(`
    INSERT INTO core.dim_unit_source(tenant_id, source_id, match_type, match_value, name)
    SELECT $1, $2, CASE dataset WHEN 'res_company' THEN 'company' WHEN 'account_journal' THEN 'journal'
                                WHEN 'pos_config' THEN 'pos_config' ELSE 'team' END,
           record_id::text, left(coalesce(data->>'name', '') || CASE WHEN dataset = 'account_journal' AND data->>'code' IS NOT NULL
                                                                     THEN ' (' || (data->>'code') || ')' ELSE '' END, 160)
      FROM staging.records
     WHERE source_id = $2 AND NOT deleted AND dataset IN ('res_company', 'account_journal', 'pos_config', 'crm_team')
       AND (dataset <> 'account_journal' OR data->>'type' = 'sale')
    ON CONFLICT DO NOTHING`, [tenantId, sourceId]);
}

export async function rebuildCore(client, ctx, affected) {
  const dims = await rebuildDims(client, ctx, affected);
  const {moves, pos} = await salesDocs(client, ctx, affected);
  const before = await datesFor(client, ctx.sourceId, moves, pos, dims.products, dims.partners, dims.users);
  await rebuildSalesFacts(client, ctx, moves, pos);
  const after = await datesFor(client, ctx.sourceId, moves, pos, dims.products, dims.partners, dims.users);
  const costDates = await applyStockCost(client, ctx, affected, moves);
  const dates = [...new Set([...before, ...after, ...costDates])].sort();
  await rebuildSalesMart(client, ctx, dates);
  await rebuildReceivables(client, ctx, affected, moves);
  await rebuildOrders(client, ctx, affected);
  await rebuildPurchases(client, ctx, affected);
  await rebuildPickings(client, ctx, affected);
  await rebuildAccountMonths(client, ctx, affected);
  await rebuildStockOps(client, ctx, affected);
  await rebuildUnitSources(client, ctx);
  await rebuildStock(client, ctx, affected);
  return dates;
}

/** Daily balance snapshots at the business date: aging changes even without writes. */
export async function rebuildSnapshots(client, ctx, businessDate) {
  const {tenantId, sourceId} = ctx;
  if (!businessDate) return;
  await client.query('DELETE FROM mart.receivable_day WHERE source_id = $1 AND snapshot_date = $2', [sourceId, businessDate]);
  await client.query(`
    INSERT INTO mart.receivable_day(tenant_id, source_id, company_id, snapshot_date, partner_id, residual, overdue, b0_30, b31_60, b61_90, b90p, items)
    -- partner 0 = "sin cliente": Odoo has receivable lines without partner (adjustments,
    -- openings); they belong to the balance and partner_id is part of the primary key.
    SELECT $1, $2, company_id, $3::date, coalesce(partner_id, 0), sum(residual),
           coalesce(sum(residual) FILTER (WHERE date_maturity < $3::date), 0),
           coalesce(sum(residual) FILTER (WHERE $3::date - date_maturity BETWEEN 1 AND 30), 0),
           coalesce(sum(residual) FILTER (WHERE $3::date - date_maturity BETWEEN 31 AND 60), 0),
           coalesce(sum(residual) FILTER (WHERE $3::date - date_maturity BETWEEN 61 AND 90), 0),
           coalesce(sum(residual) FILTER (WHERE $3::date - date_maturity > 90), 0), count(*)
      FROM core.fact_receivable_item WHERE source_id = $2 AND residual <> 0 AND doc_date <= $3::date
     GROUP BY company_id, coalesce(partner_id, 0)`, [tenantId, sourceId, businessDate]);
  await client.query('DELETE FROM mart.inventory_day WHERE source_id = $1 AND snapshot_date = $2', [sourceId, businessDate]);
  await client.query(`
    INSERT INTO mart.inventory_day(tenant_id, source_id, company_id, snapshot_date, product_id, qty_internal, value)
    SELECT $1, $2, coalesce(q.company_id, v.company_id), $3::date, coalesce(q.product_id, v.product_id), coalesce(q.qty, 0), v.value
      FROM (SELECT company_id, product_id, sum(quantity) AS qty FROM core.fact_stock_quant WHERE source_id = $2 AND internal GROUP BY 1, 2) q
      FULL JOIN (SELECT company_id, product_id, sum(value) AS value FROM core.fact_valuation_layer
                  WHERE source_id = $2 AND created_at < ($3::date + 1) GROUP BY 1, 2) v
        ON v.company_id = q.company_id AND v.product_id = q.product_id`, [tenantId, sourceId, businessDate]);
}

/** Full rebuild for a source (after changing business-unit rules or attribute map). */
export async function rebuildAll(client, ctx) {
  const all = {of: ds => [], prevOf: () => []};
  const datasets = ['res_company', 'res_users', 'res_partner', 'product_product', 'account_move', 'pos_order', 'sale_order',
    'stock_quant', 'stock_valuation_layer', 'stock_warehouse', 'stock_location', 'account_move_line', 'purchase_order', 'stock_picking',
    'account_balance_month', 'stock_ops_month'];
  const map = new Map();
  for (const ds of datasets) map.set(ds, await ids(client, 'SELECT record_id AS id FROM staging.records WHERE source_id = $1 AND dataset = $2', [ctx.sourceId, ds]));
  all.of = ds => map.get(ds) || [];
  await client.query('DELETE FROM mart.sales_day WHERE source_id = $1', [ctx.sourceId]);
  return rebuildCore(client, ctx, all);
}
