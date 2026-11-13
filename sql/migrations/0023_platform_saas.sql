-- 0023 · SaaS platform: super admin across companies, plans (modules, skills, Trueken quota),
-- Trueken ledger from real Omega IA tokens, and in-app notifications with per-user preferences.
--
-- Super admin reads/manages every company through a transaction flag (nova.platform = 'on') that
-- the API sets ONLY after checking app.users.platform_admin; policies accept it next to the
-- tenant policy. The flag is transaction-local, like nova.tenant_id.

CREATE OR REPLACE FUNCTION app.is_platform() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('nova.platform', true), '') = 'on' $$;

-- Global settings (Trueken conversion, defaults). Written only by the platform endpoints.
CREATE TABLE IF NOT EXISTS app.platform_settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]{1,60}$'),
  value jsonb NOT NULL,
  updated_by uuid REFERENCES app.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON app.platform_settings TO nova_api;
INSERT INTO app.platform_settings(key, value) VALUES
  ('truekens', '{"multiplier": 1, "unit": "token", "label": "Truekens"}'),
  ('default_plan', '{"trueken_quota": 50000, "modules": null, "skills": []}')
ON CONFLICT (key) DO NOTHING;

-- Plan of each company: enabled modules (null = all), skills, monthly Trueken quota (null = unlimited).
CREATE TABLE IF NOT EXISTS app.tenant_plans (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  plan_name text NOT NULL DEFAULT 'Estándar' CHECK (length(plan_name) <= 60),
  status text NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'suspendida')),
  trueken_quota integer CHECK (trueken_quota IS NULL OR trueken_quota >= 0),
  modules text[],
  skills text[] NOT NULL DEFAULT '{}',
  notes text CHECK (length(notes) <= 1000),
  updated_by uuid REFERENCES app.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.tenant_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_read ON app.tenant_plans;
CREATE POLICY tenant_read ON app.tenant_plans FOR SELECT TO nova_api USING (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS platform_all ON app.tenant_plans;
CREATE POLICY platform_all ON app.tenant_plans TO nova_api USING (app.is_platform()) WITH CHECK (app.is_platform());
DROP POLICY IF EXISTS worker_all ON app.tenant_plans;
CREATE POLICY worker_all ON app.tenant_plans TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.tenant_plans TO nova_api;
GRANT ALL ON app.tenant_plans TO nova_worker;

-- Trueken ledger: every Omega IA answer with its real tokens, the conversion and what it was for.
ALTER TABLE app.ai_usage ADD COLUMN IF NOT EXISTS input_tokens integer;
ALTER TABLE app.ai_usage ADD COLUMN IF NOT EXISTS output_tokens integer;
ALTER TABLE app.ai_usage ADD COLUMN IF NOT EXISTS multiplier numeric;
ALTER TABLE app.ai_usage ADD COLUMN IF NOT EXISTS truekens numeric;
ALTER TABLE app.ai_usage ADD COLUMN IF NOT EXISTS model text CHECK (length(model) <= 80);
ALTER TABLE app.ai_usage ADD COLUMN IF NOT EXISTS question text CHECK (length(question) <= 300);
ALTER TABLE app.ai_usage ADD COLUMN IF NOT EXISTS feature text NOT NULL DEFAULT 'omega' CHECK (length(feature) <= 40);

-- Platform reads across companies (super admin console).
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['app.tenants', 'app.ai_usage', 'app.connector_sources', 'ops.published_versions', 'app.tickets', 'ops.audit_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS platform_read ON %s', t);
    EXECUTE format('CREATE POLICY platform_read ON %s FOR SELECT TO nova_api USING (app.is_platform())', t);
  END LOOP;
END $$;
-- Creating companies and their first administrator from the console.
DROP POLICY IF EXISTS platform_insert ON app.tenants;
CREATE POLICY platform_insert ON app.tenants FOR INSERT TO nova_api WITH CHECK (app.is_platform());
DROP POLICY IF EXISTS platform_update ON app.tenants;
CREATE POLICY platform_update ON app.tenants FOR UPDATE TO nova_api USING (app.is_platform()) WITH CHECK (app.is_platform());
GRANT INSERT, UPDATE ON app.tenants TO nova_api;
GRANT INSERT, UPDATE, DELETE ON app.memberships TO nova_api;
GRANT INSERT ON app.users TO nova_api;

-- In-app notifications: per company, optionally addressed to one user (null = everyone in it).
CREATE TABLE IF NOT EXISTS app.notifications (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES app.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('umbral', 'ticket', 'truekens', 'presupuesto', 'datos', 'decision', 'sistema')),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('critica', 'atencion', 'info')),
  title text NOT NULL CHECK (length(title) <= 200),
  body text CHECK (length(body) <= 1000),
  page_id text CHECK (length(page_id) <= 40),
  dedupe_key text CHECK (length(dedupe_key) <= 160),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON app.notifications(tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_tenant_idx ON app.notifications(tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS app.notification_reads (
  notification_id bigint NOT NULL REFERENCES app.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
CREATE TABLE IF NOT EXISTS app.notification_prefs (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  muted text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['app.notifications', 'app.notification_reads', 'app.notification_prefs'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s TO nova_api USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())', t);
    EXECUTE format('DROP POLICY IF EXISTS worker_all ON %s', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO nova_worker USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO nova_api', t);
    EXECUTE format('GRANT ALL ON %s TO nova_worker', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE app.notifications_id_seq TO nova_api, nova_worker;
