-- Site settings (contact, colours, theme) as validated JSON. See core/settings.ts for the shape.
CREATE TABLE tenant_settings (
  tenant_id   TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  data        TEXT NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
