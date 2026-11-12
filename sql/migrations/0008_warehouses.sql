-- 0008 · Warehouses and locations in core, for "Valorización por bodega".
-- Same isolation as every core table: RLS per tenant for nova_api, permissive for nova_worker.
CREATE TABLE IF NOT EXISTS core.dim_warehouse (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, warehouse_id bigint NOT NULL,
  name text, code text, company_id bigint, active boolean,
  PRIMARY KEY (source_id, warehouse_id)
);
CREATE TABLE IF NOT EXISTS core.dim_location (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, location_id bigint NOT NULL,
  name text, complete_name text, usage text, warehouse_id bigint, company_id bigint, active boolean,
  PRIMARY KEY (source_id, location_id)
);
CREATE INDEX IF NOT EXISTS dim_location_wh_idx ON core.dim_location(source_id, warehouse_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['core.dim_warehouse', 'core.dim_location'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s TO nova_api USING (tenant_id = app.current_tenant()) '
                   'WITH CHECK (tenant_id = app.current_tenant())', t);
    EXECUTE format('DROP POLICY IF EXISTS worker_all ON %s', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO nova_worker USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT ON %s TO nova_api', t);
    EXECUTE format('GRANT ALL ON %s TO nova_worker', t);
  END LOOP;
END $$;

-- Existing staged data (sources ingested before this migration).
INSERT INTO core.dim_warehouse(tenant_id, source_id, warehouse_id, name, code, company_id, active)
SELECT tenant_id, source_id, record_id, data->>'name', data->>'code', (data->>'company_id')::bigint,
       coalesce((data->>'active')::boolean, true)
  FROM staging.records WHERE dataset = 'stock_warehouse' AND NOT deleted
ON CONFLICT (source_id, warehouse_id) DO NOTHING;
INSERT INTO core.dim_location(tenant_id, source_id, location_id, name, complete_name, usage, warehouse_id, company_id, active)
SELECT tenant_id, source_id, record_id, data->>'name', data->>'complete_name', data->>'usage',
       (data->>'warehouse_id')::bigint, (data->>'company_id')::bigint, coalesce((data->>'active')::boolean, true)
  FROM staging.records WHERE dataset = 'stock_location' AND NOT deleted
ON CONFLICT (source_id, location_id) DO NOTHING;
