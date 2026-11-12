-- 0011 · Purchase lines in core for the Compras report (RLS per tenant like every core table).
CREATE TABLE IF NOT EXISTS core.fact_purchase_line (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, line_id bigint NOT NULL,
  order_id bigint NOT NULL, company_id bigint NOT NULL, partner_id bigint, product_id bigint,
  approve_date date, planned_date date, receipt_date date, state text, receipt_status text,
  qty numeric NOT NULL DEFAULT 0, qty_received numeric NOT NULL DEFAULT 0, amount numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, line_id)
);
CREATE INDEX IF NOT EXISTS fact_purchase_line_date_idx ON core.fact_purchase_line(source_id, approve_date);

ALTER TABLE core.fact_purchase_line ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON core.fact_purchase_line;
CREATE POLICY tenant_isolation ON core.fact_purchase_line TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS worker_all ON core.fact_purchase_line;
CREATE POLICY worker_all ON core.fact_purchase_line TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT ON core.fact_purchase_line TO nova_api;
GRANT ALL ON core.fact_purchase_line TO nova_worker;
