import { TtlCache } from "./cache";

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

/**
 * resolveTenant with an in-memory cache, so most page views skip the database lookup.
 * Unknown hosts are remembered briefly too, so floods of random subdomains do not hammer D1.
 * Changes (new domain, renamed slug) show up after at most `ttlMs`.
 */
export function cachedTenantResolver(opts: { ttlMs?: number; missTtlMs?: number; max?: number; clock?: () => number } = {}) {
  const { ttlMs = 60_000, missTtlMs = 10_000, max = 5_000 } = opts;
  const cache = new TtlCache<Tenant | null>(max, opts.clock);
  const resolve = async (db: D1Database, host: string, platformDomain: string): Promise<Tenant | null> => {
    const key = host.toLowerCase();
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const tenant = await resolveTenant(db, host, platformDomain);
    cache.set(key, tenant, tenant ? ttlMs : missTtlMs);
    return tenant;
  };
  return Object.assign(resolve, { cache });
}
