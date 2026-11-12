-- 0015 · Monthly trial balance per account (Odoo snapshot dataset account_balance_month).
-- Feeds the Financiero report: P&L by function (Ecuadorian chart: 4 income, 5 costs,
-- 601 selling, 602 administrative, 603 financial expenses) and balance-sheet ratios.
CREATE TABLE IF NOT EXISTS core.fact_account_month (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, company_id bigint NOT NULL,
  account_id bigint NOT NULL, code text, name text, account_type text, month date NOT NULL,
  debit numeric NOT NULL DEFAULT 0, credit numeric NOT NULL DEFAULT 0, balance numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, account_id, month)
);
CREATE INDEX IF NOT EXISTS fact_account_month_idx ON core.fact_account_month(tenant_id, month);

ALTER TABLE core.fact_account_month ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON core.fact_account_month;
CREATE POLICY tenant_isolation ON core.fact_account_month TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS worker_all ON core.fact_account_month;
CREATE POLICY worker_all ON core.fact_account_month TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT ON core.fact_account_month TO nova_api;
GRANT ALL ON core.fact_account_month TO nova_worker;
