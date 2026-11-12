-- 0001 · Schemas, roles, tenancy, authentication, sources and registry.
-- Tenant identity always comes from the server session/membership; never from
-- a client-supplied name. res.company ids live in source_companies, separate
-- from the tenant id.

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS ingest;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS mart;
CREATE SCHEMA IF NOT EXISTS ops;

-- Group roles (NOLOGIN). Production login roles are created by operations:
--   CREATE ROLE nova_api_login LOGIN PASSWORD '...' IN ROLE nova_api;
--   CREATE ROLE nova_worker_login LOGIN PASSWORD '...' IN ROLE nova_worker;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nova_api') THEN CREATE ROLE nova_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nova_worker') THEN CREATE ROLE nova_worker NOLOGIN; END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Sin privilegio para crear roles nova_api/nova_worker: créelos antes de continuar';
END $$;

CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('nova.tenant_id', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS app.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL,
  mode text NOT NULL DEFAULT 'live' CHECK (mode IN ('demo', 'live')),
  timezone text NOT NULL DEFAULT 'America/Guayaquil',
  currency text NOT NULL DEFAULT 'USD',
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' in email) > 1),
  name text NOT NULL,
  password_hash text NOT NULL,
  platform_admin boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.memberships (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON app.sessions(user_id);

CREATE TABLE IF NOT EXISTS app.connector_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'odoo16_batch' CHECK (kind IN ('odoo16_batch', 'pg_replica_future')),
  base_url text NOT NULL CHECK (base_url ~ '^https?://'),
  db_name text NOT NULL,
  login text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Guayaquil',
  collect_after time NOT NULL DEFAULT '03:00',
  collect_tz text NOT NULL DEFAULT 'America/Guayaquil',
  status text NOT NULL DEFAULT 'pending_link'
    CHECK (status IN ('pending_link', 'active', 'paused', 'relink_required', 'error')),
  installation_uuid uuid,
  source_generation integer,
  link_confirmed_at timestamptz,
  capabilities jsonb,
  attribute_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_seen_at timestamptz,
  last_collect_at timestamptz,
  next_collect_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_uuid, source_generation)
);
CREATE INDEX IF NOT EXISTS connector_sources_tenant_idx ON app.connector_sources(tenant_id);

-- Secret ciphertext (AES-256-GCM with NOVA_SECRET_KEY) or a reference to a secret manager.
-- The API role may write it but never read it: only the worker decrypts.
CREATE TABLE IF NOT EXISTS app.connector_credentials (
  source_id uuid PRIMARY KEY REFERENCES app.connector_sources(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  secret_ciphertext text,
  secret_ref text,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (secret_ciphertext IS NOT NULL OR secret_ref IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS app.source_companies (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  source_id uuid NOT NULL REFERENCES app.connector_sources(id) ON DELETE CASCADE,
  company_id bigint NOT NULL,
  name text NOT NULL,
  currency text,
  authorized boolean NOT NULL DEFAULT true,
  PRIMARY KEY (source_id, company_id)
);

-- Optional per-member company restriction; no row = every authorized company of the tenant.
CREATE TABLE IF NOT EXISTS app.membership_companies (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES app.connector_sources(id) ON DELETE CASCADE,
  company_id bigint NOT NULL,
  PRIMARY KEY (tenant_id, user_id, source_id, company_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app.memberships(tenant_id, user_id) ON DELETE CASCADE
);

-- Commands the API queues for the worker (which alone holds ERP credentials).
CREATE TABLE IF NOT EXISTS ops.source_commands (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  source_id uuid NOT NULL REFERENCES app.connector_sources(id) ON DELETE CASCADE,
  command text NOT NULL CHECK (command IN ('link', 'test', 'resync', 'collect_now')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  requested_by uuid REFERENCES app.users(id),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS source_commands_queued_idx ON ops.source_commands(created_at) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS app.dataset_registry (
  key text PRIMARY KEY,
  version integer NOT NULL,
  min_version integer NOT NULL,
  addon text NOT NULL,
  model text NOT NULL,
  mode text NOT NULL,
  contract jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Business units: explicit, dated mapping (never inferred from names).
CREATE TABLE IF NOT EXISTS app.business_unit_rules (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  source_id uuid NOT NULL REFERENCES app.connector_sources(id) ON DELETE CASCADE,
  match_type text NOT NULL CHECK (match_type IN ('company', 'journal', 'pos_config', 'team')),
  match_value text NOT NULL,
  unit_code text NOT NULL,
  unit_name text NOT NULL,
  channel text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  valid_from date,
  valid_to date,
  validated_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_unit_rules_source_idx ON app.business_unit_rules(source_id, priority);

CREATE TABLE IF NOT EXISTS ops.audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  user_id uuid,
  action text NOT NULL,
  target text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON ops.audit_log(tenant_id, at DESC);
