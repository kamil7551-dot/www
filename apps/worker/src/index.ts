import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT count(*) AS tenants FROM tenants").first<{ tenants: number }>();
  return c.json({ ok: true, tenants: row?.tenants ?? 0 });
});

app.get("/", (c) =>
  c.html(
    `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>www</title></head><body><h1>Działa.</h1></body></html>`,
  ),
);

export default app;
