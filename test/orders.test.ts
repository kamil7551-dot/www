import { describe, expect, it } from "vitest";
import { cleanIban, defineModule, deliveryOptions, forTenantForTest, formatIban, testPlatform, TenantDb, ValidationError, type Order } from "./core-under-test";
import { env } from "cloudflare:workers";
import { createTenant } from "./helpers";

const IBAN = "PL61109010140000071219812874";

async function shop(settings: Record<string, unknown> = { courierPrice: 1599, bankAccount: IBAN }) {
  const s = forTenantForTest(await createTenant("shop"));
  await s.settings.update(settings);
  const mouse = await s.catalog.createItem({ kind: "product", name: "Mysz", price: 5999 });
  const cable = await s.catalog.createItem({ kind: "product", name: "Kabel", price: 2900 });
  return { s, mouse, cable };
}

const buyer = { name: "Anna Nowak", email: "Anna@Example.com", phone: "600 100 200", delivery: "courier" as const, address: "ul. Długa 1, 00-001 Warszawa" };

describe("shop settings", () => {
  it("accepts only real Polish account numbers", () => {
    expect(cleanIban("61 1090 1014 0000 0712 1981 2874")).toBe(IBAN);
    expect(cleanIban("pl61-1090-1014-0000-0712-1981-2874")).toBe(IBAN);
    expect(cleanIban("PL62109010140000071219812874")).toBeNull(); // one digit off
    expect(cleanIban("")).toBe("");
    expect(formatIban(IBAN)).toBe("PL61 1090 1014 0000 0712 1981 2874");
  });

  it("validates delivery settings", async () => {
    const s = forTenantForTest(await createTenant("shop"));
    expect(await s.settings.get()).toMatchObject({ pickup: true, courierPrice: null, bankAccount: "" });
    await expect(s.settings.update({ courierPrice: -1 })).rejects.toThrow(ValidationError);
    await expect(s.settings.update({ courierPrice: 12.5 })).rejects.toThrow(ValidationError);
    await expect(s.settings.update({ pickup: "yes" })).rejects.toThrow(ValidationError);
    await expect(s.settings.update({ bankAccount: "123" })).rejects.toThrow(ValidationError);
    expect(deliveryOptions(await s.settings.update({ courierPrice: 1500, pickup: false }))).toEqual([{ id: "courier", price: 1500 }]);
  });
});

