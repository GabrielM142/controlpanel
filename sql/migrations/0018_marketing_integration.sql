-- 0018 · Marketing app integration: a per-company token lets an external marketing app (Iris or any
-- other) push its campaigns, investment and leads; campaigns are upserted by (source, external_id).

ALTER TABLE app.marketing_campaigns ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'csv' CHECK (length(source) <= 40);
ALTER TABLE app.marketing_campaigns ADD COLUMN IF NOT EXISTS external_id text CHECK (length(external_id) <= 120);
ALTER TABLE app.marketing_campaigns ADD COLUMN IF NOT EXISTS leads integer CHECK (leads >= 0);
ALTER TABLE app.marketing_campaigns ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS marketing_campaigns_ext_idx ON app.marketing_campaigns(tenant_id, source, external_id) WHERE external_id IS NOT NULL;

-- Looked up by hash before the company is known (like sessions): no RLS, only hashes are stored.
CREATE TABLE IF NOT EXISTS app.integration_tokens (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  kind text NOT NULL CHECK (kind IN ('marketing')),
  label text CHECK (length(label) <= 80),
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON app.integration_tokens TO nova_api;
GRANT USAGE ON SEQUENCE app.integration_tokens_id_seq TO nova_api;
GRANT ALL ON app.integration_tokens TO nova_worker;
