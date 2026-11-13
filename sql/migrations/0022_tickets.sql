-- 0022 · OMEGA helpdesk: tickets per company with SLA by priority, assignee, first response and
-- resolution times, and comments. source/external_id leave room for a central Odoo Helpdesk sync.
CREATE TABLE IF NOT EXISTS app.tickets (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description text CHECK (length(description) <= 8000),
  category text NOT NULL DEFAULT 'general' CHECK (length(category) <= 60),
  customer text CHECK (length(customer) <= 160),
  priority text NOT NULL DEFAULT 'media' CHECK (priority IN ('alta', 'media', 'baja')),
  status text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto', 'en_progreso', 'esperando', 'resuelto', 'cerrado')),
  assignee_id uuid REFERENCES app.users(id),
  created_by uuid REFERENCES app.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  first_response_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'omega' CHECK (length(source) <= 40),
  external_id text CHECK (length(external_id) <= 120)
);
CREATE INDEX IF NOT EXISTS tickets_tenant_status_idx ON app.tickets(tenant_id, status, due_at);
CREATE TABLE IF NOT EXISTS app.ticket_comments (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  ticket_id bigint NOT NULL REFERENCES app.tickets(id) ON DELETE CASCADE,
  author_id uuid REFERENCES app.users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_comments_ticket_idx ON app.ticket_comments(ticket_id, created_at);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['app.tickets', 'app.ticket_comments'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s TO nova_api USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())', t);
    EXECUTE format('DROP POLICY IF EXISTS worker_all ON %s', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO nova_worker USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %s TO nova_api', t);
    EXECUTE format('GRANT ALL ON %s TO nova_worker', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE app.tickets_id_seq, app.ticket_comments_id_seq TO nova_api;
