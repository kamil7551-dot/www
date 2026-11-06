export type SiteKind = "business-card" | "qr-menu" | "shop";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  kind: SiteKind;
}

/** Subdomains the platform keeps for itself. A site can never take these slugs. */
export const RESERVED_SLUGS = new Set(["panel", "www", "api", "admin", "app", "mail", "static", "cdn", "status", "help"]);

const COLUMNS = "t.id, t.slug, t.name, t.kind";

/**
 * Finds the site for a request host: a custom domain first, then `<slug>.<platformDomain>`.
 * Runs before any tenant is known, so it uses raw D1 instead of TenantDb.
 */
export async function resolveTenant(db: D1Database, host: string, platformDomain: string): Promise<Tenant | null> {
  const hostname = host.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
  const custom = await db
    .prepare(`SELECT ${COLUMNS} FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id WHERE d.domain = ?1`)
    .bind(hostname)
    .first<Tenant>();
  if (custom) return custom;

  const suffix = `.${platformDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  if (!slug || slug.includes(".") || RESERVED_SLUGS.has(slug)) return null;
  return db.prepare(`SELECT ${COLUMNS} FROM tenants t WHERE t.slug = ?1`).bind(slug).first<Tenant>();
}
