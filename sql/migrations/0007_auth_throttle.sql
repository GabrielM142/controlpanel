-- Login brute-force protection: failed attempts per key ('email:<addr>' and
-- 'ip:<addr>'), with an exponential lock. Not tenant data (no RLS); only the
-- API role touches it. Rows are small and purged by the API itself.
CREATE TABLE IF NOT EXISTS app.auth_throttle (
  key text PRIMARY KEY CHECK (length(key) <= 300),
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_throttle_updated_idx ON app.auth_throttle(updated_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.auth_throttle TO nova_api;
