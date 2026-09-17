CREATE TABLE IF NOT EXISTS jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text NOT NULL CHECK(status IN ('queued','running','completed','failed')),created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,error text);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs((true)) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS snapshots(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid UNIQUE REFERENCES jobs(id),created_at timestamptz NOT NULL DEFAULT now(),source text NOT NULL,rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'));

CREATE TABLE IF NOT EXISTS trueque_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 client_name text NOT NULL,
 client_email text,
 plan text NOT NULL DEFAULT 'free' CHECK(plan IN ('free','pro','enterprise')),
 title text NOT NULL,
 process text NOT NULL,
 actors text NOT NULL,
 data_sources text NOT NULL,
 integrations text NOT NULL,
 outputs text NOT NULL,
 priority text NOT NULL DEFAULT 'media' CHECK(priority IN ('baja','media','alta','urgente')),
 budget text,
 timeline text,
 conversation jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','analyzing','quoted','approved','in_progress','delivered','archived')),
 tokens_used integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS trueque_requests_created_idx ON trueque_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS trueque_requests_status_idx ON trueque_requests(status);
