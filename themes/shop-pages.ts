import { html } from "hono/html";
import { formatIban, type Checkout, type HomeView, type Item, type Order, type PricedCart, type SiteSettings } from "../core";
import { itemHref, zl } from "./shared";

/**
 * Shop pages shared by every theme: cart, checkout and the customer's order page.
 * Plain HTML forms, zero JavaScript; styles are in SHARED_CSS.
 */

const DELIVERY_LABEL = { pickup: "Odbiór osobisty", courier: "Kurier" } as const;
const PAYMENT_LABEL = { "on-pickup": "Płatność przy odbiorze", transfer: "Przelew na konto" } as const;
const STATUS_LABEL = { new: "Przyjęte", paid: "Opłacone", shipped: "Wysłane", done: "Zrealizowane", cancelled: "Anulowane" } as const;

export const addToCart = (item: Item) => html`<form method="post" action="/cart/add" class="buy">
  <input type="hidden" name="itemId" value="${item.id}" />
  <label>Ilość <input type="number" name="qty" value="1" min="1" max="99" inputmode="numeric" /></label>
  <button class="buy-btn">Dodaj do koszyka</button>
</form>`;

const deliveryLine = (s: SiteSettings) =>
  [s.pickup ? "odbiór osobisty (gratis)" : "", s.courierPrice !== null ? `kurier ${zl(s.courierPrice)}` : ""].filter(Boolean).join(", ");

export function cartPage(v: Pick<HomeView, "mediaUrl">, cart: PricedCart, settings: SiteSettings, notice = "") {
  if (!cart.lines.length) {
    return html`<h1>Koszyk</h1>
      ${notice ? html`<p class="flash">${notice}</p>` : ""}
      <p>Koszyk jest pusty.</p>
      <p><a class="back" href="/">← Wróć do sklepu</a></p>`;
  }
  return html`<h1>Koszyk</h1>
    ${notice ? html`<p class="flash">${notice}</p>` : ""}
    ${cart.dropped ? html`<p class="flash">Część produktów nie jest już dostępna i zniknęła z koszyka.</p>` : ""}
    <ul class="lines">
      ${cart.lines.map(
        (l) => html`<li>
          ${l.item.image_key ? html`<img src="${v.mediaUrl(l.item.image_key, 320)}" alt="" loading="lazy" />` : html`<span class="nopic"></span>`}
          <div class="line-main">
            <a href="${itemHref(l.item)}">${l.item.name}</a>
            <span class="muted">${zl(l.item.price)} / szt.</span>
          </div>
          <form method="post" action="/cart/update" class="qty">
            <input type="hidden" name="itemId" value="${l.item.id}" />
            <input type="number" name="qty" value="${l.qty}" min="0" max="99" inputmode="numeric" aria-label="Ilość: ${l.item.name}" />
            <button name="op" value="set" class="link">Zmień</button>
            <button name="op" value="remove" class="link danger">Usuń</button>
          </form>
          <strong class="line-total">${zl(l.total)}</strong>
        </li>`,
      )}
    </ul>
    <div class="summary">
      <p><span>Razem za produkty</span><strong>${zl(cart.itemsTotal)}</strong></p>
      ${deliveryLine(settings) ? html`<p class="muted">Dostawa: ${deliveryLine(settings)}</p>` : ""}
      <a class="buy-btn" href="/checkout">Przejdź do zamówienia</a>
      <a class="back" href="/">← Kupuj dalej</a>
    </div>`;
}

const ERROR_TEXT: Record<string, string> = {
  name: "Podaj imię i nazwisko.",
  email: "Podaj poprawny adres e-mail.",
  phone: "Podaj poprawny numer telefonu (kurier go potrzebuje).",
  address: "Podaj pełny adres dostawy.",
  delivery: "Wybierz sposób dostawy.",
  cart: "Koszyk jest pusty.",
  "cart-changed": "Część produktów nie jest już dostępna. Sprawdź koszyk.",
};

