import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../apps/worker/src/index";
import { ValidationError, cleanAllergens, endOfDayInPoland, forTenantForTest, isSoldOut, parseAllergens } from "./core-under-test";
import { createTenant } from "./helpers";
import { harness, uniqueEmail } from "./panel-harness";

async function menu(slug: string) {
  const id = await createTenant("qr-menu");
  await env.DB.prepare("UPDATE tenants SET slug = ?2, name = ?3 WHERE id = ?1").bind(id, slug, `Bistro ${slug}`).run();
  return { id, ...forTenantForTest(id) };
}

async function page(slug: string) {
  const app = createApp({ mailer: () => ({ send: async () => {} }) });
  return (await app.fetch(new Request(`https://${slug}.localhost/`), env, createExecutionContext())).text();
}

describe("allergens", () => {
  it("keeps the legal order, drops duplicates and refuses unknown ids", () => {
    expect(cleanAllergens(["milk", "gluten", "milk"])).toEqual(["gluten", "milk"]);
    expect(() => cleanAllergens(["<script>"])).toThrow(ValidationError);
    expect(parseAllergens("milk,unknown,gluten")).toEqual(["gluten", "milk"]);
  });

  it("are saved on dishes", async () => {
    const m = await menu("alergeny");
    const dish = await m.catalog.createItem({ kind: "dish", name: "Pierogi", price: 2800, allergens: ["milk", "gluten", "eggs"] });
    expect(dish.allergens).toBe("gluten,eggs,milk");
    expect((await m.catalog.updateItem(dish.id, { allergens: [] }))!.allergens).toBe("");
  });
});

describe("sold out today", () => {
  it("lasts until midnight in Poland, also across daylight saving changes", () => {
    // 2026-11-12 21:30 in Warsaw (UTC+1) -> midnight 2026-11-13 00:00 = 23:00 UTC.
    expect(endOfDayInPoland(Date.UTC(2026, 10, 12, 20, 30) / 1000)).toBe(Date.UTC(2026, 10, 12, 23) / 1000);
    // Summer (UTC+2): 2026-07-01 23:30 local = 21:30 UTC -> 22:00 UTC.
    expect(endOfDayInPoland(Date.UTC(2026, 6, 1, 21, 30) / 1000)).toBe(Date.UTC(2026, 6, 1, 22) / 1000);
    // Just after local midnight belongs to the new day.
    expect(endOfDayInPoland(Date.UTC(2026, 10, 12, 23, 5) / 1000)).toBe(Date.UTC(2026, 10, 13, 23) / 1000);
  });

  it("marks a dish and brings it back by itself the next day", async () => {
    const m = await menu("brak-dzis");
    const dish = await m.catalog.createItem({ kind: "dish", name: "Żurek", price: 1900 });
    const at = Date.UTC(2026, 10, 12, 12) / 1000;
    const out = (await m.catalog.setSoldOut(dish.id, true, at))!;
    expect(isSoldOut(out, at)).toBe(true);
    expect(isSoldOut(out, at + 86400)).toBe(false);
    expect((await m.catalog.setSoldOut(dish.id, false))!.sold_out_until).toBeNull();
  });
});

describe("qr-card theme", () => {
  it("is the default for menus: categories bar, allergen marks with legend, sold-out dishes", async () => {
    const m = await menu("karta");
    const soups = await m.catalog.createCategory({ name: "Zupy", position: 1 });
    const mains = await m.catalog.createCategory({ name: "Dania główne", position: 2 });
    await m.catalog.createItem({ kind: "dish", name: "Rosół", price: 1600, categoryId: soups.id, allergens: ["celery", "gluten"] });
    const schabowy = await m.catalog.createItem({ kind: "dish", name: "Schabowy", price: 3400, categoryId: mains.id });
    await m.catalog.setSoldOut(schabowy.id, true);

    const body = await page("karta");
    expect(body).toContain('href="#zupy"');
    expect(body).toContain('id="dania-glowne"');
    expect(body).toMatch(/Rosół<sup class="al"[^>]*>1,9<\/sup>/);
    expect(body).toContain("1 gluten, 9 seler");
    expect(body).toMatch(/class="out"[\s\S]*Schabowy[\s\S]*Brak dziś/);
    expect(body).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });
});

describe("panel", () => {
  it("toggles sold out from the list and saves allergens", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const path = await h.newSite("Bistro panel", "qr-menu");
    const created = await h.call(`${path}/items`, { form: { name: "Bigos", price: "24", kind: "dish" } });
    const itemPath = created.headers.get("location")!;
    const itemId = itemPath.split("/").pop()!;
    const site = forTenantForTest(path.split("/").pop()!);

    expect(await (await h.call(path)).text()).toContain(`/items/${itemId}/sold-out`);
    await h.call(`${itemPath}/sold-out`, { form: { soldOut: "1" } });
    expect(isSoldOut((await site.catalog.getItem(itemId))!)).toBe(true);
    expect(await (await h.call(path)).text()).toContain("Znów jest");
    await h.call(`${itemPath}/sold-out`, { form: { soldOut: "0" } });
    expect(isSoldOut((await site.catalog.getItem(itemId))!)).toBe(false);

    const form = new FormData();
    for (const [k, v] of Object.entries({ name: "Bigos", price: "24", status: "active", categoryId: "", description: "" })) form.append(k, v);
    form.append("allergensShown", "1");
    form.append("allergens", "mustard");
    form.append("allergens", "celery");
    expect((await h.call(itemPath, { multipart: form })).status).toBe(303);
    expect((await site.catalog.getItem(itemId))!.allergens).toBe("celery,mustard");
    expect(await (await h.call(itemPath)).text()).toMatch(/value="celery" checked/);
  });

  it("cannot toggle another seller's dish", async () => {
    const owner = harness();
    await owner.login(uniqueEmail());
    const path = await owner.newSite("Cudze bistro", "qr-menu");
    const itemPath = (await owner.call(`${path}/items`, { form: { name: "Kotlet", price: "30", kind: "dish" } })).headers.get("location")!;
    const other = harness();
    await other.login(uniqueEmail());
    expect((await other.call(`${itemPath}/sold-out`, { form: { soldOut: "1" } })).status).toBe(404);
  });
});
