import { html } from "hono/html";
import { ALLERGENS, allergenNumber, defineTheme, isSoldOut, parseAllergens, type HomeView, type Item } from "../../core";
import { groups, mapsUrl, telHref, zl } from "../shared";

/**
 * QR menu card: built for a phone held at the table. Sticky category bar, dishes with prices,
 * allergen numbers with a legend, sold-out dishes greyed out. Zero JavaScript.
 */
export default defineTheme({
  id: "qr-card",
  name: "Karta menu",
  kinds: ["qr-menu"],
  home: async (v: HomeView) => {
    const s = v.settings;
    const sections = groups(v.items, v.categories);
    const used = new Set(v.items.flatMap((i) => parseAllergens(i.allergens)));
    const dish = async (i: Item) => {
      const out = isSoldOut(i);
      const marks = parseAllergens(i.allergens).map(allergenNumber);
      return html`<li class="${out ? "out" : ""}">
        <div class="row">
          <span class="name">${i.name}${marks.length
              ? html`<sup class="al" title="Alergeny: ${parseAllergens(i.allergens)
                    .map((id) => ALLERGENS.find((a) => a.id === id)!.label)
                    .join(", ")}">${marks.join(",")}</sup>`
              : ""}</span>
          <span class="dots" aria-hidden="true"></span>
          ${out ? html`<span class="soldout">Brak dziś</span>` : html`<span class="price">${zl(i.price)}</span>`}
        </div>
        ${i.description ? html`<p class="desc">${i.description}</p>` : ""}
        ${await v.slot("item.after", { item: i })}
      </li>`;
    };
    return html`<!doctype html>
      <html lang="pl">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <meta name="theme-color" content="${s.accent}" />
          ${v.seo}
          <style>
            :root{--accent:${s.accent};--ink:#1d1b18;--muted:#6b665e;--line:#ece7df;--bg:#fbf8f3}
            *{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:3.5rem}
            body{margin:0;font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
            .wrap{max-width:40rem;margin:0 auto;padding:0 1rem}
            header{padding:1.5rem 0 1rem;text-align:center}.logo{max-height:64px;max-width:12rem}
            h1{margin:.3rem 0 .2rem;font-size:1.75rem;letter-spacing:-.01em}.tag{margin:0;color:var(--muted)}
            nav{position:sticky;top:0;z-index:1;background:var(--bg);border-bottom:1px solid var(--line)}
            nav .wrap{display:flex;gap:.4rem;overflow-x:auto;padding:.6rem 1rem;scrollbar-width:none}
            nav a{flex:none;padding:.35rem .8rem;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--ink);text-decoration:none;font-size:.95rem}
            h2{font-size:1.2rem;margin:1.75rem 0 .25rem;color:var(--accent);text-transform:uppercase;letter-spacing:.05em}
            ul{list-style:none;margin:0;padding:0}li{padding:.75rem 0;border-bottom:1px dashed var(--line)}
            .row{display:flex;align-items:baseline;gap:.5rem}.name{font-weight:600}
            .dots{flex:1;border-bottom:1px dotted #cfc7ba;min-width:1rem;transform:translateY(-.3em)}
            .price{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
            .al{color:var(--muted);font-weight:500;font-size:.7rem;margin-left:.2rem}
            .desc{margin:.2rem 0 0;color:var(--muted);font-size:.93rem}
            li.out .name,li.out .desc{color:#a59f95}li.out .name{text-decoration:line-through}
            .soldout{font-size:.8rem;font-weight:700;color:#a3271a;background:#fdecea;border-radius:999px;padding:.1rem .55rem;white-space:nowrap}
            .legend{margin:2rem 0 0;font-size:.85rem;color:var(--muted)}.legend b{color:var(--ink)}
            footer{margin-top:2rem;padding:1.25rem 0 2rem;border-top:1px solid var(--line);font-size:.95rem}
            footer p{margin:.25rem 0}a{color:var(--accent)}
          </style>
          ${await v.slot("head", {})}
        </head>
        <body>
          <header><div class="wrap">
            ${s.logoKey ? html`<img class="logo" src="${v.mediaUrl(s.logoKey, 320)}" alt="${v.tenant.name}" />` : ""}
            <h1>${v.tenant.name}</h1>
            ${s.tagline ? html`<p class="tag">${s.tagline}</p>` : ""}
          </div></header>
          ${sections.length > 1
            ? html`<nav aria-label="Kategorie menu"><div class="wrap">
                ${sections.map((g) => html`<a href="#${g.id}">${g.title}</a>`)}
              </div></nav>`
            : ""}
          <main class="wrap">
            ${await v.slot("home.top", {})}
            ${sections.length
              ? sections.map(
                  (g) => html`<section id="${g.id}">
                    ${g.title ? html`<h2>${g.title}</h2>` : ""}
                    <ul>${g.items.map(dish)}</ul>
                  </section>`,
                )
              : html`<p class="tag">Menu wkrótce.</p>`}
            ${used.size
              ? html`<p class="legend"><b>Alergeny:</b> ${ALLERGENS.filter((a) => used.has(a.id)).map(
                  (a, n, list) => html`${allergenNumber(a.id)} ${a.label.toLowerCase()}${n < list.length - 1 ? ", " : ""}`,
                )}. Zapytaj obsługę o szczegóły.</p>`
              : ""}
            ${await v.slot("home.bottom", {})}
          </main>
          <footer><div class="wrap">
            ${s.hours ? html`<p>Otwarte: ${s.hours}</p>` : ""}
            ${s.address ? html`<p><a href="${mapsUrl(s.address)}" rel="noopener" target="_blank">${s.address}</a></p>` : ""}
            ${s.phone ? html`<p><a href="${telHref(s.phone)}">${s.phone}</a></p>` : ""}
            ${await v.slot("footer", {})}
          </div></footer>
        </body>
      </html>`;
  },
});