export function checkoutPage(cart: PricedCart, settings: SiteSettings, values: Partial<Checkout> = {}, error = "") {
  const options = [
    ...(settings.pickup ? [{ id: "pickup" as const, price: 0, info: `Płatność przy odbiorze${settings.address ? `. ${settings.address}` : ""}` }] : []),
    ...(settings.courierPrice !== null && settings.bankAccount
      ? [{ id: "courier" as const, price: settings.courierPrice, info: "Płatność przelewem, dane dostaniesz po złożeniu zamówienia." }]
      : []),
  ];
  const chosen = values.delivery ?? options[0]?.id;
  return html`<h1>Zamówienie</h1>
    ${error ? html`<p class="flash err" role="alert">${ERROR_TEXT[error] ?? "Sprawdź formularz."}</p>` : ""}
    ${options.length
      ? html`<form method="post" action="/checkout" class="checkout">
          <fieldset>
            <legend>Twoje dane</legend>
            <label>Imię i nazwisko<input name="name" value="${values.name ?? ""}" required maxlength="100" autocomplete="name" /></label>
            <label>E-mail<input type="email" name="email" value="${values.email ?? ""}" required autocomplete="email" /></label>
            <label>Telefon<input type="tel" name="phone" value="${values.phone ?? ""}" maxlength="30" autocomplete="tel" /></label>
          </fieldset>
          <fieldset>
            <legend>Dostawa</legend>
            ${options.map(
              (o) => html`<label class="choice"><input type="radio" name="delivery" value="${o.id}" ${o.id === chosen ? "checked" : ""} required />
                <span><strong>${DELIVERY_LABEL[o.id]}</strong> · ${o.price ? zl(o.price) : "gratis"}<br /><span class="muted">${o.info}</span></span></label>`,
            )}
            <label>Adres dostawy (dla kuriera)<textarea name="address" rows="3" maxlength="300" autocomplete="street-address">${values.address ?? ""}</textarea></label>
            <label>Uwagi do zamówienia (opcjonalnie)<textarea name="note" rows="2" maxlength="1000">${values.note ?? ""}</textarea></label>
          </fieldset>
          <div class="summary">
            ${cart.lines.map((l) => html`<p><span>${l.qty} × ${l.item.name}</span><span>${zl(l.total)}</span></p>`)}
            <p><span>Razem za produkty</span><strong>${zl(cart.itemsTotal)}</strong></p>
            <p class="muted">Do tego koszt wybranej dostawy.</p>
            <button class="buy-btn">Zamawiam i płacę</button>
            <a class="back" href="/cart">← Wróć do koszyka</a>
          </div>
        </form>`
      : html`<p>Sklep nie przyjmuje jeszcze zamówień online. Skontaktuj się ze sprzedawcą.</p>`}`;
}

export function orderPage(order: Order, settings: SiteSettings, justPlaced: boolean) {
  return html`<h1>Zamówienie nr ${order.number}</h1>
    ${justPlaced ? html`<p class="flash ok" role="status">Dziękujemy! Zamówienie przyjęte. Potwierdzenie wysłaliśmy na ${order.email}.</p>` : ""}
    <p class="muted">Status: <strong>${STATUS_LABEL[order.status]}</strong></p>
    ${order.payment === "transfer" && order.status === "new"
      ? html`<div class="pay">
          <h2>Dane do przelewu</h2>
          <p><span>Numer konta</span><strong>${formatIban(settings.bankAccount)}</strong></p>
          <p><span>Kwota</span><strong>${zl(order.total)}</strong></p>
          <p><span>Tytuł</span><strong>Zamówienie nr ${order.number}</strong></p>
          <p class="muted">Wyślemy zamówienie, gdy przelew dotrze na konto.</p>
        </div>`
      : ""}
    ${order.delivery === "pickup"
      ? html`<p>Odbiór osobisty${settings.address ? html`: <strong>${settings.address}</strong>` : ""}${settings.hours ? html`, ${settings.hours}` : ""}. Płatność przy odbiorze.</p>`
      : html`<p>Dostawa kurierem na adres:<br /><strong class="addr">${order.address}</strong></p>`}
    <div class="summary">
      ${order.lines.map((l) => html`<p><span>${l.qty} × ${l.name}</span><span>${zl(l.price * l.qty)}</span></p>`)}
      ${order.delivery_price ? html`<p><span>Dostawa</span><span>${zl(order.delivery_price)}</span></p>` : ""}
      <p><span>Razem</span><strong>${zl(order.total)}</strong></p>
      <p class="muted">${PAYMENT_LABEL[order.payment]}</p>
    </div>
    <p><a class="back" href="/">← Wróć do sklepu</a></p>`;
}

/** Plain-text e-mails; links and amounts only, so they look right in every mail app. */
export function orderMails(order: Order, settings: SiteSettings, shopName: string, orderUrl: string, panelUrl: string) {
  const lines = order.lines.map((l) => `${l.qty} × ${l.name} – ${zl(l.price * l.qty)}`).join("\n");
  const sums = `${order.delivery_price ? `Dostawa: ${zl(order.delivery_price)}\n` : ""}Razem: ${zl(order.total)}`;
  const howToPay =
    order.payment === "transfer"
      ? `Prosimy o przelew:\nNumer konta: ${formatIban(settings.bankAccount)}\nKwota: ${zl(order.total)}\nTytuł: Zamówienie nr ${order.number}`
      : `Odbiór osobisty${settings.address ? `: ${settings.address}` : ""}${settings.hours ? ` (${settings.hours})` : ""}. Płatność przy odbiorze.`;
  return {
    customer: {
      to: order.email,
      replyTo: settings.email || undefined,
      subject: `Zamówienie nr ${order.number} – ${shopName}`,
      text: `Dziękujemy za zamówienie w sklepie ${shopName}!\n\n${lines}\n${sums}\n\n${howToPay}\n\nStatus zamówienia sprawdzisz tutaj:\n${orderUrl}\n`,
    },
    seller: settings.email
      ? {
          to: settings.email,
          replyTo: order.email,
          subject: `Nowe zamówienie nr ${order.number}: ${zl(order.total)}`,
          text: `${order.customer_name} <${order.email}>${order.phone ? `, tel. ${order.phone}` : ""}\n${DELIVERY_LABEL[order.delivery]}${order.address ? `: ${order.address}` : ""}\n${PAYMENT_LABEL[order.payment]}\n${order.note ? `Uwagi: ${order.note}\n` : ""}\n${lines}\n${sums}\n\nZamówienie w panelu:\n${panelUrl}\n`,
        }
      : null,
  };
}
