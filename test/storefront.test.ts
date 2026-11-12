import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { html } from "hono/html";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../apps/worker/src/index";
import { Media, TenantDb, ValidationError, type ModuleDefinition, defineModule, defineTheme, forTenantForTest, testPlatform } from "./core-under-test";
import { pngBytes } from "./fixtures";
import { createTenant } from "./helpers";

async function site(slug: string, kind: "shop" | "qr-menu" | "business-card" = "shop") {
  const id = await createTenant(kind);
  await env.DB.prepare("UPDATE tenants SET slug = ?2, name = ?3 WHERE id = ?1").bind(id, slug, `Firma ${slug}`).run();
  return { id, ...forTenantForTest(id) };
}

const noMail = { send: async () => {} };

async function render(slug: string, modules: ModuleDefinition[] = []) {
  const app = createApp({ mailer: () => noMail, modules });
  const res = await app.fetch(new Request(`https://${slug}.localhost/`), env, createExecutionContext());
  return { status: res.status, body: await res.text() };
}

describe("site settings", () => {
  it("starts with defaults and saves cleaned values", async () => {
    const s = await site("ustawienia");
    expect((await s.settings.get()).accent).toBe("#2f6fed");
    const saved = await s.settings.update({ email: "  Biuro@Firma.PL ", accent: "#AA0000", tagline: "Naprawy laptopów" });
    expect(saved).toMatchObject({ email: "biuro@firma.pl", accent: "#aa0000", tagline: "Naprawy laptopów" });
    expect(await s.settings.get()).toEqual(saved);
  });

  it("rejects values that could break or inject into a page", async () => {
    const s = await site("zle-ustawienia");
    await expect(s.settings.update({ accent: "red;}</style><script>" })).rejects.toThrow(ValidationError);
    await expect(s.settings.update({ email: "nie-mail" })).rejects.toThrow(ValidationError);
    await expect(s.settings.update({ theme: "../../x" })).rejects.toThrow(ValidationError);
    await expect(s.settings.update({ unknown: "x" } as never)).rejects.toThrow(/Unknown setting/);
  });

  it("ignores broken stored values instead of showing them", async () => {
    const s = await site("zepsute");
    await new TenantDb(env.DB, s.id).run(
      `INSERT INTO tenant_settings (tenant_id, data) VALUES (?1, ?2)`,
      JSON.stringify({ accent: "javascript:alert(1)", tagline: "OK" }),
    );
    expect(await s.settings.get()).toMatchObject({ accent: "#2f6fed", tagline: "OK" });
  });
});

describe("storefront theme", () => {
  it("shows settings, groups items by category and hides inactive ones", async () => {
    const s = await site("serwis");
    await s.settings.update({ tagline: "Serwis <b>komputerów</b>", phone: "+48 600 100 200", accent: "#123456" });
    const cat = await s.catalog.createCategory({ name: "Naprawy" });
    await s.catalog.createItem({ kind: "service", name: "Wymiana dysku", price: 15000, categoryId: cat.id });
    await s.catalog.createItem({ kind: "product", name: "Pendrive", price: 3900 });
    await s.catalog.createItem({ kind: "product", name: "Szkic", price: 1, status: "draft" });

    const { status, body } = await render("serwis");
    expect(status).toBe(200);
    expect(body).toContain("--accent:#123456");
    expect(body).toContain("Serwis &lt;b&gt;komputerów&lt;/b&gt;");
    expect(body).toContain('href="tel:+48600100200"');
    const main = body.slice(body.indexOf("<main>"));
    expect(main.indexOf("Naprawy")).toBeLessThan(main.indexOf("Wymiana dysku"));
    expect(body).toContain("Pozostałe");
    expect(body).not.toContain("Szkic");
  });

  it("falls back to a theme that fits the site kind", () => {
    const themes = testPlatform().themes.register(
      defineTheme({ id: "only-shop", name: "S", kinds: ["shop"], home: () => html`` }),
    );
    expect(themes.pick("qr-menu", "only-shop").id).toBe("qr-card");
    expect(themes.pick("qr-menu", "simple").id).toBe("simple");
    expect(themes.pick("shop", "only-shop").id).toBe("only-shop");
    expect(themes.pick("shop", "missing").id).toBe("simple");
    expect(() => defineTheme({ id: "X!", name: "x", kinds: ["shop"], home: () => html`` })).toThrow();
  });
});

