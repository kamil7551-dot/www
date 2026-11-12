import { html, raw } from "hono/html";
import { isSoldOut, type Category, type HomeView, type Item, type PageView } from "../core";

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

/** Address of an item's own page. */
export const itemHref = (item: Item) => `/p/${encodeURIComponent(item.slug)}`;

/**
 * Item detail used by every theme's page layout: big photo, name, price, description.
 * `after` is where the shop puts "add to cart" and modules their extras.
 */
export const itemDetail = (v: Pick<HomeView, "mediaUrl">, item: Item, after: unknown = "") => html`<article class="product">
  ${item.image_key
    ? html`<img class="product-pic" src="${v.mediaUrl(item.image_key, 1280)}"
        srcset="${v.mediaUrl(item.image_key, 640)} 640w, ${v.mediaUrl(item.image_key, 1280)} 1280w"
        sizes="(max-width: 48rem) 100vw, 32rem" alt="${item.name}" decoding="async" />`
    : ""}
  <div class="product-info">
    <h1>${item.name}</h1>
    <p class="product-price">${isSoldOut(item) ? html`<span class="soldout">Chwilowo niedostępne</span>` : zl(item.price)}</p>
    ${item.description ? item.description.split(/\n\s*\n/).map((p) => html`<p class="product-desc">${p}</p>`) : ""}
    ${after}
  </div>
</article>`;

/** CSS for the shared components above; themes include it in their own <style>. */
export const SHARED_CSS = `
.product{display:grid;gap:1.5rem;align-items:start}@media(min-width:48rem){.product{grid-template-columns:1fr 1fr}}
.product-pic{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;display:block}
.product h1{margin:0 0 .4rem;font-size:clamp(1.5rem,4vw,2.1rem);line-height:1.15}
.product-price{font-size:1.4rem;font-weight:700;margin:0 0 1rem;color:var(--accent)}
.product-desc{white-space:pre-line;margin:0 0 .8rem}
.soldout{font-size:.9rem;font-weight:700;color:#a3271a;background:#fdecea;border-radius:999px;padding:.2rem .7rem}
.back{display:inline-block;margin:0 0 1rem}`;

/** Plain layout for pages of themes that do not define their own. */
export const defaultPage = async (v: PageView) => html`<!doctype html>
  <html lang="pl">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      ${v.seo}
      <style>
        :root{--accent:${v.settings.accent}}*{box-sizing:border-box}
        body{margin:0;font:17px/1.55 system-ui,sans-serif;color:#1b1b1b;background:#fff}
        header,main,footer{max-width:62rem;margin:0 auto;padding:1.25rem}header{border-bottom:3px solid var(--accent)}
        header a{color:inherit;text-decoration:none;font-weight:700;font-size:1.2rem}a{color:var(--accent)}
        ${raw(SHARED_CSS)}
      </style>
      ${await v.slot("head", {})}
    </head>
    <body>
      <header><a href="/">${v.tenant.name}</a></header>
      <main>${v.body}</main>
      <footer>${await v.slot("footer", {})}</footer>
    </body>
  </html>`;
