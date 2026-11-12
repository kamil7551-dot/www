import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../apps/worker/src/index";
import { forTenantForTest, type Mail } from "./core-under-test";
import { createTenant } from "./helpers";

const IBAN = "PL61109010140000071219812874";

async function shop(slug: string, kind: "shop" | "business-card" = "shop") {
  const id = await createTenant(kind);
  await env.DB.prepare("UPDATE tenants SET slug = ?2, name = ?3 WHERE id = ?1").bind(id, slug, `Sklep ${slug}`).run();
  const s = { id, ...forTenantForTest(id) };
  await s.settings.update({ courierPrice: 1500, bankAccount: IBAN, email: "sprzedawca@example.com", address: "Rynek 1, Kraków" });
  const mouse = await s.catalog.createItem({ kind: "product", name: "Mysz", price: 5999 });
  const cable = await s.catalog.createItem({ kind: "product", name: "Kabel", price: 2900 });
  return { ...s, mouse, cable };
}

/** A browser for one shop: keeps the cart cookie between requests. */
function visitor(slug: string) {
  const outbox: Mail[] = [];
  const app = createApp({ mailer: () => ({ send: async (m) => void outbox.push(m) }) });
  const origin = `https://${slug}.localhost`;
  let cookie = "";
  const go = async (path: string, form?: Record<string, string>, opts: { origin?: string } = {}) => {
    const headers = new Headers();
    if (cookie) headers.set("cookie", cookie);
    if (form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      headers.set("origin", opts.origin ?? origin);
    }
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request(origin + path, { method: form ? "POST" : "GET", headers, body: form && new URLSearchParams(form).toString(), redirect: "manual" }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const set = res.headers.get("set-cookie");
    if (set?.startsWith("cart=")) cookie = /Max-Age=0/i.test(set) ? "" : set.split(";")[0]!;
    return { res, status: res.status, location: res.headers.get("location"), body: await res.text() };
  };
  return { go, outbox, cookie: () => cookie };
}

const buyer = { name: "Anna Nowak", email: "anna@example.com", phone: "600100200", delivery: "courier", address: "ul. Długa 1, 00-001 Warszawa", terms: "1" };

describe("cart", () => {
  it("adds, changes and removes products, counting them in the header", async () => {
    const s = await shop("koszyk");
    const v = visitor("koszyk");
    expect((await v.go("/p/mysz")).body).toContain('action="/cart/add"');
    expect((await v.go("/cart/add", { itemId: s.mouse.id, qty: "2" })).location).toBe("/cart?n=added");
    await v.go("/cart/add", { itemId: s.cable.id, qty: "1" });
    await v.go("/cart/add", { itemId: s.mouse.id, qty: "1" });
    let page = (await v.go("/cart")).body;
    expect(page).toContain('<span class="count">4</span>');
    expect(page).toMatch(/name="qty" value="3"/);
    expect(page).toContain("208,97"); // 3 × 59,99 + 29,00
    await v.go("/cart/update", { itemId: s.mouse.id, qty: "1", op: "set" });
    await v.go("/cart/update", { itemId: s.cable.id, op: "remove" });
    page = (await v.go("/cart")).body;
    expect(page).not.toContain("Kabel");
    expect(page).toContain('<span class="count">1</span>');
  });

  it("ignores tampered cookies, unknown and hidden products, and other sites' forms", async () => {
    const s = await shop("koszyk-zly");
    const v = visitor("koszyk-zly");
    await s.catalog.updateItem(s.cable.id, { status: "hidden" });
    expect((await v.go("/cart/add", { itemId: s.cable.id })).location).toBe("/cart?n=gone");
    expect((await v.go("/cart/add", { itemId: s.mouse.id }, { origin: "https://evil.example" })).status).toBe(403);
    const app = createApp({ mailer: () => ({ send: async () => {} }) });
    const res = await app.fetch(
      new Request("https://koszyk-zly.localhost/cart", { headers: { cookie: `cart=${encodeURIComponent('[["x",1],{"a":1},"<b>"]')}` } }),
      env,
      createExecutionContext(),
    );
    expect(await res.text()).toContain("Koszyk jest pusty");
  });

  it("exists only in shops", async () => {
    await shop("bez-koszyka", "business-card");
    expect((await visitor("bez-koszyka").go("/cart")).status).toBe(404);
    expect((await visitor("bez-koszyka").go("/p/mysz")).body).not.toContain("/cart/add");
  });
});

describe("checkout", () => {
  it("places the order, empties the cart, mails both sides and shows transfer details", async () => {
    const s = await shop("kasa");
    const v = visitor("kasa");
    await v.go("/cart/add", { itemId: s.mouse.id, qty: "2" });
    expect((await v.go("/checkout")).body).toContain('name="delivery" value="courier"');
    const done = await v.go("/checkout", buyer);
    expect(done.status).toBe(303);
    expect(v.cookie()).toBe("");
    const [order] = await s.orders.list();
    expect(order).toMatchObject({ number: 1, total: 2 * 5999 + 1500, payment: "transfer" });
    expect(done.location).toMatch(new RegExp(`^/order/${order!.id}\\?k=[\\w-]+&new=1$`));

    const page = await v.go(done.location!);
    expect(page.body).toContain("Zamówienie nr 1");
    expect(page.body).toContain("PL61 1090 1014 0000 0712 1981 2874");
    expect(page.body).toContain('<meta name="robots" content="noindex" />');
    expect(page.res.headers.get("referrer-policy")).toBe("no-referrer");

    expect(v.outbox.map((m) => m.to)).toEqual(["anna@example.com", "sprzedawca@example.com"]);
    expect(v.outbox[0]!.text).toContain(`https://kasa.localhost/order/${order!.id}?k=`);
    expect(v.outbox[0]!.text).toContain("Tytuł: Zamówienie nr 1");
    expect(v.outbox[1]).toMatchObject({ replyTo: "anna@example.com", subject: expect.stringMatching(/^Nowe zamówienie nr 1: 134,98\szł$/) });
    expect(v.outbox[1]!.text).toContain(`/sites/${s.id}/orders/${order!.id}`);
  });

  it("keeps what the customer typed and explains the problem", async () => {
    const s = await shop("kasa-bledy");
    const v = visitor("kasa-bledy");
    await v.go("/cart/add", { itemId: s.mouse.id });
    const res = await v.go("/checkout", { ...buyer, address: "" });
    expect(res.status).toBe(400);
    expect(res.body).toContain("Podaj pełny adres dostawy.");
    expect(res.body).toContain('value="Anna Nowak"');
    expect(await s.orders.list()).toHaveLength(0);
  });

  it("asks for the terms to be accepted before placing the order", async () => {
    const s = await shop("kasa-regulamin");
    const v = visitor("kasa-regulamin");
    await v.go("/cart/add", { itemId: s.mouse.id });
    const { terms: _, ...noTerms } = buyer;
    const res = await v.go("/checkout", noTerms);
    expect(res.status).toBe(400);
    expect(res.body).toContain("Zaakceptuj regulamin");
    expect(res.body).toContain('href="/regulamin"');
    expect(await s.orders.list()).toHaveLength(0);
  });

  it("does not show an order without the secret from the link", async () => {
    const s = await shop("kasa-sekret");
    const v = visitor("kasa-sekret");
    await v.go("/cart/add", { itemId: s.mouse.id });
    const { location } = await v.go("/checkout", { ...buyer, delivery: "pickup" });
    const id = location!.split("/")[2]!.split("?")[0];
    expect((await v.go(`/order/${id}`)).status).toBe(404);
    expect((await v.go(`/order/${id}?k=zgaduje`)).status).toBe(404);
    expect((await v.go(location!)).body).toContain("Płatność przy odbiorze");
  });

  it("sends an empty cart back to the cart page", async () => {
    await shop("kasa-pusta");
    const v = visitor("kasa-pusta");
    expect((await v.go("/checkout")).location).toBe("/cart");
    expect((await v.go("/checkout", buyer)).location).toBe("/cart");
  });
});
