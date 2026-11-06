-- Custom domains pointing at a tenant (e.g. sklep-kamila.pl). Subdomains of the platform domain need no row here.
CREATE TABLE tenant_domains (
  domain     TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX tenant_domains_tenant ON tenant_domains (tenant_id);
