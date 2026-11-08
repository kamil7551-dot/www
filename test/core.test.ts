import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { EventBus, ModuleRegistry, TenantDb, ValidationError, defineModule, forTenantForTest, slugify, testPlatform } from "./core-under-test";
import { createTenant } from "./helpers";

describe("slugify", () => {
  it("keeps Polish words readable", () => {
    expect(slugify("Żółta łódź & Ćma")).toBe("zolta-lodz-cma");
  });
});

describe("TenantDb", () => {
  it("rejects queries that are not tenant-scoped", async () => {
    const db = new TenantDb(env.DB, "t1");
    await expect(db.all("SELECT * FROM items")).rejects.toThrow(/not tenant-scoped/);
  });
});

describe("catalog", () => {
  it("creates, lists, updates and deletes items", async () => {
    const tenantId = await createTenant();
    const { catalog } = forTenantForTest(tenantId);
    const cat = await catalog.createCategory({ name: "Akcesoria" });
    const item = await catalog.createItem({ kind: "product", name: "Kabel USB-C", price: 2999, categoryId: cat.id });

    expect(item.slug).toBe("kabel-usb-c");
    expect(await catalog.listItems({ categoryId: cat.id })).toHaveLength(1);

    const updated = await catalog.updateItem(item.id, { price: 2499, status: "hidden" });
    expect(updated).toMatchObject({ price: 2499, status: "hidden", name: "Kabel USB-C" });
    expect(await catalog.listItems({ status: "active" })).toHaveLength(0);

    expect(await catalog.deleteItem(item.id)).toBe(true);
    expect(await catalog.getItem(item.id)).toBeNull();
  });

  it("never shows one tenant's items to another", async () => {
    const a = forTenantForTest(await createTenant());
    const b = forTenantForTest(await createTenant());
    const item = await a.catalog.createItem({ kind: "dish", name: "Pierogi", price: 3200 });

    expect(await b.catalog.getItem(item.id)).toBeNull();
    expect(await b.catalog.listItems()).toEqual([]);
    expect(await b.catalog.deleteItem(item.id)).toBe(false);
    expect(await a.catalog.getItem(item.id)).not.toBeNull();
  });

  it("rejects invalid prices and kinds", async () => {
    const { catalog } = forTenantForTest(await createTenant());
    await expect(catalog.createItem({ kind: "product", name: "X", price: 9.99 })).rejects.toThrow(ValidationError);
    // @ts-expect-error testing a runtime guard
    await expect(catalog.createItem({ kind: "car", name: "X", price: 1 })).rejects.toThrow(ValidationError);
  });
});

describe("modules", () => {
  it("runs hooks only for tenants that enabled the module", async () => {
    const seen: string[] = [];
    const notify = defineModule({
      id: "test-notify",
      name: "Test",
      version: "0.0.1",
      hooks: { "item.created": ({ item }, ctx) => void seen.push(`${ctx.tenantId}:${item.name}`) },
    });
    const bus = new EventBus();
    const modules = new ModuleRegistry().register(notify);
    modules.attach(bus);

    const on = await createTenant();
    const off = await createTenant();
    await modules.enable(new TenantDb(env.DB, on), "test-notify");

    await forTenantForTest(on, { bus, modules, themes: testPlatform().themes }).catalog.createItem({ kind: "service", name: "Serwis", price: 100 });
    await forTenantForTest(off, { bus, modules, themes: testPlatform().themes }).catalog.createItem({ kind: "service", name: "Serwis", price: 100 });

    expect(seen).toEqual([`${on}:Serwis`]);
  });

  it("keeps working when a module hook throws", async () => {
    const log = vi.fn();
    const bus = new EventBus(log);
    const modules = new ModuleRegistry().register(
      defineModule({ id: "broken", name: "Broken", version: "0.0.1", hooks: { "item.created": () => { throw new Error("boom"); } } }),
    );
    modules.attach(bus);
    const tenantId = await createTenant();
    await modules.enable(new TenantDb(env.DB, tenantId), "broken");

    const item = await forTenantForTest(tenantId, { bus, modules, themes: testPlatform().themes }).catalog.createItem({ kind: "product", name: "A", price: 1 });
    expect(item.name).toBe("A");
    expect(log).toHaveBeenCalledOnce();
  });

  it("validates ids, dependencies and required settings", async () => {
    expect(() => defineModule({ id: "Bad_Id", name: "x", version: "1" })).toThrow(/kebab-case/);
    const modules = new ModuleRegistry().register(
      defineModule({ id: "base", name: "Base", version: "1", settings: { key: { type: "secret", label: "Klucz", required: true } } }),
      defineModule({ id: "addon", name: "Addon", version: "1", requires: ["base"] }),
    );
    const db = new TenantDb(env.DB, await createTenant());
    await expect(modules.enable(db, "addon")).rejects.toThrow(/Enable base/);
    await expect(modules.enable(db, "base")).rejects.toThrow(/needs setting "key"/);
    await modules.enable(db, "base", { key: "abc" });
    await modules.enable(db, "addon");
    expect(await modules.enabledFor(db)).toEqual(new Set(["base", "addon"]));
  });
});
