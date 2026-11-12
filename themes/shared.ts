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
.back{display:inline-block;margin:0 0 1rem}
.muted{color:#5d6370}.flash{padding:.75rem 1rem;border-radius:10px;background:#eef3ff;font-weight:600}
.flash.ok{background:#e6f6ec;color:#11683a}.flash.err{background:#fdecea;color:#a3271a}
.buy{display:flex;gap:.6rem;align-items:end;flex-wrap:wrap;margin:1rem 0}.buy label{display:grid;gap:.2rem;font-size:.85rem;color:#5d6370}
.buy input{width:5rem}
.buy-btn{display:inline-block;text-align:center;font:inherit;font-weight:700;padding:.85rem 1.4rem;border-radius:10px;border:0;
background:var(--accent);color:#fff;cursor:pointer;text-decoration:none}.buy-btn:hover{filter:brightness(1.07)}
input,textarea{font:inherit;padding:.6rem .7rem;border:1px solid #d7dae0;border-radius:8px;background:#fff;color:inherit;width:100%}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
.lines{list-style:none;margin:0 0 1.5rem;padding:0;border-top:1px solid #e7e9ee}
.lines li{display:grid;grid-template-columns:4rem 1fr auto;gap:.4rem 1rem;align-items:center;padding:.9rem 0;border-bottom:1px solid #e7e9ee}
.lines img,.lines .nopic{width:4rem;height:4rem;border-radius:8px;object-fit:cover;background:#f6f7f9;grid-row:span 2}
.line-main{display:grid}.line-main a{color:inherit;font-weight:600}.line-total{text-align:right}
.qty{display:flex;gap:.5rem;align-items:center;grid-column:2/4}.qty input{width:4.5rem;padding:.35rem .5rem}
.link{background:none;border:0;padding:0;font:inherit;color:var(--accent);cursor:pointer;text-decoration:underline}.link.danger{color:#a3271a}
.summary{display:grid;gap:.5rem;max-width:26rem;margin-left:auto}.summary p{display:flex;justify-content:space-between;gap:1rem;margin:0}
.summary .buy-btn{margin-top:.5rem}.summary .back{text-align:center}
.checkout{display:grid;gap:1.5rem}@media(min-width:56rem){.checkout{grid-template-columns:1.3fr 1fr;align-items:start}.checkout .summary{grid-column:2;grid-row:1/3}}
.checkout fieldset{border:0;padding:0;margin:0;display:grid;gap:.85rem}.checkout legend{font-weight:700;font-size:1.1rem;margin-bottom:.5rem}
.checkout label{display:grid;gap:.3rem;font-weight:600;font-size:.92rem}
.choice{grid-template-columns:auto 1fr!important;align-items:start;border:1px solid #d7dae0;border-radius:10px;padding:.8rem;font-weight:400!important}
.choice input{width:auto;margin:.3rem .3rem 0 0}.choice:has(input:checked){border-color:var(--accent);background:#f6f8ff}
.pay{border:2px solid var(--accent);border-radius:12px;padding:1rem 1.2rem;margin:1rem 0;max-width:34rem}
.pay h2{margin:0 0 .6rem;font-size:1.1rem}.pay p{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin:.3rem 0}`;

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
