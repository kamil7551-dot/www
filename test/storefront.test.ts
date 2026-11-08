import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { html } from "hono/html";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../apps/worker/src/index";
import { TenantDb, ValidationError, type ModuleDefinition, defineModule, defineTheme, forTenantForTest, testPlatform } from "./core-under-test";
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
    expect(body.indexOf("Naprawy")).toBeLessThan(body.indexOf("Wymiana dysku"));
    expect(body).toContain("Pozostałe");
    expect(body).not.toContain("Szkic");
  });

  it("falls back to a theme that fits the site kind", () => {
    const themes = testPlatform().themes.register(
      defineTheme({ id: "only-shop", name: "S", kinds: ["shop"], home: () => html`` }),
    );
    expect(themes.pick("qr-menu", "only-shop").id).toBe("simple");
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
