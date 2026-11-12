import { html } from "hono/html";
import type { Category, HomeView, Item } from "../core";

/** Helpers every theme may use. Themes stay free to look different; behaviour stays the same. */

export const zl = (grosze: number) => (grosze / 100).toLocaleString("pl-PL", { style: "currency", currency: "PLN" });

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

export const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** Items grouped by category in category order; items without a category go last. */
export function groups(items: Item[], categories: Category[]): { id: string; title: string; items: Item[] }[] {
  const out = categories
    .map((c) => ({ id: c.slug, title: c.name, items: items.filter((i) => i.category_id === c.id) }))
    .filter((g) => g.items.length);
  const rest = items.filter((i) => !i.category_id || !categories.some((c) => c.id === i.category_id));
  if (rest.length) out.push({ id: "pozostale", title: out.length ? "Pozostałe" : "", items: rest });
  return out;
}

/** Responsive <img> for an item, using the pre-rendered WebP sizes. */
export const itemImage = (v: HomeView, item: Item, sizes: string, cls = "pic") =>
  item.image_key
    ? html`<img class="${cls}" src="${v.mediaUrl(item.image_key, 640)}"
        srcset="${v.mediaUrl(item.image_key, 320)} 320w, ${v.mediaUrl(item.image_key, 640)} 640w, ${v.mediaUrl(item.image_key, 1280)} 1280w"
        sizes="${sizes}" alt="${item.name}" loading="lazy" decoding="async" />`
    : "";

/**
 * Contact form posting to /contact. The "website" field is a trap for bots: it is moved off screen,
 * so people never fill it in.
 */
export const contactForm = (v: HomeView) => html`
  ${v.flash === "sent" ? html`<p class="flash ok" role="status">Dziękujemy! Wiadomość wysłana, odezwiemy się wkrótce.</p>` : ""}
  ${v.flash === "contact-error"
    ? html`<p class="flash err" role="status">Nie udało się wysłać. Sprawdź e-mail i treść albo spróbuj za chwilę.</p>`
    : ""}
  <form class="contact" method="post" action="/contact">
    <label>Imię<input name="name" required maxlength="100" autocomplete="name" /></label>
    <label>E-mail<input type="email" name="email" required autocomplete="email" /></label>
    <label>Telefon (opcjonalnie)<input type="tel" name="phone" maxlength="30" autocomplete="tel" /></label>
    <label>Wiadomość<textarea name="message" required minlength="2" maxlength="4000" rows="5"></textarea></label>
    <label class="trap" aria-hidden="true">Strona www<input name="website" tabindex="-1" autocomplete="off" /></label>
    <button>Wyślij wiadomość</button>
  </form>`;
