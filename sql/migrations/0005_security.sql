-- 0005 · Row level security and least-privilege grants.
-- nova_api: web queries, tenant fixed per transaction with
--   SELECT set_config('nova.tenant_id', $tenant, true)  (transaction-local:
--   never leaks to the next pooled request). It is neither owner nor BYPASSRLS.
-- nova_worker: ingestion across tenants (explicit permissive policy).
-- Requires PostgreSQL >= 15 (security_invoker views).

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('nova.user_id', true), '')::uuid $$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'app.connector_sources', 'app.connector_credentials', 'app.source_companies', 'app.membership_companies',
    'app.business_unit_rules', 'app.factory_requests', 'app.tasks', 'app.notes', 'app.threshold_rules',
    'app.alert_events', 'app.token_ledger',
    'ops.source_commands', 'ops.sync_checkpoints', 'ops.data_quality_results', 'ops.published_versions',
    'ops.audit_log',
    'ingest.runs', 'ingest.parts', 'ingest.receipts', 'staging.records', 'staging.record_changes',
    'core.dim_company', 'core.dim_partner', 'core.dim_product', 'core.dim_user', 'core.fact_sales_line',
    'core.fact_order_line', 'core.fact_receivable_item', 'core.fact_stock_quant', 'core.fact_valuation_layer',
    'mart.sales_day', 'mart.receivable_day', 'mart.inventory_day', 'mart.executive_snapshot'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s TO nova_api USING (tenant_id = app.current_tenant()) '
                   'WITH CHECK (tenant_id = app.current_tenant())', t);
    EXECUTE format('DROP POLICY IF EXISTS worker_all ON %s', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO nova_worker USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Tenants: visible when selected or when the session user is a member (tenant switcher).
ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_visible ON app.tenants;
CREATE POLICY tenant_visible ON app.tenants FOR SELECT TO nova_api
  USING (id = app.current_tenant()
         OR id IN (SELECT m.tenant_id FROM app.memberships m WHERE m.user_id = app.current_user_id()));
DROP POLICY IF EXISTS worker_all ON app.tenants;
CREATE POLICY worker_all ON app.tenants TO nova_worker USING (true) WITH CHECK (true);

ALTER VIEW mart.sales_month SET (security_invoker = true);

GRANT USAGE ON SCHEMA app, core, mart, ops, ingest TO nova_api;
GRANT USAGE ON SCHEMA app, core, mart, ops, ingest, staging TO nova_worker;

-- API -----------------------------------------------------------------------
GRANT SELECT ON app.tenants, app.memberships, app.dataset_registry, app.terms_versions, app.source_companies,
               app.membership_companies TO nova_api;
GRANT SELECT, UPDATE ON app.users TO nova_api;
GRANT SELECT, INSERT, UPDATE ON app.sessions TO nova_api;
GRANT SELECT, INSERT, UPDATE ON app.connector_sources TO nova_api;
GRANT SELECT (source_id, tenant_id), INSERT, UPDATE ON app.connector_credentials TO nova_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.business_unit_rules, app.tasks, app.notes, app.threshold_rules TO nova_api;
GRANT SELECT, INSERT ON app.factory_requests, app.token_ledger, ops.source_commands, ops.audit_log TO nova_api;
GRANT SELECT, UPDATE ON app.alert_events TO nova_api;
GRANT SELECT ON ingest.runs, ops.sync_checkpoints, ops.data_quality_results, ops.published_versions TO nova_api;
GRANT SELECT ON ALL TABLES IN SCHEMA core, mart TO nova_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app, ops TO nova_api;

-- Worker --------------------------------------------------------------------
GRANT ALL ON ALL TABLES IN SCHEMA ingest, staging, core, mart, ops TO nova_worker;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA ingest, staging, core, mart, ops, app TO nova_worker;
GRANT SELECT ON app.tenants, app.memberships, app.dataset_registry, app.business_unit_rules,
               app.threshold_rules, app.connector_credentials TO nova_worker;
GRANT SELECT, UPDATE ON app.connector_sources TO nova_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.source_companies TO nova_worker;
GRANT INSERT, UPDATE, SELECT ON app.alert_events TO nova_worker;
GRANT INSERT, UPDATE, SELECT, DELETE ON app.dataset_registry TO nova_worker;
-- The worker never reads users/sessions/passwords.
REVOKE ALL ON app.users, app.sessions FROM nova_worker;
