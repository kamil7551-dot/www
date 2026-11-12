import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../apps/worker/src/index";
import { browse, browseHref, fold, parseBrowse, type Item } from "../core";
import { countLabel } from "../themes/listing";
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

const item = (n: number, over: Partial<Item> = {}): Item => ({
  id: `i${n}`, kind: "product", name: `Produkt ${n}`, slug: `p${n}`, description: "", price: n * 100, currency: "PLN",
  category_id: null, status: "active", image_key: null, position: n, allergens: "", sold_out_until: null,
  created_at: n, updated_at: n, ...over,
});
const q = (s: string) => parseBrowse(new URLSearchParams(s));

describe("browsing rules", () => {
  it("reads odd query strings without failing", () => {
    expect(q("")).toEqual({ q: "", sort: "polecane", min: null, max: null, page: 1 });
    expect(q("sort=hack&strona=-3&od=abc")).toMatchObject({ sort: "polecane", page: 1, min: null });
    expect(q("od=50&do=10,5&strona=2")).toMatchObject({ min: 1050, max: 5000, page: 2 });
    expect(q(`q=${"x".repeat(500)}`).q).toHaveLength(80);
  });

  it("finds words in any order, without Polish letters and in descriptions", () => {
    const items = [item(1, { name: "Żółta łódka" }), item(2, { name: "Kubek", description: "Pojemność 300 ml, ŻÓŁTY" }), item(3)];
    expect(browse(items, [], q("q=zolt")).items.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(browse(items, [], q("q=lodka zolta")).items.map((i) => i.id)).toEqual(["i1"]);
    expect(fold("ŁÓDŹ")).toBe("lodz");
  });

  it("filters by price, sorts and splits into pages", () => {
    const items = Array.from({ length: 60 }, (_, n) => item(n + 1));
    const r = browse(items, [], q("od=10&do=40&sort=cena-malejaco"));
    expect(r.total).toBe(31);
    expect(r.items[0]!.price).toBe(4000);
    expect(r.priceRange).toEqual({ min: 100, max: 6000 });
    const last = browse(items, [], q("strona=99"));
    expect(last.page).toBe(3);
    expect(last.items).toHaveLength(12);
  });

  it("includes subcategories and keeps the seller's order", () => {
    const cats = [
      { id: "a", parent_id: null, name: "A", slug: "a", position: 1 },
      { id: "b", parent_id: "a", name: "B", slug: "b", position: 2 },
      { id: "c", parent_id: null, name: "C", slug: "c", position: 3 },
    ];
    const items = [item(1, { category_id: "c" }), item(2, { category_id: "b" }), item(3, { category_id: "a" })];
    expect(browse(items, cats, q(""), "a").items.map((i) => i.id)).toEqual(["i3", "i2"]);
    expect(browse(items, cats, q("")).items.map((i) => i.id)).toEqual(["i3", "i2", "i1"]);
  });

  it("builds links that keep filters and drop defaults", () => {
    expect(browseHref("/produkty", q("q=kawa&od=10,5&sort=nazwa"), { page: 2 })).toBe("/produkty?q=kawa&od=10%2C50&sort=nazwa&strona=2");
    expect(browseHref("/produkty", q("strona=3"))).toBe("/produkty");
    expect([1, 2, 5, 12, 22, 25, 112].map(countLabel)).toEqual(["1 produkt", "2 produkty", "5 produktów", "12 produktów", "22 produkty", "25 produktów", "112 produktów"]);
  });
});

describe("shop search and category pages", () => {
  it("searches the shop and escapes what the customer typed", async () => {
    const s = await site("szukajka");
    await s.catalog.createItem({ kind: "product", name: "Kawa ziarnista", price: 4500 });
    await s.catalog.createItem({ kind: "product", name: "Herbata", price: 2000 });
    await s.catalog.createItem({ kind: "product", name: "Kawa szkic", price: 1, status: "draft" });
    const home = await get("szukajka", "/");
    expect(home.body).toContain('action="/produkty"');
    const found = await get("szukajka", "/produkty?q=KAWA");
    expect(found.status).toBe(200);
    expect(found.body).toContain("Kawa ziarnista");
    expect(found.body).not.toContain("Herbata");
    expect(found.body).not.toContain("Kawa szkic");
    expect(found.body).toContain('<meta name="robots" content="noindex" />');
    const evil = await get("szukajka", `/produkty?q=${encodeURIComponent('"><script>alert(1)</script>')}`);
    expect(evil.body).not.toContain("<script>alert");
    expect(evil.body).toContain("Nic nie pasuje");
  });

  it("gives each category its own page, linked from the home page and the sitemap", async () => {
    const s = await site("kategorie-sklep");
    const coffee = await s.catalog.createCategory({ name: "Kawa" });
    const beans = await s.catalog.createCategory({ name: "Ziarno", parentId: coffee.id });
    const tea = await s.catalog.createCategory({ name: "Herbata" });
    for (let n = 0; n < 10; n++) await s.catalog.createItem({ kind: "product", name: `Kawa ${n}`, price: 1000 + n, categoryId: beans.id });
    await s.catalog.createItem({ kind: "product", name: "Earl Grey", price: 900, categoryId: tea.id });

    const home = await get("kategorie-sklep", "/");
    expect(home.body).toContain('href="/kategoria/kawa"');
    expect(home.body).toContain("Zobacz wszystkie: 10 produktów");
    const grid = home.body.slice(home.body.indexOf("<main"));
    expect(grid).toContain("Kawa 7");
    expect(grid).not.toContain("Kawa 9"); // only the first 8 on the home page

    const page = await get("kategorie-sklep", "/kategoria/kawa");
    expect(page.status).toBe(200);
    expect(page.body).toContain("Kawa 9");
    expect(page.body).not.toContain("Earl Grey");
    expect(page.body).toContain('href="/kategoria/ziarno"');
    expect(page.body).toContain('<link rel="canonical" href="https://kategorie-sklep.localhost/kategoria/kawa" />');
    expect((await get("kategorie-sklep", "/kategoria/kawa?sort=nazwa")).body).toContain('content="noindex"');
    expect((await get("kategorie-sklep", "/kategoria/nie-ma")).status).toBe(404);

    const sitemap = await get("kategorie-sklep", "/sitemap.xml");
    expect(sitemap.body).toContain("<loc>https://kategorie-sklep.localhost/kategoria/ziarno</loc>");
  });

  it("is only for shops", async () => {
    await site("wizytowka-bez-szukania", "business-card");
    expect((await get("wizytowka-bez-szukania", "/produkty")).status).toBe(404);
    expect((await get("wizytowka-bez-szukania", "/kategoria/x")).status).toBe(404);
  });
});
