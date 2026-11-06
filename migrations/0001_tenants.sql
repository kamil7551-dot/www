-- Tenants: one row per site (business card, QR menu or shop).
-- Every table holding customer data references tenants.id via tenant_id.
CREATE TABLE tenants (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('business-card', 'qr-menu', 'shop')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
