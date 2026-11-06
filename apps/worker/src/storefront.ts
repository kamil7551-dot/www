import { Hono } from "hono";
import { html } from "hono/html";
import { Media, forTenant, resolveTenant, type Platform, type Tenant } from "../../../core";
import { page, zl } from "./layout";

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
    const items = await forTenant(platform, c.env.DB, tenant.id).catalog.listItems({ status: "active" });
    return c.html(
      page(
        tenant.name,
        html`<h1>${tenant.name}</h1>
          <ul>
            ${items.map((i) => html`<li>${i.name} <strong>${zl(i.price)}</strong></li>`)}
          </ul>`,
      ),
    );
  });

  return app;
}
