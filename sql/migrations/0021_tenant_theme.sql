-- 0021 · Company brand (color and logo) shared by every user of the company. Light/dark mode stays personal.
CREATE TABLE IF NOT EXISTS app.tenant_theme (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id),
  brand_color text NOT NULL CHECK (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo text CHECK (logo IS NULL OR (length(logo) <= 280000 AND logo ~ '^data:image/(png|svg\+xml);base64,')),
  updated_by uuid REFERENCES app.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.tenant_theme ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.tenant_theme;
CREATE POLICY tenant_isolation ON app.tenant_theme TO nova_api USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.tenant_theme TO nova_api;
