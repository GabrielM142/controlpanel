-- 0019 · Cash-flow scenarios per company (sales growth, promotions, investments, collection days...).
CREATE TABLE IF NOT EXISTS app.cashflow_scenarios (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  params jsonb NOT NULL CHECK (pg_column_size(params) <= 16384),
  created_by uuid REFERENCES app.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE app.cashflow_scenarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.cashflow_scenarios;
CREATE POLICY tenant_isolation ON app.cashflow_scenarios TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS worker_all ON app.cashflow_scenarios;
CREATE POLICY worker_all ON app.cashflow_scenarios TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.cashflow_scenarios TO nova_api;
GRANT USAGE ON SEQUENCE app.cashflow_scenarios_id_seq TO nova_api;
GRANT ALL ON app.cashflow_scenarios TO nova_worker;
