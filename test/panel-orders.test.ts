import { describe, expect, it } from "vitest";
import { forTenantForTest } from "./core-under-test";
import { harness, uniqueEmail } from "./panel-harness";

const IBAN = "PL61109010140000071219812874";

async function shopWithOrder() {
  const h = harness();
  await h.login(uniqueEmail());
  const path = await h.newSite("Sklep z zamówieniami", "shop");
  const site = forTenantForTest(path.split("/").pop()!);
  await site.settings.update({ courierPrice: 1500, bankAccount: IBAN });
  const item = await site.catalog.createItem({ kind: "product", name: "Mysz <b>", price: 5999 });
  const { order } = await site.orders.place(
    [{ itemId: item.id, qty: 2 }],
    { name: "Anna", email: "anna@example.com", phone: "600100200", delivery: "courier", address: "ul. Długa 1, Warszawa" },
    await site.settings.get(),
  );
  return { h, path, site, order };
}

describe("panel orders", () => {
  it("lists orders with a badge for new ones and shows the details", async () => {
    const { h, path, order } = await shopWithOrder();
    expect(await (await h.call(path)).text()).toMatch(/Zamówienia <span class="count">1<\/span>/);
    const list = await (await h.call(`${path}/orders`)).text();
    expect(list).toContain("Nr 1 · Anna");
    const details = await (await h.call(`${path}/orders/${order.id}`)).text();
    expect(details).toContain("2 × Mysz &lt;b&gt;");
    expect(details).toContain("ul. Długa 1, Warszawa");
    expect(details).toContain("PL61 1090 1014 0000 0712 1981 2874");
    expect((await h.call(`${path}/orders?status=paid`)).status).toBe(200);
  });

  it("changes the status and notifies the customer once", async () => {
    const { h, path, site, order } = await shopWithOrder();
    const before = h.outbox.length;
    const res = await h.call(`${path}/orders/${order.id}/status`, { form: { status: "shipped", notify: "1" } });
    expect(res.headers.get("location")).toBe(`${path}/orders/${order.id}?ok=1&mailed=1`);
    expect((await site.orders.get(order.id))!.status).toBe("shipped");
    expect(h.outbox.length).toBe(before + 1);
    expect(h.outbox.at(-1)).toMatchObject({ to: "anna@example.com", subject: "Zamówienie nr 1 – wysłane" });
    await h.call(`${path}/orders/${order.id}/status`, { form: { status: "shipped", notify: "1" } });
    await h.call(`${path}/orders/${order.id}/status`, { form: { status: "done" } });
    expect(h.outbox.length).toBe(before + 1);
    expect((await h.call(`${path}/orders/${order.id}/status`, { form: { status: "lost" } })).status).toBe(400);
  });

  it("keeps orders private and only for shops", async () => {
    const { path, order } = await shopWithOrder();
    const other = harness();
    await other.login(uniqueEmail());
    expect((await other.call(`${path}/orders/${order.id}`)).status).toBe(404);
    expect((await other.call(`${path}/orders/${order.id}/status`, { form: { status: "cancelled" } })).status).toBe(404);
    const card = await other.newSite("Wizytówka bez zamówień", "business-card");
    expect((await other.call(`${card}/orders`)).status).toBe(404);
    expect(await (await other.call(card)).text()).not.toContain("/orders");
  });
});

describe("shop settings in the panel", () => {
  it("saves delivery and a checked account number, refusing typos", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const path = await h.newSite("Ustawienia sprzedaży", "shop");
    const site = forTenantForTest(path.split("/").pop()!);
    const form = (extra: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ tagline: "", about: "", email: "", phone: "", address: "", hours: "", accent: "#2f6fed", theme: "", shopFields: "1", ...extra }))
        f.append(k, v);
      return f;
    };
    expect(await (await h.call(`${path}/settings`)).text()).toContain('name="bankAccount"');
    expect((await h.call(`${path}/settings`, { multipart: form({ courierPrice: "15,99", bankAccount: "61 1090 1014 0000 0712 1981 2874" }) })).status).toBe(303);
    expect(await site.settings.get()).toMatchObject({ pickup: false, courierPrice: 1599, bankAccount: IBAN });
    const typo = await h.call(`${path}/settings`, { multipart: form({ pickup: "1", courierPrice: "", bankAccount: "62 1090 1014 0000 0712 1981 2874" }) });
    expect(typo.status).toBe(400);
    expect(await typo.text()).toContain("suma kontrolna");
    await h.call(`${path}/settings`, { multipart: form({ pickup: "1", courierPrice: "", bankAccount: "" }) });
    expect(await site.settings.get()).toMatchObject({ pickup: true, courierPrice: null, bankAccount: "" });
  });
});
