-- 0017 · Company inputs that Odoo does not hold: budgets (sales, purchases, fixed costs,
-- marketing), marketing campaigns and the business-unit rules editor (catalog of teams,
-- journals, POS and companies to choose from; rebuild requested from the panel).

CREATE TABLE IF NOT EXISTS app.budgets (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  kind text NOT NULL CHECK (kind IN ('ventas', 'compras', 'gastos_fijos', 'marketing')),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  unit_name text CHECK (length(unit_name) <= 120),
  brand text CHECK (length(brand) <= 120),
  amount numeric NOT NULL CHECK (amount >= 0),
  created_by uuid REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS budgets_key_idx ON app.budgets(tenant_id, kind, month, coalesce(unit_name, ''), coalesce(brand, ''));

CREATE TABLE IF NOT EXISTS app.marketing_campaigns (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'ejecutada' CHECK (status IN ('planificada', 'ejecutada')),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  brand text CHECK (length(brand) <= 120),
  unit_name text CHECK (length(unit_name) <= 120),
  investment numeric NOT NULL DEFAULT 0 CHECK (investment >= 0),
  created_by uuid REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['app.budgets', 'app.marketing_campaigns'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s TO nova_api USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())', t);
    EXECUTE format('DROP POLICY IF EXISTS worker_all ON %s', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO nova_worker USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO nova_api', t);
    EXECUTE format('GRANT ALL ON %s TO nova_worker', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE app.budgets_id_seq, app.marketing_campaigns_id_seq, app.business_unit_rules_id_seq TO nova_api;

-- What a unit rule can match, with names (refreshed on every load from Odoo).
CREATE TABLE IF NOT EXISTS core.dim_unit_source (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL,
  match_type text NOT NULL CHECK (match_type IN ('company', 'journal', 'pos_config', 'team')),
  match_value text NOT NULL, name text,
  PRIMARY KEY (source_id, match_type, match_value)
);
ALTER TABLE core.dim_unit_source ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON core.dim_unit_source;
CREATE POLICY tenant_isolation ON core.dim_unit_source TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS worker_all ON core.dim_unit_source;
CREATE POLICY worker_all ON core.dim_unit_source TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT ON core.dim_unit_source TO nova_api;
GRANT ALL ON core.dim_unit_source TO nova_worker;

-- Deliveries inherit the business unit of their sale order (team/company rule).
ALTER TABLE core.fact_picking ADD COLUMN IF NOT EXISTS unit_code text;

-- A rule change from the panel asks the worker to recalculate the history of the source.
ALTER TABLE app.connector_sources ADD COLUMN IF NOT EXISTS rebuild_requested_at timestamptz;
ALTER TABLE app.connector_sources ADD COLUMN IF NOT EXISTS rebuilt_at timestamptz;
