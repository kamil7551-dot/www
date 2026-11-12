-- Orders placed without an account. Prices are copied into order_items, so later
-- price changes or deleted products never change an order that was already placed.
CREATE TABLE orders (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Shown to people ("Zamówienie nr 12"); counts up separately in every shop.
  number          INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'paid', 'shipped', 'done', 'cancelled')),
  customer_name   TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  delivery        TEXT NOT NULL CHECK (delivery IN ('pickup', 'courier')),
  address         TEXT NOT NULL DEFAULT '',
  payment         TEXT NOT NULL CHECK (payment IN ('transfer', 'on-pickup')),
  note            TEXT NOT NULL DEFAULT '',
  items_total     INTEGER NOT NULL,
  delivery_price  INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'PLN',
  -- SHA-256 of the secret in the customer's order link; the secret itself is never stored.
  access_hash     TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (tenant_id, number)
);
CREATE INDEX orders_tenant_created ON orders (tenant_id, created_at DESC);

CREATE TABLE order_items (
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  price      INTEGER NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, item_id)
);
