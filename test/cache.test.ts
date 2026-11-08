import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TtlCache, cachedTenantResolver } from "./core-under-test";
import { createTenant } from "./helpers";

describe("TtlCache", () => {
  it("expires entries and drops the least recently used beyond the cap", () => {
    let t = 0;
    const cache = new TtlCache<number>(2, () => t);
    cache.set("a", 1, 100);
    cache.set("b", 2, 100);
    expect(cache.get("a")).toBe(1); // "a" is now the most recent
    cache.set("c", 3, 100);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    t = 150;
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("cachedTenantResolver", () => {
  it("serves repeat lookups from memory and remembers misses briefly", async () => {
    const id = await createTenant();
    await env.DB.prepare("UPDATE tenants SET slug = 'kesz' WHERE id = ?1").bind(id).run();
    let queries = 0;
    const counting = new Proxy(env.DB, {
      get: (target, prop) =>
        prop === "prepare" ? (sql: string) => (queries++, target.prepare(sql)) : Reflect.get(target, prop, target),
    });
    let t = 0;
    const resolve = cachedTenantResolver({ ttlMs: 1000, missTtlMs: 100, clock: () => t });

    expect((await resolve(counting, "kesz.localhost", "localhost"))?.id).toBe(id);
    const afterFirst = queries;
    expect((await resolve(counting, "KESZ.localhost", "localhost"))?.id).toBe(id);
    expect(queries).toBe(afterFirst);

    expect(await resolve(counting, "nie-ma.localhost", "localhost")).toBeNull();
    const afterMiss = queries;
    expect(await resolve(counting, "nie-ma.localhost", "localhost")).toBeNull();
    expect(queries).toBe(afterMiss);

    t = 200; // miss expired, hit still valid
    await resolve(counting, "nie-ma.localhost", "localhost");
    await resolve(counting, "kesz.localhost", "localhost");
    expect(queries).toBeGreaterThan(afterMiss);
    const settled = queries;
    await resolve(counting, "kesz.localhost", "localhost");
    expect(queries).toBe(settled);
  });
});
