import { Hono } from "hono";
import { Media, forTenant, resolveTenant, type Platform, type Tenant } from "../../../core";

type StoreEnv = { Bindings: Env; Variables: { tenant: Tenant } };

export function storefrontApp(platform: Platform) {
  const app = new Hono<StoreEnv>();

  app.use("*", async (c, next) => {
    const tenant = await resolveTenant(c.env.DB, new URL(c.req.url).host, c.env.PLATFORM_DOMAIN);
    if (!tenant) return c.text("Nie znaleziono strony", 404);
    c.set("tenant", tenant);
    await next();
  });

  app.get("/media/*", async (c) => {
    const key = decodeURIComponent(c.req.path.slice("/media/".length));
    const object = await new Media(c.env.MEDIA, c.get("tenant").id).get(key);
    if (!object) return c.notFound();
    const headers = new Headers({ "cache-control": "public, max-age=31536000, immutable", etag: object.httpEtag });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
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
    return c.html(
      theme.home({
        tenant,
        settings,
        items,
        categories,
        slot: (name, data) => site.slot(name, data, { tenant, settings }),
        mediaUrl: (key) => `/media/${encodeURI(key)}`,
      }),
    );
  });

  return app;
}
