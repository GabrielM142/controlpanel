-- 0013 · Alert notifications per company (Telegram). Bot token encrypted with NOVA_SECRET_KEY;
-- last_version avoids sending the same close twice.
CREATE TABLE IF NOT EXISTS app.notify_settings (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  telegram_token_ciphertext text,
  telegram_chat_id text CHECK (length(telegram_chat_id) <= 64),
  enabled boolean NOT NULL DEFAULT false,
  last_version integer,
  last_sent_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app.users(id)
);
ALTER TABLE app.notify_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.notify_settings;
CREATE POLICY tenant_isolation ON app.notify_settings TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS worker_all ON app.notify_settings;
CREATE POLICY worker_all ON app.notify_settings TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON app.notify_settings TO nova_api;
GRANT ALL ON app.notify_settings TO nova_worker;
GRANT SELECT ON app.threshold_rules TO nova_worker;
GRANT SELECT, INSERT, UPDATE ON app.alert_events TO nova_worker;
GRANT SELECT ON ops.published_versions, app.tenants TO nova_worker;
