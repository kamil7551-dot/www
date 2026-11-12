import { html } from "hono/html";
import { SORTS, browseHref, groszeToField, isSoldOut, type BrowseResult, type Category, type Item } from "../core";
import { itemHref, zl } from "./shared";

/**
 * Product grid, search box and the filter bar of category and search pages. Plain links and a
 * GET form: works without JavaScript, every state has its own address, the back button works.
 */

type MediaUrl = (key: string, width?: number) => string;

export const productCard = (mediaUrl: MediaUrl, i: Item) => {
  const out = isSoldOut(i);
  return html`<a class="pcard ${out ? "out" : ""}" href="${itemHref(i)}">
    ${i.image_key
      ? html`<img class="pic" src="${mediaUrl(i.image_key, 640)}" srcset="${mediaUrl(i.image_key, 320)} 320w, ${mediaUrl(i.image_key, 640)} 640w"
          sizes="(max-width: 48rem) 50vw, 16rem" alt="" loading="lazy" decoding="async" />`
      : html`<span class="nopic"></span>`}
    <span class="body"><span class="name">${i.name}</span>${out
      ? html`<span class="tag">Chwilowo niedostępne</span>`
      : html`<span class="price">${zl(i.price)}</span>`}</span>
  </a>`;
};

export const productGrid = (mediaUrl: MediaUrl, items: Item[]) => html`<div class="pgrid">${items.map((i) => productCard(mediaUrl, i))}</div>`;

export const searchBox = (q = "") => html`<form class="search" action="/produkty" method="get" role="search">
  <input type="search" name="q" value="${q}" placeholder="Szukaj produktów" aria-label="Szukaj produktów" maxlength="80" />
  <button>Szukaj</button>
</form>`;

export const categoryHref = (c: Category) => `/kategoria/${encodeURIComponent(c.slug)}`;

export interface Listing {
  mediaUrl: MediaUrl;
  result: BrowseResult;
  /** Address of this listing without the query string, e.g. /produkty or /kategoria/kawa. */
  base: string;
  heading: string;
  /** Category chips shown above the filters (subcategories, or top categories on /produkty). */
  chips: Category[];
  /** Path back up: the parent category, or the whole shop. */
  up?: { href: string; label: string };
}

export function listingPage(v: Listing) {
  const { result: r, base } = v;
  const q = r.query;
  const filtered = q.q || q.min !== null || q.max !== null;
  const range = r.priceRange;
  return html`<div class="listing">
    ${v.up ? html`<a class="back" href="${v.up.href}">← ${v.up.label}</a>` : ""}
    <h1>${v.heading}</h1>
    ${v.chips.length ? html`<nav class="chips" aria-label="Kategorie">${v.chips.map((c) => html`<a href="${categoryHref(c)}">${c.name}</a>`)}</nav>` : ""}
    <form class="filters" action="${base}" method="get">
      <label class="f-q"><span>Szukaj</span><input type="search" name="q" value="${q.q}" maxlength="80" /></label>
      <label><span>Cena od (zł)</span><input name="od" inputmode="decimal" value="${q.min === null ? "" : groszeToField(q.min)}"
        placeholder="${range ? groszeToField(Math.floor(range.min / 100) * 100) : ""}" /></label>
      <label><span>do (zł)</span><input name="do" inputmode="decimal" value="${q.max === null ? "" : groszeToField(q.max)}"
        placeholder="${range ? groszeToField(Math.ceil(range.max / 100) * 100) : ""}" /></label>
      <label><span>Sortuj</span><select name="sort">
        ${Object.entries(SORTS).map(([id, label]) => html`<option value="${id}" ${id === q.sort ? "selected" : ""}>${label}</option>`)}
      </select></label>
      <button>Pokaż</button>
    </form>
    <p class="count">${countLabel(r.total)}${filtered ? html` · <a href="${browseHref(base, { ...q, q: "", min: null, max: null })}">wyczyść filtry</a>` : ""}</p>
    ${r.items.length
      ? productGrid(v.mediaUrl, r.items)
      : html`<p class="empty">Nic nie pasuje. Spróbuj innego słowa albo szerszego zakresu cen.</p>`}
    ${r.pages > 1
      ? html`<nav class="pages" aria-label="Strony">
          ${r.page > 1 ? html`<a rel="prev" href="${browseHref(base, q, { page: r.page - 1 })}">← Poprzednia</a>` : html`<span></span>`}
          <span>Strona ${r.page} z ${r.pages}</span>
          ${r.page < r.pages ? html`<a rel="next" href="${browseHref(base, q, { page: r.page + 1 })}">Następna →</a>` : html`<span></span>`}
        </nav>`
      : ""}
  </div>`;
}

/** 1 produkt, 2 produkty, 5 produktów, 22 produkty. */
export function countLabel(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  const word = n === 1 ? "produkt" : ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? "produkty" : "produktów";
  return `${n} ${word}`;
}
