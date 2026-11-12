import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { ORDER_STATUSES, formatIban, type Mailer, type Orders, type OrderStatus, type Settings } from "../../../core";
import { zl } from "./layout";
import type { PanelEnv } from "./panel";
import { notice, panelPage, type SiteNav } from "./panel-ui";

/** What the orders screens need from the panel's membership-checked site. */
interface Site {
  tenantId: string;
  tenant: { name: string; kind: string };
  nav: (active: SiteNav["active"]) => SiteNav;
  orders: Orders;
  settings: Settings;
}

type C = Context<PanelEnv>;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  new: "Nowe",
  paid: "Opłacone",
  shipped: "Wysłane",
  done: "Zrealizowane",
  cancelled: "Anulowane",
};
const PILL: Record<OrderStatus, string> = { new: "draft", paid: "active", shipped: "active", done: "hidden", cancelled: "hidden" };

/** What the customer reads when the seller changes the status and ticks "notify". */
const CUSTOMER_TEXT: Partial<Record<OrderStatus, string>> = {
  paid: "Otrzymaliśmy płatność za Twoje zamówienie. Dziękujemy!",
  shipped: "Twoje zamówienie zostało wysłane.",
  done: "Twoje zamówienie jest zrealizowane. Dziękujemy za zakupy!",
  cancelled: "Twoje zamówienie zostało anulowane. Jeśli to pomyłka, odpowiedz na tę wiadomość.",
};

const when = (t: number) =>
  new Date(t * 1000).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "medium", timeStyle: "short" });

