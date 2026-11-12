import { html, raw } from "hono/html";
import { categoryAndChildren, defineTheme, type HomeView, type PageView } from "../../core";
import { legalLinks } from "../legal";
import { categoryHref, countLabel, productGrid, searchBox } from "../listing";
import { SHARED_CSS, groups, telHref } from "../shared";

/** accent is validated as #rrggbb when saved and read, so it is safe inside CSS. */
const css = (accent: string) => `
:root{--accent:${accent};--ink:#15171a;--muted:#5d6370;--line:#e7e9ee;--bg:#fff;--soft:#f6f7f9}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--accent)}.wrap{max-width:72rem;margin:0 auto;padding:0 1.25rem}
.top{border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:2}
.top .wrap{display:flex;align-items:center;gap:1rem;min-height:3.75rem;flex-wrap:wrap;padding-block:.5rem}
@media(max-width:40rem){.top .search{order:3;flex-basis:100%;max-width:none}}
.brand{display:flex;align-items:center;gap:.6rem;color:var(--ink);text-decoration:none;font-weight:800;font-size:1.15rem}
.brand img{max-height:36px;max-width:9rem}.spacer{flex:1}
.hero{padding:2rem 0 .5rem}.hero p{margin:.2rem 0 0;color:var(--muted);font-size:1.1rem;max-width:44rem}
h2{font-size:1.25rem;margin:1.5rem 0 .75rem}
main{padding-bottom:2.5rem}
.cart-link{color:var(--ink);text-decoration:none;font-weight:600;display:flex;align-items:center;gap:.35rem}
.cart-link .count{background:var(--accent);color:#fff;border-radius:999px;min-width:1.4rem;padding:0 .4rem;text-align:center;font-size:.8rem}
footer{border-top:1px solid var(--line);background:var(--soft);padding:1.5rem 0;color:var(--muted);font-size:.95rem}
footer p{margin:.2rem 0}
${SHARED_CSS}`;

const header = (v: HomeView | PageView) => html`<header class="top"><div class="wrap">
  <a class="brand" href="/">${v.settings.logoKey ? html`<img src="${v.mediaUrl(v.settings.logoKey, 320)}" alt="" />` : ""}${v.tenant.name}</a>
  <span class="spacer"></span>
  ${v.tenant.kind === "shop" ? searchBox() : ""}
  ${v.cartCount !== undefined
    ? html`<a class="cart-link" href="/cart">Koszyk${v.cartCount ? html` <span class="count">${v.cartCount}</span>` : ""}</a>`
    : ""}
</div></header>`;

const footer = async (v: HomeView | PageView) => html`<footer><div class="wrap">
  <p><strong>${v.tenant.name}</strong></p>
  ${v.settings.address ? html`<p>${v.settings.address}</p>` : ""}
  ${v.settings.phone ? html`<p><a href="${telHref(v.settings.phone)}">${v.settings.phone}</a></p>` : ""}
  ${v.settings.email ? html`<p><a href="mailto:${v.settings.email}">${v.settings.email}</a></p>` : ""}
  ${legalLinks(v.tenant.kind)}
  ${await v.slot("footer", {})}
</div></footer>`;

/** Home page sections show this many products; the rest is one click away on the category page. */
const PER_SECTION = 8;

/** Small shop: product grid by category, each product with its own page. Zero JavaScript. */
export default defineTheme({
  id: "shop",
  name: "Sklep",
  kinds: ["shop"],
  home: async (v: HomeView) => {
    const sections = groups(v.items, v.categories);
    const used = new Set(v.items.map((i) => i.category_id));
    const top = v.categories.filter((c) => !c.parent_id && [...categoryAndChildren(v.categories, c.id)].some((id) => used.has(id)));
    return html`<!doctype html>
      <html lang="pl">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          ${v.seo}
          <style>${raw(css(v.settings.accent))}</style>
          ${await v.slot("head", {})}
        </head>
        <body>
          ${header(v)}
          <main class="wrap">
            <div class="hero">${v.settings.tagline ? html`<p>${v.settings.tagline}</p>` : ""}</div>
            ${top.length > 1 ? html`<nav class="chips" aria-label="Kategorie">${top.map((c) => html`<a href="${categoryHref(c)}">${c.name}</a>`)}</nav>` : ""}
            ${await v.slot("home.top", {})}
            ${sections.length
              ? sections.map((g) => {
                  const category = v.categories.find((c) => c.slug === g.id);
                  const more = g.items.length > PER_SECTION;
                  return html`<section id="${g.id}">${g.title ? html`<h2>${g.title}</h2>` : ""}${productGrid(v.mediaUrl, more ? g.items.slice(0, PER_SECTION) : g.items)}
                    ${more ? html`<a class="more" href="${category ? categoryHref(category) : "/produkty"}">Zobacz wszystkie: ${countLabel(g.items.length)} →</a>` : ""}</section>`;
                })
              : html`<p>Wkrótce pojawią się tu produkty.</p>`}
            ${await v.slot("home.bottom", {})}
          </main>
          ${await footer(v)}
        </body>
      </html>`;
  },
  page: async (v: PageView) => html`<!doctype html>
    <html lang="pl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        ${v.seo}
        <style>${raw(css(v.settings.accent))}</style>
        ${await v.slot("head", {})}
      </head>
      <body>
        ${header(v)}
        <main class="wrap"><div class="hero"></div>${v.body}</main>
        ${await footer(v)}
      </body>
    </html>`,
});
