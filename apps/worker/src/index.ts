import { Hono } from "hono";
import { html } from "hono/html";
import { EventBus, Media, ModuleRegistry, forTenant, resolveTenant, type Tenant } from "../../../core";

const platform = { bus: new EventBus(), modules: new ModuleRegistry() };
platform.modules.attach(platform.bus);

type AppEnv = { Bindings: Env; Variables: { tenant: Tenant } };
const app = new Hono<AppEnv>();

app.get("/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT count(*) AS tenants FROM tenants").first<{ tenants: number }>();
  return c.json({ ok: true, tenants: row?.tenants ?? 0 });
});

app.use("*", async (c, next) => {
  const tenant = await resolveTenant(c.env.DB, new URL(c.req.url).host, c.env.PLATFORM_DOMAIN);
  if (!tenant) return c.text("Nie znaleziono strony", 404);
  c.set("tenant", tenant);
  await next();
});

app.get("/media/*", async (c) => {
  const key = c.req.path.slice("/media/".length);
  const object = await new Media(c.env.MEDIA, c.get("tenant").id).get(decodeURIComponent(key));
  if (!object) return c.notFound();
  const headers = new Headers({ "cache-control": "public, max-age=31536000, immutable", etag: object.httpEtag });
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
});

const zl = (grosze: number) => (grosze / 100).toLocaleString("pl-PL", { style: "currency", currency: "PLN" });

app.get("/", async (c) => {
  const tenant = c.get("tenant");
  const { catalog } = forTenant(platform, c.env.DB, tenant.id);
  const items = await catalog.listItems({ status: "active" });
  return c.html(html`<!doctype html>
    <html lang="pl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${tenant.name}</title>
      </head>
      <body>
        <h1>${tenant.name}</h1>
        <ul>
          ${items.map((i) => html`<li>${i.name} <strong>${zl(i.price)}</strong></li>`)}
        </ul>
      </body>
    </html>`);
});

export default app;