describe("orders", () => {
  it("prices the cart from the catalog and numbers orders per shop", async () => {
    const { s, mouse, cable } = await shop();
    const settings = await s.settings.get();
    const { order, key } = await s.orders.place(
      [
        { itemId: mouse.id, qty: 2 },
        { itemId: cable.id, qty: 1 },
      ],
      buyer,
      settings,
    );
    expect(order).toMatchObject({ number: 1, status: "new", email: "anna@example.com", payment: "transfer", items_total: 14898, delivery_price: 1599, total: 16497 });
    expect(order.lines).toEqual([
      { item_id: mouse.id, name: "Mysz", price: 5999, qty: 2 },
      { item_id: cable.id, name: "Kabel", price: 2900, qty: 1 },
    ]);
    expect(key.length).toBeGreaterThan(20);
    const second = await s.orders.place([{ itemId: cable.id, qty: 1 }], { ...buyer, delivery: "pickup" }, settings);
    expect(second.order).toMatchObject({ number: 2, payment: "on-pickup", delivery_price: 0, address: "" });
    const other = await shop();
    expect((await other.s.orders.place([{ itemId: other.cable.id, qty: 1 }], buyer, await other.s.settings.get())).order.number).toBe(1);
  });

  it("keeps the price paid even when the product changes later", async () => {
    const { s, mouse } = await shop();
    const { order } = await s.orders.place([{ itemId: mouse.id, qty: 1 }], buyer, await s.settings.get());
    await s.catalog.updateItem(mouse.id, { price: 9999, name: "Mysz Pro" });
    await s.catalog.deleteItem(mouse.id);
    expect((await s.orders.get(order.id))!.lines[0]).toMatchObject({ name: "Mysz", price: 5999 });
  });

  it("refuses items from other shops, hidden or sold out, and caps quantities", async () => {
    const { s, mouse, cable } = await shop();
    const foreign = await shop();
    const settings = await s.settings.get();
    await expect(s.orders.place([{ itemId: foreign.mouse.id, qty: 1 }], buyer, settings)).rejects.toThrow("cart");
    await s.catalog.updateItem(cable.id, { status: "hidden" });
    await expect(s.orders.place([{ itemId: mouse.id, qty: 1 }, { itemId: cable.id, qty: 1 }], buyer, settings)).rejects.toThrow("cart-changed");
    const priced = await s.orders.price([{ itemId: mouse.id, qty: 500 }, { itemId: mouse.id, qty: -3 }]);
    expect(priced.lines[0]!.qty).toBe(99);
  });

  it("validates the customer's details", async () => {
    const { s, mouse } = await shop({ courierPrice: 1500 }); // no bank account yet
    const settings = await s.settings.get();
    const cart = [{ itemId: mouse.id, qty: 1 }];
    const fail = (patch: object) => s.orders.place(cart, { ...buyer, ...patch }, settings);
    await expect(fail({ name: " " })).rejects.toThrow("name");
    await expect(fail({ email: "nie-mail", delivery: "pickup" })).rejects.toThrow("email");
    await expect(fail({ address: "x" })).rejects.toThrow("address");
    await expect(fail({ delivery: "drone" })).rejects.toThrow("delivery");
    await expect(fail({})).rejects.toThrow("delivery"); // courier needs a bank account for the transfer
    await expect(fail({ delivery: "pickup" })).resolves.toBeTruthy();
  });

  it("shows the order to the customer only with the secret from their link", async () => {
    const { s, mouse } = await shop();
    const { order, key } = await s.orders.place([{ itemId: mouse.id, qty: 1 }], buyer, await s.settings.get());
    expect((await s.orders.getForCustomer(order.id, key))!.id).toBe(order.id);
    expect(await s.orders.getForCustomer(order.id, "zgadywanie")).toBeNull();
    const raw = await env.DB.prepare("SELECT access_hash FROM orders WHERE id = ?1").bind(order.id).first<{ access_hash: string }>();
    expect(raw!.access_hash).not.toContain(key);
  });

  it("emits events for modules on create and status changes", async () => {
    const seen: string[] = [];
    const watcher = defineModule({
      id: "test-order-watcher",
      name: "Watcher",
      version: "0.1.0",
      hooks: {
        "order.created": ({ order }: { order: Order }) => void seen.push(`created ${order.number}`),
        "order.paid": ({ order }: { order: Order }) => void seen.push(`paid ${order.number}`),
        "order.shipped": ({ order }: { order: Order }) => void seen.push(`shipped ${order.number}`),
      },
    });
    const platform = testPlatform();
    platform.modules.register(watcher);
    platform.modules.attach(platform.bus);
    const tenantId = await createTenant("shop");
    await platform.modules.enable(new TenantDb(env.DB, tenantId), "test-order-watcher");
    const s = forTenantForTest(tenantId, platform);
    const item = await s.catalog.createItem({ kind: "product", name: "Kubek", price: 3000 });
    const { order } = await s.orders.place([{ itemId: item.id, qty: 1 }], { ...buyer, delivery: "pickup" }, await s.settings.get());
    await s.orders.setStatus(order.id, "paid");
    await s.orders.setStatus(order.id, "paid"); // no repeat
    await s.orders.setStatus(order.id, "shipped");
    await expect(s.orders.setStatus(order.id, "lost" as never)).rejects.toThrow(ValidationError);
    expect(seen).toEqual(["created 1", "paid 1", "shipped 1"]);
    expect((await s.orders.list({ status: "shipped" })).map((o) => o.id)).toEqual([order.id]);
  });
});
