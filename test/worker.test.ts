import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("worker", () => {
  it("serves the home page as HTML", async () => {
    const res = await exports.default.fetch("http://example.com/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("reports health with database access", async () => {
    const res = await exports.default.fetch("http://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tenants: 0 });
  });
});
