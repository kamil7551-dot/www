-- Catalog shared by every site kind: shop products, services and QR menu dishes.
CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, slug)
);
CREATE INDEX categories_tenant_parent ON categories (tenant_id, parent_id, position);

CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('product', 'service', 'dish')),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  -- Money is stored in the smallest unit (grosze for PLN) to avoid float errors.
  price        INTEGER NOT NULL CHECK (price >= 0),
  currency     TEXT NOT NULL DEFAULT 'PLN',
  category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'draft')),
  image_key    TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX items_tenant_category ON items (tenant_id, category_id, status, position);

-- Which modules each site has turned on, and their settings (JSON).
CREATE TABLE tenant_modules (
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_id  TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  settings   TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, module_id)
);