describe("module slots", () => {
  const badge = defineModule({
    id: "test-badge",
    name: "Badge",
    version: "1",
    slots: {
      "item.after": ({ item }) => html`<span class="badge">nowość: ${item.name}</span>`,
      footer: () => "<script>alert(1)</script>",
    },
  });
  const broken = defineModule({
    id: "test-broken",
    name: "Broken",
    version: "1",
    slots: { "home.top": () => { throw new Error("boom"); } },
  });

  it("renders only enabled modules, escapes plain strings and survives a broken module", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const on = await site("z-modulem");
    await on.catalog.createItem({ kind: "product", name: "Myszka", price: 100 });
    const platform = { ...testPlatform() };
    platform.modules.register(badge, broken);
    await platform.modules.enable(new TenantDb(env.DB, on.id), "test-badge");
    await platform.modules.enable(new TenantDb(env.DB, on.id), "test-broken");
    const off = await site("bez-modulu");
    await off.catalog.createItem({ kind: "product", name: "Myszka", price: 100 });

    const withModule = await render("z-modulem", [badge, broken]);
    expect(withModule.status).toBe(200);
    expect(withModule.body).toContain('<span class="badge">nowość: Myszka</span>');
    expect(withModule.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(withModule.body).not.toContain("<script>");

    const without = await render("bez-modulu", [badge, broken]);
    expect(without.body).not.toContain("badge");
  });
});

describe("image variants", () => {
  it("serves a smaller WebP copy, caches it in R2 and removes it with the original", async () => {
    const s = await site("miniatury");
    const media = new Media(env.MEDIA, s.id, env.IMAGES);
    const key = await media.putImage(pngBytes().buffer as ArrayBuffer, "image/png");
    await s.catalog.createItem({ kind: "product", name: "Kubek", price: 1000, imageKey: key });

    const page = await render("miniatury");
    expect(page.body).toContain(`/media/${key}?w=640`);
    expect(page.body).toContain("320w");

    const app = createApp({ mailer: () => noMail });
    const res = await app.fetch(new Request(`https://miniatury.localhost/media/${key}?w=500`), env, createExecutionContext());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const info = await env.IMAGES.info(res.body!);
    expect("width" in info && info.width).toBe(640);
    expect(await env.MEDIA.head(`${key}.w640.webp`)).not.toBeNull();

    await media.delete(key);
    expect(await env.MEDIA.head(key)).toBeNull();
    expect(await env.MEDIA.head(`${key}.w640.webp`)).toBeNull();
  });

  it("never resizes another site's file or a resized copy", async () => {
    const a = await site("a-foto");
    const key = await new Media(env.MEDIA, a.id, env.IMAGES).putImage(pngBytes().buffer as ArrayBuffer, "image/png");
    const other = new Media(env.MEDIA, (await site("b-foto")).id, env.IMAGES);
    expect(await other.variant(key, 320)).toBeNull();
    expect(await new Media(env.MEDIA, a.id, env.IMAGES).variant(`${key}.w320.webp`, 320)).toBeNull();
  });
});

describe("performance budget (AGENTS.md)", () => {
  it("keeps the default home page script-free and well under 100 KB", async () => {
    const s = await site("budzet");
    for (let i = 0; i < 50; i++) await s.catalog.createItem({ kind: "product", name: `Produkt ${i}`, price: 1000 + i });
    const { body } = await render("budzet");
    expect(body).not.toMatch(/<script(?![^>]*application\/ld\+json)/i);
    const gzipped = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    expect(gzipped.byteLength).toBeLessThan(100 * 1024);
  });
});

describe("SEO", () => {
  it("adds title, description, canonical and safe schema.org data", async () => {
    const s = await site("seo-firma", "business-card");
    await s.settings.update({ tagline: "Naprawy </script><script>alert(1)</script>", phone: "+48 600 100 200" });
    await s.catalog.createItem({ kind: "service", name: "Diagnoza", price: 7990 });
    const { body } = await render("seo-firma");
    expect(body).toContain('<link rel="canonical" href="https://seo-firma.localhost/"');
    expect(body).toContain('"@type":"LocalBusiness"');
    expect(body).toContain('"telephone":"+48 600 100 200"');
    expect(body).toContain('"price":"79.90"');
    const ld = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
    expect(ld).not.toContain("<");
    expect(JSON.parse(ld).description).toContain("</script>");
    expect(body.match(/<script/g)).toHaveLength(1);
  });

  it("serves robots.txt and a sitemap for every site", async () => {
    await site("mapa");
    const app = createApp({ mailer: () => noMail });
    const get = (p: string) => app.fetch(new Request(`https://mapa.localhost${p}`), env, createExecutionContext());
    expect(await (await get("/robots.txt")).text()).toContain("Sitemap: https://mapa.localhost/sitemap.xml");
    const sitemap = await get("/sitemap.xml");
    expect(sitemap.headers.get("content-type")).toContain("application/xml");
    expect(await sitemap.text()).toContain("<loc>https://mapa.localhost/</loc>");
  });
});
