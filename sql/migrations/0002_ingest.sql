-- 0002 · Ingestion: runs, immutable parts, receipts, canonical staging state,
-- checkpoints, data quality and published versions.

CREATE TABLE IF NOT EXISTS ingest.runs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  source_id uuid NOT NULL REFERENCES app.connector_sources(id),
  run_uuid uuid NOT NULL,
  run_seq bigint NOT NULL,
  generation integer NOT NULL,
  state text NOT NULL DEFAULT 'discovered'
    CHECK (state IN ('discovered', 'downloading', 'received', 'validated', 'applied', 'published', 'failed', 'rejected')),
  manifest jsonb,
  business_date date,
  requested_cutoff_at timestamptz,
  observed_from timestamptz,
  observed_to timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  validated_at timestamptz,
  acked_at timestamptz,
  applied_at timestamptz,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  error text,
  UNIQUE (source_id, run_uuid),
  UNIQUE (source_id, generation, run_seq)
);
CREATE INDEX IF NOT EXISTS runs_source_state_idx ON ingest.runs(source_id, state, run_seq);

-- Payload kept compressed for retries/re-apply without downloading again.
CREATE TABLE IF NOT EXISTS ingest.parts (
  run_id bigint NOT NULL REFERENCES ingest.runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  part_no integer NOT NULL,
  dataset text NOT NULL,
  records integer NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  payload bytea NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, part_no)
);

CREATE TABLE IF NOT EXISTS ingest.receipts (
  run_id bigint PRIMARY KEY REFERENCES ingest.runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  receipt_uuid uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  acked_at timestamptz,
  response jsonb
);

-- Canonical latest state per source record. Ordering = (run_seq, seq): a
-- later observation always wins, a replayed/older one never overwrites.
CREATE TABLE IF NOT EXISTS staging.records (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  source_id uuid NOT NULL REFERENCES app.connector_sources(id),
  dataset text NOT NULL,
  record_id bigint NOT NULL,
  company_id bigint,
  data jsonb,
  obs_run_seq bigint NOT NULL,
  obs_seq bigint NOT NULL,
  generation integer NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  deleted_reason text,
  deleted_at timestamptz,
  seen_epoch integer NOT NULL DEFAULT 1,
  first_run_id bigint NOT NULL,
  last_run_id bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, dataset, record_id)
);
CREATE INDEX IF NOT EXISTS staging_records_parent_move_idx
  ON staging.records(source_id, ((data->>'move_id')::bigint)) WHERE dataset = 'account_move_line';
CREATE INDEX IF NOT EXISTS staging_records_parent_order_idx
  ON staging.records(source_id, dataset, ((data->>'order_id')::bigint)) WHERE dataset IN ('sale_order_line', 'pos_order_line', 'purchase_order_line');

-- Before/after audit of every applied change (bounded retention by ops policy).
CREATE TABLE IF NOT EXISTS staging.record_changes (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  source_id uuid NOT NULL,
  run_id bigint NOT NULL REFERENCES ingest.runs(id) ON DELETE CASCADE,
  dataset text NOT NULL,
  record_id bigint NOT NULL,
  op text NOT NULL,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS record_changes_run_idx ON staging.record_changes(run_id);

CREATE TABLE IF NOT EXISTS ops.sync_checkpoints (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  source_id uuid NOT NULL REFERENCES app.connector_sources(id),
  dataset text NOT NULL,
  last_applied_run_seq bigint NOT NULL DEFAULT 0,
  backfill_complete boolean NOT NULL DEFAULT false,
  resync_epoch integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, dataset)
);

CREATE TABLE IF NOT EXISTS ops.data_quality_results (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  source_id uuid,
  run_id bigint REFERENCES ingest.runs(id) ON DELETE CASCADE,
  check_name text NOT NULL,
  dataset text,
  company_id bigint,
  status text NOT NULL CHECK (status IN ('ok', 'warn', 'fail')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dq_tenant_idx ON ops.data_quality_results(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ops.published_versions (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  version integer NOT NULL,
  business_date date,
  published_at timestamptz NOT NULL DEFAULT now(),
  sources jsonb NOT NULL,
  consistency text NOT NULL DEFAULT 'captured_interval',
  UNIQUE (tenant_id, version)
);
