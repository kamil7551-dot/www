import { html, raw } from "hono/html";
import { defineTheme, isSoldOut, type HomeView, type Item, type PageView } from "../../core";
import { SHARED_CSS, groups, itemHref, telHref, zl } from "../shared";

/** accent is validated as #rrggbb when saved and read, so it is safe inside CSS. */
const css = (accent: string) => `
:root{--accent:${accent};--ink:#15171a;--muted:#5d6370;--line:#e7e9ee;--bg:#fff;--soft:#f6f7f9}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--accent)}.wrap{max-width:72rem;margin:0 auto;padding:0 1.25rem}
.top{border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:2}
.top .wrap{display:flex;align-items:center;gap:1rem;min-height:3.75rem}
.brand{display:flex;align-items:center;gap:.6rem;color:var(--ink);text-decoration:none;font-weight:800;font-size:1.15rem}
.brand img{max-height:36px;max-width:9rem}.spacer{flex:1}
.hero{padding:2rem 0 .5rem}.hero p{margin:.2rem 0 0;color:var(--muted);font-size:1.1rem;max-width:44rem}
.chips{display:flex;gap:.4rem;overflow-x:auto;padding:1rem 0;scrollbar-width:none}
.chips a{flex:none;padding:.35rem .85rem;border-radius:999px;border:1px solid var(--line);color:var(--ink);text-decoration:none;font-size:.95rem;background:#fff}
h2{font-size:1.25rem;margin:1.5rem 0 .75rem}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(10.5rem,1fr))}
@media(min-width:48rem){.grid{grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:1.25rem}}
.card{display:flex;flex-direction:column;color:var(--ink);text-decoration:none;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:#fff}
.card:hover{border-color:var(--accent)}.card .pic{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:var(--soft)}
.card .nopic{aspect-ratio:1;background:var(--soft)}
.card .body{padding:.7rem .85rem .9rem;display:flex;flex-direction:column;gap:.2rem}
.card .name{font-weight:600;line-height:1.3}.card .price{font-weight:700}
.card.out{opacity:.6}.card .tag{font-size:.75rem;color:#a3271a;font-weight:700}
main{padding-bottom:2.5rem}
footer{border-top:1px solid var(--line);background:var(--soft);padding:1.5rem 0;color:var(--muted);font-size:.95rem}
footer p{margin:.2rem 0}
${SHARED_CSS}`;

const header = (v: HomeView | PageView) => html`<header class="top"><div class="wrap">
  <a class="brand" href="/">${v.settings.logoKey ? html`<img src="${v.mediaUrl(v.settings.logoKey, 320)}" alt="" />` : ""}${v.tenant.name}</a>
  <span class="spacer"></span>
</div></header>`;

const footer = async (v: HomeView | PageView) => html`<footer><div class="wrap">
  <p><strong>${v.tenant.name}</strong></p>
  ${v.settings.address ? html`<p>${v.settings.address}</p>` : ""}
  ${v.settings.phone ? html`<p><a href="${telHref(v.settings.phone)}">${v.settings.phone}</a></p>` : ""}
  ${v.settings.email ? html`<p><a href="mailto:${v.settings.email}">${v.settings.email}</a></p>` : ""}
  ${await v.slot("footer", {})}
</div></footer>`;

const card = (v: HomeView, i: Item) => {
  const out = isSoldOut(i);
  return html`<a class="card ${out ? "out" : ""}" href="${itemHref(i)}">
    ${i.image_key
      ? html`<img class="pic" src="${v.mediaUrl(i.image_key, 640)}" srcset="${v.mediaUrl(i.image_key, 320)} 320w, ${v.mediaUrl(i.image_key, 640)} 640w"
          sizes="(max-width: 48rem) 50vw, 16rem" alt="" loading="lazy" decoding="async" />`
      : html`<span class="nopic"></span>`}
    <span class="body"><span class="name">${i.name}</span>${out ? html`<span class="tag">Chwilowo niedostępne</span>` : html`<span class="price">${zl(i.price)}</span>`}</span>
  </a>`;
};

/** Small shop: product grid by category, each product with its own page. Zero JavaScript. */
export default defineTheme({
  id: "shop",
  name: "Sklep",
  kinds: ["shop"],
  home: async (v: HomeView) => {
    const sections = groups(v.items, v.categories);
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
            ${sections.length > 1 ? html`<nav class="chips" aria-label="Kategorie">${sections.map((g) => html`<a href="#${g.id}">${g.title}</a>`)}</nav>` : ""}
            ${await v.slot("home.top", {})}
            ${sections.length
              ? sections.map(
                  (g) => html`<section id="${g.id}">${g.title ? html`<h2>${g.title}</h2>` : ""}<div class="grid">${g.items.map((i) => card(v, i))}</div></section>`,
                )
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
