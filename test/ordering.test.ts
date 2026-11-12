import { describe, expect, it } from "vitest";
import { forTenantForTest } from "./core-under-test";
import { createTenant } from "./helpers";
import { harness, uniqueEmail } from "./panel-harness";

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("ordering", () => {
  it("adds new categories and items at the end, not alphabetically", async () => {
    const s = forTenantForTest(await createTenant("qr-menu"));
    for (const n of ["Zupy", "Dania główne", "Desery"]) await s.catalog.createCategory({ name: n });
    expect(names(await s.catalog.listCategories())).toEqual(["Zupy", "Dania główne", "Desery"]);
  });

  it("moves categories up and down, and stops at the ends", async () => {
    const s = forTenantForTest(await createTenant("qr-menu"));
    const cats = [];
    for (const n of ["A", "B", "C"]) cats.push(await s.catalog.createCategory({ name: n }));
    expect(await s.catalog.moveCategory(cats[2]!.id, "up")).toBe(true);
    expect(names(await s.catalog.listCategories())).toEqual(["A", "C", "B"]);
    expect(await s.catalog.moveCategory(cats[0]!.id, "up")).toBe(false);
    expect(await s.catalog.moveCategory(cats[1]!.id, "down")).toBe(false);
  });

  it("fixes old rows that all share position 0", async () => {
    const s = forTenantForTest(await createTenant("qr-menu"));
    for (const n of ["C", "A", "B"]) await s.catalog.createCategory({ name: n, position: 0 });
    expect(names(await s.catalog.listCategories())).toEqual(["A", "B", "C"]);
    const b = (await s.catalog.listCategories())[1]!;
    await s.catalog.moveCategory(b.id, "down");
    expect(names(await s.catalog.listCategories())).toEqual(["A", "C", "B"]);
  });

  it("moves an item only among items of its own category", async () => {
    const s = forTenantForTest(await createTenant("qr-menu"));
    const soups = await s.catalog.createCategory({ name: "Zupy" });
    const mains = await s.catalog.createCategory({ name: "Dania" });
    const add = (name: string, categoryId: string) => s.catalog.createItem({ kind: "dish", name, price: 100, categoryId });
    const zurek = await add("Żurek", soups.id);
    await add("Schabowy", mains.id);
    const rosol = await add("Rosół", soups.id);
    await add("Pierogi", mains.id);
    await s.catalog.moveItem(rosol.id, "up");
    const list = await s.catalog.listItems();
    expect(names(list.filter((i) => i.category_id === soups.id))).toEqual(["Rosół", "Żurek"]);
    expect(names(list.filter((i) => i.category_id === mains.id))).toEqual(["Schabowy", "Pierogi"]);
    expect(await s.catalog.moveItem(zurek.id, "down")).toBe(false);
  });

  it("renames and deletes categories, keeping their items", async () => {
    const s = forTenantForTest(await createTenant("shop"));
    const cat = await s.catalog.createCategory({ name: "Akcesoria" });
    const item = await s.catalog.createItem({ kind: "product", name: "Mysz", price: 5000, categoryId: cat.id });
    expect((await s.catalog.renameCategory(cat.id, "  Dodatki "))!).toMatchObject({ name: "Dodatki", slug: cat.slug });
    expect(await s.catalog.deleteCategory(cat.id)).toBe(true);
    expect(await s.catalog.listCategories()).toHaveLength(0);
    expect((await s.catalog.getItem(item.id))!.category_id).toBeNull();
  });

  it("searches names ignoring case, also Polish letters", async () => {
    const s = forTenantForTest(await createTenant("qr-menu"));
    for (const n of ["Żurek", "Barszcz", "Placki ziemniaczane"]) await s.catalog.createItem({ kind: "dish", name: n, price: 100 });
    expect(names(await s.catalog.listItems({ search: "żur" }))).toEqual(["Żurek"]);
    expect(names(await s.catalog.listItems({ search: "ZIEMN" }))).toEqual(["Placki ziemniaczane"]);
  });
});

describe("panel ordering and filters", () => {
  it("moves with arrows, groups by category and filters the list", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const path = await h.newSite("Kolejność", "qr-menu");
    const site = forTenantForTest(path.split("/").pop()!);
    for (const n of ["Zupy", "Desery"]) await h.call(`${path}/categories`, { form: { name: n } });
    const [soups, desserts] = await site.catalog.listCategories();
    const a = await site.catalog.createItem({ kind: "dish", name: "Żurek", price: 1900, categoryId: soups!.id });
    const b = await site.catalog.createItem({ kind: "dish", name: "Rosół", price: 1600, categoryId: soups!.id });
    await site.catalog.createItem({ kind: "dish", name: "Sernik", price: 1400, categoryId: desserts!.id, status: "hidden" });

    const page = await (await h.call(path)).text();
    expect(page.indexOf('<h3 class="group">Zupy</h3>')).toBeLessThan(page.indexOf('<h3 class="group">Desery</h3>'));
    expect(page).toContain(`/items/${b.id}/move`);

    const moved = await h.call(`${path}/items/${b.id}/move`, { form: { dir: "up" } });
    expect(moved.headers.get("location")).toBe(`${path}#i-${b.id}`);
    expect(names(await site.catalog.listItems())).toEqual(["Rosół", "Żurek", "Sernik"]);

    await h.call(`${path}/categories/${desserts!.id}/move`, { form: { dir: "up" } });
    expect(names(await site.catalog.listCategories())).toEqual(["Desery", "Zupy"]);

    const found = await (await h.call(`${path}?q=${encodeURIComponent("żur")}`)).text();
    expect(found).toContain("Żurek");
    expect(found).not.toContain(">Rosół<");
    expect(found).not.toContain("/move"); // no arrows while filtering
    const hidden = await (await h.call(`${path}?show=hidden`)).text();
    expect(hidden).toContain("Sernik");
    expect(hidden).not.toContain(">Żurek<");

    await h.call(`${path}/items/${a.id}/sold-out`, { form: { soldOut: "1", ret: "?show=soldout" } });
    const soldOut = await h.call(`${path}/items/${a.id}/sold-out`, { form: { soldOut: "1", ret: "//evil.example" } });
    expect(soldOut.headers.get("location")).toBe(`${path}#i-${a.id}`);
    const list = await (await h.call(`${path}?show=soldout`)).text();
    expect(list).toContain("Żurek");
    expect(list).not.toContain(">Rosół<");
  });

  it("renames and deletes a category from the panel, not someone else's", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const path = await h.newSite("Kategorie panel");
    await h.call(`${path}/categories`, { form: { name: "Stara" } });
    const site = forTenantForTest(path.split("/").pop()!);
    const [cat] = await site.catalog.listCategories();

    const other = harness();
    await other.login(uniqueEmail());
    expect((await other.call(`${path}/categories/${cat!.id}/delete`, { form: {} })).status).toBe(404);
    const otherPath = await other.newSite("Moja");
    expect((await other.call(`${otherPath}/categories/${cat!.id}`, { form: { name: "Przejęta" } })).status).toBe(404);

    await h.call(`${path}/categories/${cat!.id}`, { form: { name: "Nowa" } });
    expect(names(await site.catalog.listCategories())).toEqual(["Nowa"]);
    await h.call(`${path}/categories/${cat!.id}/delete`, { form: {} });
    expect(await site.catalog.listCategories()).toHaveLength(0);
  });
});
