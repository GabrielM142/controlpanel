-- 0009 · Omega IA per company + accounting cost of sales.

-- AI provider per tenant (Anthropic or OpenAI), API key encrypted with NOVA_SECRET_KEY.
-- The API decrypts it only to call the provider and never returns it (only "configured").
CREATE TABLE IF NOT EXISTS app.ai_settings (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
  secret_ciphertext text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app.users(id)
);

-- Cost of sales as booked by Odoo when stock leaves to customers (continental, real-time
-- valuation): journal items on the categories' stock output accounts, coming from stock moves.
-- The amount is the cost of that day, not today's average.
CREATE TABLE IF NOT EXISTS core.fact_cost_line (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, line_id bigint NOT NULL,
  company_id bigint NOT NULL, cost_date date NOT NULL, product_id bigint,
  quantity numeric NOT NULL DEFAULT 0, amount numeric NOT NULL,
  PRIMARY KEY (source_id, line_id)
);
CREATE INDEX IF NOT EXISTS fact_cost_line_product_idx ON core.fact_cost_line(source_id, company_id, product_id, cost_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app.ai_settings', 'core.fact_cost_line'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s TO nova_api USING (tenant_id = app.current_tenant()) '
                   'WITH CHECK (tenant_id = app.current_tenant())', t);
    EXECUTE format('DROP POLICY IF EXISTS worker_all ON %s', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO nova_worker USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.ai_settings TO nova_api;
GRANT SELECT ON core.fact_cost_line TO nova_api;
GRANT ALL ON core.fact_cost_line TO nova_worker;
