import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { parsePrice } from "../apps/worker/src/layout";
import { auth } from "./core-under-test";
import { harness, uniqueEmail } from "./panel-harness";

describe("login with e-mail link", () => {
  it("logs in through link and confirm button, with a hardened cookie", async () => {
    const h = harness();
    await h.call("/login", { form: { email: uniqueEmail() } });
    expect(h.outbox).toHaveLength(1);
    const token = h.tokenFrom(h.outbox[0]!);

    // Opening the link (as a mail scanner would) does not use it up.
    expect((await h.call(`/login/verify?t=${token}`)).status).toBe(200);
    expect((await h.call(`/login/verify?t=${token}`)).status).toBe(200);

    const res = await h.call("/login/verify", { form: { t: token } });
    expect(res.status).toBe(303);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(await (await h.call("/")).text()).toContain("Twoje strony");
  });

  it("accepts a link only once", async () => {
    const h = harness();
    await h.call("/login", { form: { email: uniqueEmail() } });
    const token = h.tokenFrom(h.outbox[0]!);
    expect((await h.call("/login/verify", { form: { t: token } })).status).toBe(303);
    expect((await h.call("/login/verify", { form: { t: token } })).status).toBe(400);
  });

  it("rejects expired links and kills older links after a login", async () => {
    const email = uniqueEmail();
    const t0 = auth.now();
    const old = await auth.requestLogin(env.DB, email, "1.1.1.1", t0 - auth.LOGIN_TTL - 1);
    expect(old.ok && (await auth.consumeLogin(env.DB, old.token, "", t0))).toBeNull();

    const a = await auth.requestLogin(env.DB, email, "1.1.1.1", t0);
    const b = await auth.requestLogin(env.DB, email, "1.1.1.1", t0);
    expect(a.ok && (await auth.consumeLogin(env.DB, a.token, "", t0))).toBeTruthy();
    expect(b.ok && (await auth.consumeLogin(env.DB, b.token, "", t0))).toBeNull();
  });

  it("answers the same for valid, invalid and rate-limited e-mails", async () => {
    const h = harness();
    const email = uniqueEmail();
    const bodies = new Set<string>();
    for (let i = 0; i < 5; i++) bodies.add(await (await h.call("/login", { form: { email } })).text());
    bodies.add(await (await h.call("/login", { form: { email: "not-an-email" } })).text());
    expect(bodies.size).toBe(1);
    expect(h.outbox).toHaveLength(auth.LIMIT_PER_EMAIL);
  });

  it("limits requests per IP address", async () => {
    const at = auth.now();
    const results = [];
    for (let i = 0; i < auth.LIMIT_PER_IP + 2; i++) {
      results.push((await auth.requestLogin(env.DB, uniqueEmail(), "9.9.9.9", at)).ok);
    }
    expect(results.filter(Boolean)).toHaveLength(auth.LIMIT_PER_IP);
  });

  it("stores only hashes of tokens and sessions", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const token = h.tokenFrom(h.outbox[0]!);
    const sessionValue = h.getCookie().split("=")[1]!;
    const hits = await env.DB.prepare(
      "SELECT (SELECT count(*) FROM login_tokens WHERE token_hash = ?1) + (SELECT count(*) FROM sessions WHERE id_hash = ?2) AS n",
    )
      .bind(token, sessionValue)
      .first<{ n: number }>();
    expect(hits?.n).toBe(0);
  });

  it("logs out and the old cookie stops working", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const stolen = h.getCookie();
    await h.call("/logout", { form: {} });
    h.setCookie(stolen);
    expect((await h.call("/")).headers.get("location")).toBe("/login");
  });
});

describe("panel protection", () => {
  it("sends anonymous and forged sessions to the login page", async () => {
    const h = harness();
    expect((await h.call("/")).status).toBe(303);
    h.setCookie("__Host-sid=forged-value");
    expect((await h.call("/")).headers.get("location")).toBe("/login");
  });

  it("refuses form posts from other sites or without an origin", async () => {
    const h = harness();
    expect((await h.call("/login", { form: { email: uniqueEmail() }, origin: "https://evil.example" })).status).toBe(403);
    expect((await h.call("/login", { form: { email: uniqueEmail() }, origin: null })).status).toBe(403);
    expect(h.outbox).toHaveLength(0);
  });

  it("sets strict security headers", async () => {
    const res = await harness().call("/login");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("never lets one seller touch another seller's site", async () => {
    const alice = harness();
    await alice.login(uniqueEmail());
    const created = await alice.call("/sites", { form: { name: "Sklep Alicji", kind: "shop" } });
    const siteUrl = created.headers.get("location")!;
    await alice.call(`${siteUrl}/items`, { form: { name: "Laptop", price: "2999,00", kind: "product" } });
    const itemId = (await env.DB.prepare("SELECT id FROM items WHERE name = 'Laptop'").first<{ id: string }>())!.id;

    const mallory = harness();
    await mallory.login(uniqueEmail());
    expect((await mallory.call(siteUrl)).status).toBe(404);
    expect((await mallory.call(`${siteUrl}/items`, { form: { name: "Spam", price: "1", kind: "product" } })).status).toBe(404);
    expect((await mallory.call(`${siteUrl}/items/${itemId}/delete`, { form: {} })).status).toBe(404);
    expect(await (await mallory.call("/")).text()).not.toContain("Sklep Alicji");

    expect(await (await alice.call(siteUrl)).text()).toContain("Laptop");
  });

  it("keeps reserved subdomains for the platform", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    await h.call("/sites", { form: { name: "Panel", kind: "shop" } });
    const row = await env.DB.prepare("SELECT slug FROM tenants WHERE name = 'Panel'").first<{ slug: string }>();
    expect(row?.slug).toBe("panel-1");
  });
});

describe("parsePrice", () => {
  it("reads Polish prices into grosze", () => {
    expect(parsePrice("29,99")).toBe(2999);
    expect(parsePrice("30")).toBe(3000);
    expect(parsePrice("1 299,5 zł")).toBe(129950);
    expect(parsePrice("-5")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
  });
});