export function orderRoutes(
  app: Hono<PanelEnv>,
  deps: { siteFor: (c: C) => Promise<Site | null>; notFound: (c: C) => Response; mailer: (env: Env) => Mailer; },
) {
  const { siteFor, notFound } = deps;
  const shopFor = async (c: C) => {
    const site = await siteFor(c);
    return site && site.tenant.kind === "shop" ? site : null;
  };

  app.get("/sites/:site/orders", async (c: C) => {
    const site = await shopFor(c);
    if (!site) return notFound(c);
    const filter = c.req.query("status") ?? "";
    const status = (ORDER_STATUSES as string[]).includes(filter) ? (filter as OrderStatus) : undefined;
    const orders = await site.orders.list({ status });
    const base = `/sites/${site.tenantId}/orders`;
    const chip = (value: string, label: string) =>
      html`<a class="btn small ${value === (status ?? "") ? "primary" : ""}" href="${value ? `${base}?status=${value}` : base}">${label}</a>`;
    return c.html(
      panelPage({
        title: "Zamówienia",
        email: c.get("user").email,
        site: site.nav("orders"),
        body: html`<div class="inline filters">${chip("", "Wszystkie")} ${ORDER_STATUSES.map((s) => chip(s, ORDER_STATUS_LABEL[s]))}</div>
          ${orders.length
            ? html`<div class="list">
                ${orders.map(
                  (o) => html`<a href="${base}/${o.id}">
                    <div class="grow">
                      <div class="name">Nr ${o.number} · ${o.customer_name}</div>
                      <div class="sub">${when(o.created_at)} · ${o.delivery === "courier" ? "Kurier" : "Odbiór osobisty"}
                        <span class="pill ${PILL[o.status]}">${ORDER_STATUS_LABEL[o.status]}</span></div>
                    </div>
                    <span class="price">${zl(o.total)}</span>
                  </a>`,
                )}
              </div>`
            : html`<div class="card empty">${status ? "Brak zamówień z tym statusem." : "Tu pojawią się zamówienia z Twojego sklepu."}</div>`}`,
      }),
    );
  });

  app.get("/sites/:site/orders/:id", async (c: C) => {
    const site = await shopFor(c);
    if (!site) return notFound(c);
    const [order, settings] = await Promise.all([site.orders.get(c.req.param("id") ?? ""), site.settings.get()]);
    if (!order) return notFound(c);
    const base = `/sites/${site.tenantId}/orders`;
    return c.html(
      panelPage({
        title: `Zamówienie nr ${order.number}`,
        email: c.get("user").email,
        site: site.nav("orders"),
        notice: c.req.query("ok") ? notice("ok", c.req.query("mailed") ? "Zapisano i powiadomiono klienta." : "Zapisano.") : "",
        body: html`<p><a class="crumb" href="${base}">← Wszystkie zamówienia</a></p>
          <div class="grid two">
            <div class="card">
              <h2>Nr ${order.number} <span class="pill ${PILL[order.status]}">${ORDER_STATUS_LABEL[order.status]}</span></h2>
              <p class="sub">${when(order.created_at)}</p>
              <p><strong>${order.customer_name}</strong><br />
                <a href="mailto:${order.email}">${order.email}</a>${order.phone ? html`<br /><a href="tel:${order.phone}">${order.phone}</a>` : ""}</p>
              <p>${order.delivery === "courier" ? html`Kurier na adres:<br /><strong class="msgtext">${order.address}</strong>` : "Odbiór osobisty"}</p>
              <p>${order.payment === "transfer" ? html`Przelew na ${formatIban(settings.bankAccount)}, tytuł „Zamówienie nr ${order.number}”` : "Płatność przy odbiorze"}</p>
              ${order.note ? html`<p class="msgtext">Uwagi: ${order.note}</p>` : ""}
            </div>
            <div class="card">
              <h2>Produkty</h2>
              <div class="sums">
                ${order.lines.map((l) => html`<p><span>${l.qty} × ${l.name}</span><span>${zl(l.price * l.qty)}</span></p>`)}
                ${order.delivery_price ? html`<p><span>Dostawa</span><span>${zl(order.delivery_price)}</span></p>` : ""}
                <p class="total"><span>Razem</span><span>${zl(order.total)}</span></p>
              </div>
            </div>
          </div>
          <form method="post" action="${base}/${order.id}/status" class="card">
            <h2>Zmień status</h2>
            <div class="inline">
              <select name="status" aria-label="Nowy status">
                ${ORDER_STATUSES.map((s) => html`<option value="${s}" ${s === order.status ? "selected" : ""}>${ORDER_STATUS_LABEL[s]}</option>`)}
              </select>
              <button class="btn primary">Zapisz</button>
            </div>
            <label class="check"><input type="checkbox" name="notify" value="1" checked /> Powiadom klienta mailem</label>
          </form>`,
      }),
    );
  });

  app.post("/sites/:site/orders/:id/status", async (c: C) => {
    const site = await shopFor(c);
    if (!site) return notFound(c);
    const form = await c.req.parseBody();
    const status = String(form.status ?? "");
    if (!(ORDER_STATUSES as string[]).includes(status)) return c.text("Nieznany status", 400);
    const before = await site.orders.get(c.req.param("id") ?? "");
    if (!before) return notFound(c);
    const order = (await site.orders.setStatus(before.id, status as OrderStatus))!;
    const text = CUSTOMER_TEXT[order.status];
    const mailed = form.notify === "1" && before.status !== order.status && text;
    if (mailed) {
      const settings = await site.settings.get();
      c.executionCtx.waitUntil(
        deps
          .mailer(c.env)
          .send({
            to: order.email,
            replyTo: settings.email || undefined,
            subject: `Zamówienie nr ${order.number} – ${ORDER_STATUS_LABEL[order.status].toLowerCase()}`,
            text: `${text}\n\nZamówienie nr ${order.number} w sklepie ${site.tenant.name}, wartość ${zl(order.total)}.\n`,
          })
          .catch((err: unknown) => console.error("status mail failed", err)),
      );
    }
    return c.redirect(`/sites/${site.tenantId}/orders/${order.id}?ok=1${mailed ? "&mailed=1" : ""}`, 303);
  });
}
