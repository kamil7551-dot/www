-- Accounts are global: one person (e-mail) can run several sites.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Who may manage which site.
CREATE TABLE memberships (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  PRIMARY KEY (user_id, tenant_id)
);
CREATE INDEX memberships_tenant ON memberships (tenant_id);

-- One-time login links. Only a SHA-256 hash of the token is stored, never the token itself.
CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX login_tokens_email ON login_tokens (email, created_at);
CREATE INDEX login_tokens_ip ON login_tokens (ip_hash, created_at);

-- Panel sessions. Only a SHA-256 hash of the cookie value is stored.
CREATE TABLE sessions (
  id_hash       TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  user_agent    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions (user_id);
