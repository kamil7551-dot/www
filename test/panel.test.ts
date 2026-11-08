import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ValidationError, forTenantForTest } from "./core-under-test";
import { createTenant } from "./helpers";
import { pngBytes } from "./fixtures";
import { harness, uniqueEmail } from "./panel-harness";

const png = () => new File([pngBytes()], "a.png", { type: "image/png" });
const siteId = (url: string) => url.split("/").at(-1)!;

async function seller() {
  const h = harness();
  await h.login(uniqueEmail());
  return h;
}

describe("panel: items and categories", () => {
  it("edits an item with description, category, status and image", async () => {
    const h = await seller();
    const site = await h.newSite("Serwis IT");
    await h.call(`${site}/categories`, { form: { name: "Naprawy" } });
    const created = await h.call(`${site}/items`, { form: { name: "Diagnoza", price: "50", kind: "service" } });
    const itemUrl = created.headers.get("location")!;
    const { catalog } = forTenantForTest(siteId(site));
    const [category] = await catalog.listCategories();

    const form = new FormData();
    form.set("name", "Diagnoza laptopa");
    form.set("price", "79,90");
    form.set("description", "Do 24 h");
    form.set("categoryId", category!.id);
    form.set("status", "hidden");
    form.set("image", png());
    expect((await h.call(itemUrl, { multipart: form })).status).toBe(303);

    const [item] = await catalog.listItems();
    expect(item).toMatchObject({ name: "Diagnoza laptopa", price: 7990, description: "Do 24 h", status: "hidden" });
    expect(item!.category_id).toBe(category!.id);
    expect(item!.image_key).toMatch(new RegExp(`^${siteId(site)}/images/.+\\.png$`));
    expect(await env.MEDIA.head(item!.image_key!)).not.toBeNull();
  });

  it("replaces the old image and deletes it from storage", async () => {
    const h = await seller();
    const site = await h.newSite("Foto");
    const itemUrl = (await h.call(`${site}/items`, { form: { name: "A", price: "1", kind: "product" } })).headers.get("location")!;
    const send = async () => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ name: "A", price: "1", status: "active" })) f.set(k, v);
      f.set("image", png());
      await h.call(itemUrl, { multipart: f });
      return (await forTenantForTest(siteId(site)).catalog.listItems())[0]!.image_key!;
    };
    const first = await send();
    const second = await send();
    expect(second).not.toBe(first);
    expect(await env.MEDIA.head(first)).toBeNull();
  });

  it("refuses bad prices, non-images and categories of other sites", async () => {
    const h = await seller();
    const site = await h.newSite("Walidacja");
    expect((await h.call(`${site}/items`, { form: { name: "X", price: "dużo", kind: "product" } })).status).toBe(400);
    const itemUrl = (await h.call(`${site}/items`, { form: { name: "X", price: "1", kind: "product" } })).headers.get("location")!;

    const other = forTenantForTest(await createTenant());
    const foreign = await other.catalog.createCategory({ name: "Obca" });
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: "X", price: "1", status: "active", categoryId: foreign.id })) f.set(k, v);
    expect((await h.call(itemUrl, { multipart: f })).status).toBe(400);

    const g = new FormData();
    for (const [k, v] of Object.entries({ name: "X", price: "1", status: "active" })) g.set(k, v);
    g.set("image", new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" }));
    expect((await h.call(itemUrl, { multipart: g })).status).toBe(400);
  });

  it("blocks foreign category ids in the core too, not only in the panel", async () => {
    const mine = forTenantForTest(await createTenant());
    const theirs = forTenantForTest(await createTenant());
    const cat = await theirs.catalog.createCategory({ name: "Cudza" });
    await expect(mine.catalog.createItem({ kind: "product", name: "X", price: 1, categoryId: cat.id })).rejects.toThrow(
      ValidationError,
    );
    await expect(mine.catalog.createCategory({ name: "Pod", parentId: cat.id })).rejects.toThrow(ValidationError);
  });

  it("does not let another seller open or change an item", async () => {
    const alice = await seller();
    const site = await alice.newSite("Alicja");
    const itemUrl = (await alice.call(`${site}/items`, { form: { name: "Tajne", price: "1", kind: "product" } })).headers.get(
      "location",
    )!;
    const mallory = await seller();
    expect((await mallory.call(itemUrl)).status).toBe(404);
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: "Zmienione", price: "0", status: "active" })) f.set(k, v);
    expect((await mallory.call(itemUrl, { multipart: f })).status).toBe(404);
    expect((await mallory.call(`${site}/categories`, { form: { name: "Spam" } })).status).toBe(404);
    expect((await forTenantForTest(siteId(site)).catalog.listItems())[0]!.name).toBe("Tajne");
  });
});

describe("panel: site settings", () => {
  it("lets the owner save settings and a logo, shown on the public site", async () => {
    const h = await seller();
    const site = await h.newSite("Kawiarnia", "qr-menu");
    const f = new FormData();
    for (const [k, v] of Object.entries({ tagline: "Kawa z duszą", phone: "600 700 800", accent: "#884400", theme: "simple" })) {
      f.set(k, v);
    }
    f.set("logo", png());
    expect((await h.call(`${site}/settings`, { multipart: f })).status).toBe(303);

    const settings = await forTenantForTest(siteId(site)).settings.get();
    expect(settings).toMatchObject({ tagline: "Kawa z duszą", accent: "#884400" });
    expect(settings.logoKey).toMatch(/\.png$/);
    expect(await (await h.call(`${site}/settings`)).text()).toContain("Kawa z duszą");
  });

  it("rejects invalid settings without saving anything", async () => {
    const h = await seller();
    const site = await h.newSite("Zle");
    const f = new FormData();
    f.set("tagline", "OK");
    f.set("accent", "</style><script>alert(1)</script>");
    expect((await h.call(`${site}/settings`, { multipart: f })).status).toBe(400);
    expect((await forTenantForTest(siteId(site)).settings.get()).tagline).toBe("");
  });

  it("keeps settings for owners only", async () => {
    const owner = await seller();
    const site = await owner.newSite("Firma");
    const staff = harness();
    const email = uniqueEmail();
    await staff.login(email);
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first<{ id: string }>();
    await env.DB.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?1, ?2, 'staff')").bind(user!.id, siteId(site)).run();

    expect((await staff.call(site)).status).toBe(200);
    expect((await staff.call(`${site}/settings`)).status).toBe(404);
    const f = new FormData();
    f.set("tagline", "Przejęte");
    expect((await staff.call(`${site}/settings`, { multipart: f })).status).toBe(404);
  });
});

describe("images", () => {
  it("rejects a file that only pretends to be a PNG", async () => {
    const h = await seller();
    const site = await h.newSite("Udawacz");
    const itemUrl = (await h.call(`${site}/items`, { form: { name: "X", price: "1", kind: "product" } })).headers.get("location")!;
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: "X", price: "1", status: "active" })) f.set(k, v);
    f.set("image", new File(["<html><script>alert(1)</script>"], "x.png", { type: "image/png" }));
    expect((await h.call(itemUrl, { multipart: f })).status).toBe(400);
  });
});
