-- 0020 · Real Omega IA usage per company and user (replaces the browser-only token simulation in live mode).
CREATE TABLE IF NOT EXISTS app.ai_usage (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  user_id uuid REFERENCES app.users(id),
  page_id text CHECK (length(page_id) <= 40),
  provider text CHECK (length(provider) <= 20),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_tenant_at_idx ON app.ai_usage(tenant_id, at DESC);
ALTER TABLE app.ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.ai_usage;
CREATE POLICY tenant_isolation ON app.ai_usage TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS worker_all ON app.ai_usage;
CREATE POLICY worker_all ON app.ai_usage TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON app.ai_usage TO nova_api;
GRANT USAGE ON SEQUENCE app.ai_usage_id_seq TO nova_api;
GRANT ALL ON app.ai_usage TO nova_worker;
