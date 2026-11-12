-- 0003 · Conformed dimensions, facts and marts. Money is NUMERIC (never float).
-- Facts keep tenant, source, company, source ids and business date; marts are
-- rebuilt only for affected dates. Dimensions are "as it is now" (current
-- attribute); historized dimensions (SCD2) are added only when the business
-- requires "as it was" analysis.

CREATE TABLE IF NOT EXISTS core.dim_company (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, company_id bigint NOT NULL,
  name text, currency_id bigint,
  PRIMARY KEY (source_id, company_id)
);
CREATE TABLE IF NOT EXISTS core.dim_partner (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, partner_id bigint NOT NULL,
  name text, commercial_partner_id bigint, state_id bigint, state_name text, city text,
  zone text, canton text, active boolean,
  PRIMARY KEY (source_id, partner_id)
);
CREATE TABLE IF NOT EXISTS core.dim_product (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, product_id bigint NOT NULL,
  tmpl_id bigint, name text, default_code text, categ_id bigint, category_name text,
  brand text, product_type text, active boolean,
  PRIMARY KEY (source_id, product_id)
);
CREATE TABLE IF NOT EXISTS core.dim_user (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, user_id bigint NOT NULL,
  name text, active boolean,
  PRIMARY KEY (source_id, user_id)
);

-- Unified sales line: invoice lines (posted customer invoices/credit notes) and
-- POS lines not invoiced. An invoiced POS order is counted through its invoice.
CREATE TABLE IF NOT EXISTS core.fact_sales_line (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL,
  line_key text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('invoice', 'pos')),
  doc_id bigint NOT NULL, line_id bigint NOT NULL,
  company_id bigint NOT NULL,
  business_date date NOT NULL,
  partner_id bigint, product_id bigint, salesperson_id bigint,
  journal_id bigint, pos_config_id bigint,
  unit_code text, channel text,
  quantity numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL,
  cost_amount numeric,
  PRIMARY KEY (source_id, line_key)
);
CREATE INDEX IF NOT EXISTS fact_sales_date_idx ON core.fact_sales_line(tenant_id, business_date);
CREATE INDEX IF NOT EXISTS fact_sales_doc_idx ON core.fact_sales_line(source_id, origin, doc_id);

CREATE TABLE IF NOT EXISTS core.fact_order_line (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, line_id bigint NOT NULL,
  order_id bigint NOT NULL, company_id bigint NOT NULL, order_date date,
  partner_id bigint, product_id bigint, salesperson_id bigint, state text,
  qty_ordered numeric, qty_delivered numeric, qty_invoiced numeric,
  amount_untaxed numeric, pending_invoice_amount numeric, backorder_amount numeric,
  PRIMARY KEY (source_id, line_id)
);

CREATE TABLE IF NOT EXISTS core.fact_receivable_item (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, line_id bigint NOT NULL,
  move_id bigint, company_id bigint NOT NULL, partner_id bigint,
  doc_date date, date_maturity date, amount numeric NOT NULL, residual numeric NOT NULL,
  PRIMARY KEY (source_id, line_id)
);

CREATE TABLE IF NOT EXISTS core.fact_stock_quant (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, quant_id bigint NOT NULL,
  company_id bigint NOT NULL, product_id bigint, location_id bigint, internal boolean NOT NULL,
  quantity numeric NOT NULL, reserved numeric,
  PRIMARY KEY (source_id, quant_id)
);

CREATE TABLE IF NOT EXISTS core.fact_valuation_layer (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, layer_id bigint NOT NULL,
  company_id bigint NOT NULL, product_id bigint, quantity numeric, value numeric NOT NULL,
  created_at timestamptz,
  PRIMARY KEY (source_id, layer_id)
);

-- Marts -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mart.sales_day (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, company_id bigint NOT NULL,
  business_date date NOT NULL, origin text NOT NULL,
  unit_code text, channel text, salesperson_id bigint, brand text, categ_id bigint, state_id bigint,
  net_amount numeric NOT NULL, cost_amount numeric NOT NULL, cost_known_net numeric NOT NULL,
  quantity numeric NOT NULL, lines integer NOT NULL
);
CREATE INDEX IF NOT EXISTS mart_sales_day_idx ON mart.sales_day(tenant_id, business_date);
CREATE INDEX IF NOT EXISTS mart_sales_day_src_idx ON mart.sales_day(source_id, business_date);

CREATE OR REPLACE VIEW mart.sales_month AS
SELECT tenant_id, source_id, company_id, date_trunc('month', business_date)::date AS month,
       origin, unit_code, channel, salesperson_id, brand, categ_id, state_id,
       sum(net_amount) AS net_amount, sum(cost_amount) AS cost_amount,
       sum(cost_known_net) AS cost_known_net, sum(quantity) AS quantity, sum(lines) AS lines
  FROM mart.sales_day
 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;

-- Balances are snapshots per cut date: never summed across dates.
CREATE TABLE IF NOT EXISTS mart.receivable_day (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, company_id bigint NOT NULL,
  snapshot_date date NOT NULL, partner_id bigint,
  residual numeric NOT NULL, overdue numeric NOT NULL,
  b0_30 numeric NOT NULL, b31_60 numeric NOT NULL, b61_90 numeric NOT NULL, b90p numeric NOT NULL,
  items integer NOT NULL,
  PRIMARY KEY (source_id, company_id, snapshot_date, partner_id)
);

CREATE TABLE IF NOT EXISTS mart.inventory_day (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, company_id bigint NOT NULL,
  snapshot_date date NOT NULL, product_id bigint NOT NULL,
  qty_internal numeric NOT NULL, value numeric,
  PRIMARY KEY (source_id, company_id, snapshot_date, product_id)
);

CREATE TABLE IF NOT EXISTS mart.executive_snapshot (
  tenant_id uuid NOT NULL, version integer NOT NULL, business_date date,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, version)
);
