-- 0012 · Outgoing deliveries (stock pickings) in core for the Logística report.
-- order_date comes from the sale order named in the picking origin (dispatch time = order -> done);
-- in_full = no backorder was split from it (everything ordered left in that delivery).
CREATE TABLE IF NOT EXISTS core.fact_picking (
  tenant_id uuid NOT NULL, source_id uuid NOT NULL, picking_id bigint NOT NULL,
  company_id bigint NOT NULL, partner_id bigint, type_code text, state text,
  order_date date, scheduled_date date, deadline_date date, done_date date,
  is_backorder boolean NOT NULL DEFAULT false, in_full boolean NOT NULL DEFAULT true,
  PRIMARY KEY (source_id, picking_id)
);
CREATE INDEX IF NOT EXISTS fact_picking_done_idx ON core.fact_picking(source_id, type_code, done_date);

ALTER TABLE core.fact_picking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON core.fact_picking;
CREATE POLICY tenant_isolation ON core.fact_picking TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY IF EXISTS worker_all ON core.fact_picking;
CREATE POLICY worker_all ON core.fact_picking TO nova_worker USING (true) WITH CHECK (true);
GRANT SELECT ON core.fact_picking TO nova_api;
GRANT ALL ON core.fact_picking TO nova_worker;
