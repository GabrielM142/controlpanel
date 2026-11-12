-- 0004 · Product data per tenant/user: Factory requests (with versioned terms
-- and idempotency), tasks, notes, threshold rules, alert events, token ledger.
-- Legacy public.trueque_requests rows are copied (not moved) into a legacy
-- tenant only when rows exist; jobs/snapshots stay untouched (read-only legacy).

CREATE TABLE IF NOT EXISTS app.terms_versions (
  version text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.factory_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  user_id uuid REFERENCES app.users(id),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_name text NOT NULL,
  client_email text,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  title text NOT NULL,
  process text NOT NULL,
  actors text NOT NULL,
  data_sources text NOT NULL,
  integrations text NOT NULL,
  outputs text NOT NULL,
  priority text NOT NULL DEFAULT 'media' CHECK (priority IN ('baja', 'media', 'alta', 'urgente')),
  budget text,
  timeline text,
  market_item text,
  conversation jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'analyzing', 'quoted', 'approved', 'in_progress', 'delivered', 'archived')),
  terms_version text REFERENCES app.terms_versions(version),
  terms_sha256 text,
  terms_accepted_at timestamptz,
  legacy_id uuid UNIQUE,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS factory_requests_tenant_idx ON app.factory_requests(tenant_id, created_at DESC);

DO $$
DECLARE legacy uuid;
BEGIN
  IF to_regclass('public.trueque_requests') IS NOT NULL AND EXISTS (SELECT 1 FROM public.trueque_requests) THEN
    INSERT INTO app.tenants(slug, name, mode) VALUES ('legacy-juj', 'Legado JUJ (migrado)', 'live')
      ON CONFLICT (slug) DO NOTHING;
    SELECT id INTO legacy FROM app.tenants WHERE slug = 'legacy-juj';
    INSERT INTO app.factory_requests(tenant_id, idempotency_key, created_at, client_name, client_email, plan, title,
                                     process, actors, data_sources, integrations, outputs, priority, budget, timeline,
                                     conversation, status, terms_accepted_at, legacy_id)
    SELECT legacy, 'legacy:' || t.id, t.created_at, t.client_name, t.client_email, t.plan, t.title, t.process,
           t.actors, t.data_sources, t.integrations, t.outputs, t.priority, t.budget, t.timeline, t.conversation,
           t.status, t.terms_accepted_at, t.id
      FROM public.trueque_requests t
    ON CONFLICT (legacy_id) DO NOTHING;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  owner_id uuid NOT NULL REFERENCES app.users(id),
  assignee_id uuid REFERENCES app.users(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text CHECK (length(description) <= 4000),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'cancelled')),
  priority text NOT NULL DEFAULT 'media' CHECK (priority IN ('baja', 'media', 'alta', 'urgente')),
  due_date date,
  view_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_tenant_idx ON app.tasks(tenant_id, owner_id);

CREATE TABLE IF NOT EXISTS app.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  owner_id uuid NOT NULL REFERENCES app.users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  color text NOT NULL DEFAULT 'amber',
  view_id text,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_tenant_idx ON app.notes(tenant_id, owner_id);

CREATE TABLE IF NOT EXISTS app.threshold_rules (
  id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  metric text NOT NULL,
  comparator text NOT NULL CHECK (comparator IN ('lt', 'gt')),
  warn_value numeric NOT NULL,
  crit_value numeric NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  owner_id uuid REFERENCES app.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.alert_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  rule_id text NOT NULL,
  version integer NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warn', 'crit')),
  value numeric,
  dedupe_key text NOT NULL,
  acknowledged_by uuid REFERENCES app.users(id),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);

-- Commercial credits ledger: reserve -> commit | refund, idempotent per key.
CREATE TABLE IF NOT EXISTS app.token_ledger (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  user_id uuid REFERENCES app.users(id),
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  kind text NOT NULL CHECK (kind IN ('grant', 'reserve', 'commit', 'refund')),
  amount integer NOT NULL CHECK (amount >= 0),
  idempotency_key text NOT NULL,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key, kind)
);
CREATE INDEX IF NOT EXISTS token_ledger_period_idx ON app.token_ledger(tenant_id, period);
