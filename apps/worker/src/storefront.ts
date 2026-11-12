import { Hono } from "hono";
import { Media, cachedTenantResolver, forTenant, robotsTxt, seoHead, sitemapXml, type Platform, type Tenant } from "../../../core";

type StoreEnv = { Bindings: Env; Variables: { tenant: Tenant } };

export function storefrontApp(platform: Platform) {
  const app = new Hono<StoreEnv>();
  const resolveTenant = cachedTenantResolver();

  app.use("*", async (c, next) => {
    const tenant = await resolveTenant(c.env.DB, new URL(c.req.url).host, c.env.PLATFORM_DOMAIN);
    if (!tenant) return c.text("Nie znaleziono strony", 404);
    c.set("tenant", tenant);
    await next();
  });

  app.get("/media/*", async (c) => {
    const key = decodeURIComponent(c.req.path.slice("/media/".length));
    const media = new Media(c.env.MEDIA, c.get("tenant").id, c.env.IMAGES);
    const width = Number(c.req.query("w"));
    const object = width > 0 ? await media.variant(key, width) : await media.get(key);
    if (!object) return c.notFound();
    const headers = new Headers({ "cache-control": "public, max-age=31536000, immutable", etag: object.httpEtag });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  });

  app.get("/robots.txt", (c) => c.text(robotsTxt(new URL(c.req.url).origin)));

  app.get("/sitemap.xml", async (c) => {
    const tenant = c.get("tenant");
    const items = await forTenant(platform, c.env.DB, tenant.id).catalog.listItems({ status: "active" });
    const lastModified = items.reduce((max, i) => Math.max(max, i.updated_at), 0) || undefined;
    return c.body(sitemapXml([{ url: `${new URL(c.req.url).origin}/`, lastModified }]), 200, {
      "content-type": "application/xml; charset=utf-8",
    });
  });

  app.get("/", async (c) => {
    const tenant = c.get("tenant");
    const site = forTenant(platform, c.env.DB, tenant.id);
    const [settings, items, categories] = await Promise.all([
      site.settings.get(),
      site.catalog.listItems({ status: "active" }),
      site.catalog.listCategories(),
    ]);
    const theme = platform.themes.pick(tenant.kind, settings.theme);
    const origin = new URL(c.req.url).origin;
    const mediaUrl = (key: string, width?: number) => `/media/${encodeURI(key)}${width ? `?w=${width}` : ""}`;
    return c.html(
      theme.home({
        tenant,
        settings,
        items,
        categories,
        slot: (name, data) => site.slot(name, data, { tenant, settings }),
        mediaUrl,
        seo: seoHead({
          tenant,
          settings,
          url: `${origin}/`,
          logoUrl: settings.logoKey ? origin + mediaUrl(settings.logoKey, 640) : undefined,
          items,
        }),
      }),
    );
  });

  return app;
}
