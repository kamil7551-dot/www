-- Messages sent through a site's contact form. The seller reads them in the panel; a copy goes by e-mail.
CREATE TABLE contact_messages (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
);
CREATE INDEX contact_messages_tenant ON contact_messages (tenant_id, created_at);
CREATE INDEX contact_messages_ip ON contact_messages (tenant_id, ip_hash, created_at);
