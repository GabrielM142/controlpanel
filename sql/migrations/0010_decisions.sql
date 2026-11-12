-- 0010 · Decision inbox per company: items created from Omega and the status of every decision
-- (also derived ones such as exceeded thresholds, keyed by their id), with who decided and when.
CREATE TABLE IF NOT EXISTS app.decisions (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 80),
  kind text NOT NULL DEFAULT 'omega' CHECK (kind IN ('compra', 'descuento', 'reclamo', 'umbral', 'omega')),
  title text CHECK (length(title) <= 300),
  detail text CHECK (length(detail) <= 2000),
  recommendation text CHECK (length(recommendation) <= 1000),
  amount numeric,
  priority text NOT NULL DEFAULT 'media' CHECK (priority IN ('alta', 'media', 'baja')),
  page_id text CHECK (length(page_id) <= 40),
  source text CHECK (length(source) <= 120),
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'aprobada', 'rechazada', 'escalada', 'reasignada')),
  created_by uuid REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES app.users(id),
  decided_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE app.decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.decisions;
CREATE POLICY tenant_isolation ON app.decisions TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS worker_all ON app.decisions;
CREATE POLICY worker_all ON app.decisions TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON app.decisions TO nova_api;
GRANT ALL ON app.decisions TO nova_worker;
