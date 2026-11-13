-- 0016 · Monthly warehouse operations (Odoo snapshot dataset stock_ops_month).
-- kind = 'adjust': inventory adjustments (count, products, net and absolute value);
-- kind = 'prep': validated outgoing deliveries and total hours from creation to validation.
CREATE TABLE IF NOT EXISTS core.fact_stock_ops_month (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, company_id bigint NOT NULL,
  kind text NOT NULL, month date NOT NULL,
  moves integer NOT NULL DEFAULT 0, products integer NOT NULL DEFAULT 0,
  value_net numeric NOT NULL DEFAULT 0, value_abs numeric NOT NULL DEFAULT 0, hours numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, company_id, kind, month)
);

ALTER TABLE core.fact_stock_ops_month ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON core.fact_stock_ops_month;
CREATE POLICY tenant_isolation ON core.fact_stock_ops_month TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS worker_all ON core.fact_stock_ops_month;
CREATE POLICY worker_all ON core.fact_stock_ops_month TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT ON core.fact_stock_ops_month TO nova_api;
GRANT ALL ON core.fact_stock_ops_month TO nova_worker;
