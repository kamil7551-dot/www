import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Item } from "./catalog";
import type { SiteSettings } from "./settings";
import type { Tenant } from "./tenants";

const SCHEMA_TYPE: Record<Tenant["kind"], string> = {
  "business-card": "LocalBusiness",
  "qr-menu": "Restaurant",
  shop: "Store",
};

/** JSON safe to embed inside <script>: "<" can never close the tag. */
export const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, " ");

export interface SeoInput {
  tenant: Tenant;
  settings: SiteSettings;
  /** Absolute canonical URL of the page. */
  url: string;
  /** Absolute URL of the logo, if any. */
  logoUrl?: string;
  items?: Item[];
}

/**
 * Everything search engines and link previews need, built in one place so every theme gets it right:
 * title, description, canonical, Open Graph and schema.org data (business with contact, hours and offers).
 */
export function seoHead({ tenant, settings, url, logoUrl, items = [] }: SeoInput): Promise<HtmlEscapedString> | HtmlEscapedString {
  const description = settings.tagline || `${tenant.name}: oferta, ceny i kontakt.`;
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPE[tenant.kind],
    name: tenant.name,
    description,
    url,
  };
  if (logoUrl) data.logo = data.image = logoUrl;
  if (settings.phone) data.telephone = settings.phone;
  if (settings.email) data.email = settings.email;
  if (settings.address) data.address = settings.address;
  if (settings.hours) data.openingHours = settings.hours;
  if (items.length) {
    data.makesOffer = items.slice(0, 50).map((i) => ({
      "@type": "Offer",
      name: i.name,
      price: (i.price / 100).toFixed(2),
      priceCurrency: i.currency,
    }));
  }
  return html`<title>${tenant.name}${settings.tagline ? ` – ${settings.tagline}` : ""}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${tenant.name}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${url}" />
    ${logoUrl ? html`<meta property="og:image" content="${logoUrl}" />` : ""}
    <script type="application/ld+json">${raw(safeJson(data))}</script>`;
}

export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /media/\nSitemap: ${origin}/sitemap.xml\n`;
}

const xmlEscape = (s: string) =>
  s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);

export function sitemapXml(pages: { url: string; lastModified?: number }[]): string {
  const urls = pages
    .map(
      (p) =>
        `<url><loc>${xmlEscape(p.url)}</loc>${p.lastModified ? `<lastmod>${new Date(p.lastModified * 1000).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
