import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Media, forTenantForTest } from "./core-under-test";
import { createTenant } from "./helpers";

async function tenantWithSlug(slug: string): Promise<string> {
  const id = await createTenant();
  await env.DB.prepare("UPDATE tenants SET slug = ?2, name = ?3 WHERE id = ?1").bind(id, slug, `Sklep ${slug}`).run();
  return id;
}

const get = (url: string) => exports.default.fetch(url);

describe("worker", () => {
  it("reports health with database access", async () => {
    const res = await get("http://localhost/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("returns 404 for an unknown site", async () => {
    expect((await get("http://nikt.localhost/")).status).toBe(404);
    expect((await get("http://example.com/")).status).toBe(404);
  });

  it("serves a tenant home page by subdomain with only active items", async () => {
    const id = await tenantWithSlug("demo");
    const { catalog } = forTenantForTest(id);
    await catalog.createItem({ kind: "product", name: "Mysz <bezprzewodowa>", price: 4999 });
    await catalog.createItem({ kind: "product", name: "Ukryty", price: 1, status: "hidden" });

    const res = await get("http://demo.localhost:8787/");
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("Sklep demo");
    expect(body).toContain("Mysz &lt;bezprzewodowa&gt;");
    expect(body).toContain("49,99");
    expect(body).not.toContain("Ukryty");
  });

  it("serves a tenant by custom domain", async () => {
    const id = await tenantWithSlug("wlasna");
    await env.DB.prepare("INSERT INTO tenant_domains (domain, tenant_id) VALUES (?1, ?2)").bind("sklep-test.pl", id).run();
    const res = await get("https://www.sklep-test.pl/");
    expect(await res.text()).toContain("Sklep wlasna");
  });

  it("serves media only to the tenant that owns it", async () => {
    const owner = await tenantWithSlug("foto");
    await tenantWithSlug("obcy");
    const key = await new Media(env.MEDIA, owner).putImage(new Uint8Array([1, 2, 3]).buffer, "image/png");

    const own = await get(`http://foto.localhost/media/${key}`);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect((await get(`http://obcy.localhost/media/${key}`)).status).toBe(404);
  });

  it("rejects unsupported and oversized images", async () => {
    const media = new Media(env.MEDIA, "t1");
    await expect(media.putImage(new ArrayBuffer(1), "image/gif")).rejects.toThrow(/Unsupported/);
    await expect(media.putImage(new ArrayBuffer(6 * 1024 * 1024), "image/png")).rejects.toThrow(/5 MB/);
  });
});
