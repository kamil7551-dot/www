import { normalizeEmail, now, randomToken, sha256 } from "./auth";
import { isSoldOut, ValidationError, type Item } from "./catalog";
import { newId, type TenantDb } from "./db";
import type { CoreEvents, EventName } from "./events";
import type { SiteSettings } from "./settings";

export type OrderStatus = "new" | "paid" | "shipped" | "done" | "cancelled";
export type Delivery = "pickup" | "courier";
export type Payment = "transfer" | "on-pickup";

export const ORDER_STATUSES: OrderStatus[] = ["new", "paid", "shipped", "done", "cancelled"];
export const MAX_CART_LINES = 50;
export const MAX_QTY = 99;

export interface OrderLine {
  item_id: string;
  name: string;
  price: number;
  qty: number;
}

export interface Order {
  id: string;
  number: number;
  status: OrderStatus;
  customer_name: string;
  email: string;
  phone: string;
  delivery: Delivery;
  address: string;
  payment: Payment;
  note: string;
  items_total: number;
  delivery_price: number;
  total: number;
  currency: string;
  created_at: number;
  updated_at: number;
  lines: OrderLine[];
}

export interface CartLine {
  itemId: string;
  qty: number;
}

export interface PricedCart {
  lines: { item: Item; qty: number; total: number }[];
  itemsTotal: number;
  /** Lines dropped because the item is gone, hidden or sold out. */
  dropped: number;
}

export interface Checkout {
  name: string;
  email: string;
  phone?: string;
  delivery: Delivery;
  address?: string;
  note?: string;
}

const STATUS_EVENT: Partial<Record<OrderStatus, "order.paid" | "order.shipped" | "order.cancelled">> = {
  paid: "order.paid",
  shipped: "order.shipped",
  cancelled: "order.cancelled",
};

type Emit = <E extends EventName>(event: E, payload: CoreEvents[E]) => Promise<void>;

const COLUMNS = `id, number, status, customer_name, email, phone, delivery, address, payment, note,
  items_total, delivery_price, total, currency, created_at, updated_at`;

/** Delivery methods a shop offers, from its settings. */
export function deliveryOptions(s: Pick<SiteSettings, "pickup" | "courierPrice">): { id: Delivery; price: number }[] {
  return [
    ...(s.pickup ? [{ id: "pickup" as const, price: 0 }] : []),
    ...(s.courierPrice !== null ? [{ id: "courier" as const, price: s.courierPrice }] : []),
  ];
}

/** Orders of one shop. Prices always come from the catalog, never from the visitor. */
export class Orders {
  constructor(
    private db: TenantDb,
    private emit: Emit,
    private items: (ids: string[]) => Promise<Item[]>,
  ) {}

  /** Current prices for a cart; items that can no longer be bought are dropped. */
  async price(cart: CartLine[]): Promise<PricedCart> {
    const wanted = new Map<string, number>();
    for (const l of cart.slice(0, MAX_CART_LINES)) {
      if (Number.isInteger(l.qty) && l.qty > 0) wanted.set(l.itemId, Math.min(MAX_QTY, (wanted.get(l.itemId) ?? 0) + l.qty));
    }
    const found = await this.items([...wanted.keys()]);
    const lines = found
      .filter((i) => i.status === "active" && !isSoldOut(i))
      .map((item) => ({ item, qty: wanted.get(item.id)!, total: item.price * wanted.get(item.id)! }));
    return { lines, itemsTotal: lines.reduce((s, l) => s + l.total, 0), dropped: wanted.size - lines.length };
  }

