import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../apps/worker/src/index";
import { forTenantForTest } from "./core-under-test";
import { createTenant } from "./helpers";

async function site(slug: string, kind: "shop" | "business-card" = "shop") {
  const id = await createTenant(kind);
  await env.DB.prepare("UPDATE tenants SET slug = ?2, name = ?3 WHERE id = ?1").bind(id, slug, `Sklep ${slug}`).run();
  return { id, ...forTenantForTest(id) };
}

async function get(slug: string, path: string) {
  const app = createApp({ mailer: () => ({ send: async () => {} }) });
  const res = await app.fetch(new Request(`https://${slug}.localhost${path}`), env, createExecutionContext());
  return { status: res.status, body: await res.text() };
}

describe("item pages", () => {
  it("gives every item its own address, also when names repeat", async () => {
    const s = await site("adresy");
    const a = await s.catalog.createItem({ kind: "product", name: "Kabel USB-C", price: 2900 });
    const b = await s.catalog.createItem({ kind: "product", name: "Kabel USB-C", price: 3900 });
    const c = await s.catalog.createItem({ kind: "product", name: "Kabel USB-C", price: 4900 });
    expect([a.slug, b.slug, c.slug]).toEqual(["kabel-usb-c", "kabel-usb-c-2", "kabel-usb-c-3"]);
  });

  it("shows the product with price, description and Google product data", async () => {
    const s = await site("produkt");
    await s.catalog.createItem({ kind: "product", name: "Zasilacz 65W", price: 12900, description: "Ładuje laptopa i telefon.\n\nGwarancja 2 lata." });
    const { status, body } = await get("produkt", "/p/zasilacz-65w");
    expect(status).toBe(200);
    expect(body).toContain("<title>Zasilacz 65W – Sklep produkt</title>");
    expect(body).toContain('<link rel="canonical" href="https://produkt.localhost/p/zasilacz-65w" />');
    expect(body).toContain('"@type":"Product"');
    expect(body).toContain('"price":"129.00"');
    expect(body).toContain("https://schema.org/InStock");
    expect(body).toContain('<p class="product-desc">Gwarancja 2 lata.</p>');
    expect(body).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });

  it("hides drafts, hidden and unknown items", async () => {
    const s = await site("ukryte");
    await s.catalog.createItem({ kind: "product", name: "Tajne", price: 100, status: "hidden" });
    await s.catalog.createItem({ kind: "product", name: "Szkic", price: 100, status: "draft" });
    for (const p of ["/p/tajne", "/p/szkic", "/p/nie-ma"]) expect((await get("ukryte", p)).status).toBe(404);
  });

  it("uses the plain layout for themes without their own", async () => {
    const s = await site("wizytowka-produkt", "business-card");
    await s.catalog.createItem({ kind: "service", name: "Montaż", price: 10000 });
    const { status, body } = await get("wizytowka-produkt", "/p/montaz");
    expect(status).toBe(200);
    expect(body).toContain('"@type":"Service"');
    expect(body).toContain("<h1>Montaż</h1>");
  });
});

describe("shop theme", () => {
  it("is the default for shops and links products to their pages", async () => {
    const s = await site("siatka");
    const cat = await s.catalog.createCategory({ name: "Kable" });
    await s.catalog.createItem({ kind: "product", name: "Kabel HDMI", price: 3900, categoryId: cat.id });
    const { body } = await get("siatka", "/");
    expect(body).toContain('class="grid"');
    expect(body).toContain('href="/p/kabel-hdmi"');
    expect(body).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });

  it("lists product pages in the sitemap", async () => {
    const s = await site("mapa-sklepu");
    await s.catalog.createItem({ kind: "product", name: "Mysz", price: 5000 });
    expect((await get("mapa-sklepu", "/sitemap.xml")).body).toContain("<loc>https://mapa-sklepu.localhost/p/mysz</loc>");
  });
});
