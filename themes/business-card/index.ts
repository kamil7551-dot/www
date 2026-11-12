import { html } from "hono/html";
import { defineTheme, type HomeView } from "../../core";
import { contactForm, groups, itemImage, mapsUrl, telHref, zl } from "../shared";

/** Business card: one page with hero, offer, contact details and a contact form. Zero JavaScript. */
export default defineTheme({
  id: "business-card",
  name: "Wizytówka",
  kinds: ["business-card"],
  home: async (v: HomeView) => {
    const s = v.settings;
    const sections = groups(v.items, v.categories);
    return html`<!doctype html>
      <html lang="pl">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          ${v.seo}
          <style>
            :root{--accent:${s.accent};--ink:#16181d;--muted:#5b6170;--line:#e6e8ec;--bg:#fff;--soft:#f6f7f9}
            *{box-sizing:border-box}html{scroll-behavior:smooth}
            body{margin:0;font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
            a{color:var(--accent)}.wrap{max-width:62rem;margin:0 auto;padding:0 1.25rem}
            .hero{padding:3.5rem 0 3rem;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 10%,#fff),#fff)}
            .logo{max-height:64px;max-width:14rem;display:block;margin-bottom:1rem}
            h1{font-size:clamp(2rem,5vw,3rem);line-height:1.1;margin:0 0 .6rem;letter-spacing:-.02em}
            .tag{font-size:1.2rem;color:var(--muted);margin:0 0 1.5rem;max-width:40rem}
            .cta{display:flex;gap:.6rem;flex-wrap:wrap}
            .btn{display:inline-block;padding:.75rem 1.2rem;border-radius:10px;font-weight:600;text-decoration:none;border:2px solid var(--accent)}
            .btn.main{background:var(--accent);color:#fff}.btn.alt{color:var(--accent);background:#fff}
            section{padding:2.5rem 0}h2{font-size:1.6rem;margin:0 0 1.25rem;letter-spacing:-.01em}
            h3{font-size:1.05rem;margin:1.5rem 0 .75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
            .cards{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))}
            .card{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
            .card .pic{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
            .card .body{padding:1rem 1.1rem 1.1rem;display:flex;flex-direction:column;gap:.35rem;flex:1}
            .card .name{font-weight:700}.card .desc{color:var(--muted);font-size:.95rem;margin:0;flex:1}
            .card .price{font-weight:700;color:var(--accent)}
            .contact-grid{display:grid;gap:2rem}@media(min-width:48rem){.contact-grid{grid-template-columns:1fr 1.2fr}}
            .about p{max-width:42rem;white-space:pre-line}.info p{margin:.2rem 0 1rem}.info strong{display:block;font-size:.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
            .contact{display:grid;gap:.8rem}.contact label{display:grid;gap:.3rem;font-weight:600;font-size:.9rem}
            .contact input,.contact textarea{font:inherit;padding:.7rem .8rem;border:1px solid var(--line);border-radius:10px;width:100%}
            .contact input:focus,.contact textarea:focus{outline:2px solid var(--accent);border-color:var(--accent)}
            .contact button{font:inherit;font-weight:700;padding:.85rem;border:0;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer}
            .trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
            .flash{padding:.8rem 1rem;border-radius:10px;font-weight:600}.flash.ok{background:#e6f6ec;color:#11683a}
            .flash.err{background:#fdecea;color:#a3271a}
            footer{border-top:1px solid var(--line);color:var(--muted);font-size:.9rem;padding:1.5rem 0}
          </style>
          ${await v.slot("head", {})}
        </head>
        <body>
          <header class="hero">
            <div class="wrap">
              ${s.logoKey ? html`<img class="logo" src="${v.mediaUrl(s.logoKey, 320)}" alt="${v.tenant.name}" />` : ""}
              <h1>${v.tenant.name}</h1>
              ${s.tagline ? html`<p class="tag">${s.tagline}</p>` : ""}
              <div class="cta">
                ${s.phone ? html`<a class="btn main" href="${telHref(s.phone)}">Zadzwoń: ${s.phone}</a>` : ""}
                <a class="btn ${s.phone ? "alt" : "main"}" href="#kontakt">Napisz do nas</a>
              </div>
            </div>
          </header>
          <main>
            ${await v.slot("home.top", {})}
            ${s.about
              ? html`<section id="o-nas"><div class="wrap about">
                  <h2>O nas</h2>
                  ${s.about.split(/\n\s*\n/).map((p) => html`<p>${p}</p>`)}
                </div></section>`
              : ""}
            ${sections.length
              ? html`<section id="oferta"><div class="wrap">
                  <h2>Oferta</h2>
                  ${sections.map(
                    (g) => html`${g.title ? html`<h3>${g.title}</h3>` : ""}
                      <div class="cards">
                        ${g.items.map(
                          async (i) => html`<article class="card">
                            ${itemImage(v, i, "(max-width: 40rem) 100vw, 20rem")}
                            <div class="body">
                              <div class="name">${i.name}</div>
                              ${i.description ? html`<p class="desc">${i.description}</p>` : ""}
                              <div class="price">${zl(i.price)}</div>
                              ${await v.slot("item.after", { item: i })}
                            </div>
                          </article>`,
                        )}
                      </div>`,
                  )}
                </div></section>`
              : ""}
            ${await v.slot("home.bottom", {})}
            <section id="kontakt"><div class="wrap">
              <h2>Kontakt</h2>
              <div class="contact-grid">
                <div class="info">
                  ${s.phone ? html`<p><strong>Telefon</strong><a href="${telHref(s.phone)}">${s.phone}</a></p>` : ""}
                  ${s.email ? html`<p><strong>E-mail</strong><a href="mailto:${s.email}">${s.email}</a></p>` : ""}
                  ${s.address
                    ? html`<p><strong>Adres</strong>${s.address}<br /><a href="${mapsUrl(s.address)}" rel="noopener" target="_blank">Pokaż na mapie</a></p>`
                    : ""}
                  ${s.hours ? html`<p><strong>Godziny otwarcia</strong>${s.hours}</p>` : ""}
                </div>
                <div>${contactForm(v)}</div>
              </div>
            </div></section>
          </main>
          <footer><div class="wrap">© ${v.tenant.name} ${await v.slot("footer", {})}</div></footer>
        </body>
      </html>`;
  },
});