  /**
   * Places an order. Returns the order and the secret for the customer's order link
   * (shown once, only its hash is stored). Throws ValidationError with the field name.
   */
  async place(cart: CartLine[], input: Checkout, settings: SiteSettings, at = now()): Promise<{ order: Order; key: string }> {
    const priced = await this.price(cart);
    if (!priced.lines.length) throw new ValidationError("cart");
    if (priced.dropped) throw new ValidationError("cart-changed");
    const name = input.name.trim().slice(0, 100);
    if (!name) throw new ValidationError("name");
    const email = normalizeEmail(input.email);
    if (!email) throw new ValidationError("email");
    const phone = (input.phone ?? "").trim().slice(0, 30);
    if (phone && !/^\+?[\d\s()-]{6,30}$/.test(phone)) throw new ValidationError("phone");
    const delivery = deliveryOptions(settings).find((d) => d.id === input.delivery);
    if (!delivery) throw new ValidationError("delivery");
    const address = (input.address ?? "").trim().slice(0, 300);
    if (delivery.id === "courier" && (address.length < 5 || !phone)) throw new ValidationError(address.length < 5 ? "address" : "phone");
    // Pickup is paid on the spot; courier orders are paid by transfer until online payments arrive.
    const payment: Payment = delivery.id === "pickup" ? "on-pickup" : "transfer";
    if (payment === "transfer" && !settings.bankAccount) throw new ValidationError("delivery");

    const id = newId();
    const key = randomToken();
    const total = priced.itemsTotal + delivery.price;
    const insertOrder: [string, ...unknown[]] = [
      `INSERT INTO orders (tenant_id, id, number, customer_name, email, phone, delivery, address, payment, note,
         items_total, delivery_price, total, access_hash, created_at, updated_at)
       SELECT ?1, ?2, coalesce(max(number), 0) + 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14
       FROM orders WHERE tenant_id = ?1`,
      id,
      name,
      email,
      phone,
      delivery.id,
      delivery.id === "courier" ? address : "",
      payment,
      (input.note ?? "").trim().slice(0, 1000),
      priced.itemsTotal,
      delivery.price,
      total,
      await sha256(`order:${key}`),
      at,
    ];
    const insertLines = priced.lines.map((l): [string, ...unknown[]] => [
      `INSERT INTO order_items (tenant_id, order_id, item_id, name, price, qty) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      id,
      l.item.id,
      l.item.name,
      l.item.price,
      l.qty,
    ]);
    // Two orders at the same moment may pick the same number; the UNIQUE rule stops the second, which retries.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.batch([insertOrder, ...insertLines]);
        break;
      } catch (error) {
        if (attempt >= 3 || !String(error).includes("UNIQUE")) throw error;
      }
    }
    const order = (await this.get(id))!;
    await this.emit("order.created", { order });
    return { order, key };
  }

  async get(id: string): Promise<Order | null> {
    const row = await this.db.first<Omit<Order, "lines">>(`SELECT ${COLUMNS} FROM orders WHERE tenant_id = ?1 AND id = ?2`, id);
    if (!row) return null;
    const lines = await this.db.all<OrderLine>(
      `SELECT item_id, name, price, qty FROM order_items WHERE tenant_id = ?1 AND order_id = ?2 ORDER BY rowid`,
      id,
    );
    return { ...row, lines };
  }

  /** The customer's view of their order: needs the secret from the link in their e-mail. */
  async getForCustomer(id: string, key: string): Promise<Order | null> {
    const found = await this.db.first<{ id: string }>(
      `SELECT id FROM orders WHERE tenant_id = ?1 AND id = ?2 AND access_hash = ?3`,
      id,
      await sha256(`order:${key}`),
    );
    return found ? this.get(found.id) : null;
  }

  list(filter: { status?: OrderStatus } = {}, limit = 200): Promise<Omit<Order, "lines">[]> {
    return this.db.all(
      `SELECT ${COLUMNS} FROM orders WHERE tenant_id = ?1 AND (?2 IS NULL OR status = ?2) ORDER BY created_at DESC, number DESC LIMIT ?3`,
      filter.status ?? null,
      limit,
    );
  }

  async countNew(): Promise<number> {
    return (await this.db.first<{ n: number }>(`SELECT count(*) AS n FROM orders WHERE tenant_id = ?1 AND status = 'new'`))?.n ?? 0;
  }

  async setStatus(id: string, status: OrderStatus): Promise<Order | null> {
    if (!ORDER_STATUSES.includes(status)) throw new ValidationError("status");
    const before = await this.get(id);
    if (!before) return null;
    if (before.status === status) return before;
    await this.db.run(`UPDATE orders SET status = ?3, updated_at = unixepoch() WHERE tenant_id = ?1 AND id = ?2`, id, status);
    const order = (await this.get(id))!;
    const event = STATUS_EVENT[status];
    if (event) await this.emit(event, { order });
    return order;
  }
}
