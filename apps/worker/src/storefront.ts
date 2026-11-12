import { Hono } from "hono";
import {
  Media,
  cachedTenantResolver,
  forTenant,
  robotsTxt,
  seoHead,
  sitemapXml,
  type Mailer,
  type Platform,
  type Tenant,
} from "../../../core";

type StoreEnv = { Bindings: Env; Variables: { tenant: Tenant } };

export function storefrontApp(platform: Platform, mailer: (env: Env) => Mailer) {
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

  app.post("/contact", async (c) => {
    const origin = new URL(c.req.url).origin;
    // Same rule as the panel: a form posted from another site is refused.
    if (c.req.header("origin") !== origin) return c.text("Niedozwolone żądanie", 403);
    const form = await c.req.parseBody();
    const field = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
    const tenant = c.get("tenant");
    const site = forTenant(platform, c.env.DB, tenant.id);
    const result = await site.inbox.submit(
      { name: field("name"), email: field("email"), phone: field("phone"), message: field("message"), trap: field("website") },
      c.req.header("cf-connecting-ip") ?? "unknown",
    );
    // Bots that filled the trap field see the same "sent" page as people.
    if (!result.ok && result.reason !== "spam") return c.redirect("/?contact=error#kontakt", 303);
    if (result.ok) {
      const { email } = await site.settings.get();
      if (email) {
        const m = result.message;
        const send = mailer(c.env)
          .send({
            to: email,
            replyTo: m.email,
            subject: `Nowa wiadomość ze strony ${tenant.name}`,
            text: `${m.name} <${m.email}>${m.phone ? `, tel. ${m.phone}` : ""} napisał(a):\n\n${m.message}\n\nWiadomość jest też w panelu, w zakładce Wiadomości.`,
          })
          .catch((err: unknown) => console.error("contact mail failed", err));
        c.executionCtx.waitUntil(send);
      }
    }
    return c.redirect("/?sent=1#kontakt", 303);
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
        flash: c.req.query("sent") ? "sent" : c.req.query("contact") === "error" ? "contact-error" : undefined,
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
