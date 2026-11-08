import { html } from "hono/html";
import { defineTheme, type Category, type HomeView, type Item } from "../../core";

const zl = (grosze: number) => (grosze / 100).toLocaleString("pl-PL", { style: "currency", currency: "PLN" });

function groups(items: Item[], categories: Category[]): { title: string; items: Item[] }[] {
  const out = categories
    .map((c) => ({ title: c.name, items: items.filter((i) => i.category_id === c.id) }))
    .filter((g) => g.items.length);
  const rest = items.filter((i) => !i.category_id || !categories.some((c) => c.id === i.category_id));
  if (rest.length) out.push({ title: out.length ? "Pozostałe" : "", items: rest });
  return out;
}

/** Default theme: one light page for every site kind. Zero JavaScript. */
export default defineTheme({
  id: "simple",
  name: "Prosty",
  kinds: ["business-card", "qr-menu", "shop"],
  home: async (v: HomeView) => {
    const s = v.settings;
    return html`<!doctype html>
      <html lang="pl">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>${v.tenant.name}</title>
          ${s.tagline ? html`<meta name="description" content="${s.tagline}" />` : ""}
          <style>
            :root{--accent:${s.accent}}
            *{box-sizing:border-box}body{margin:0;font:17px/1.55 system-ui,sans-serif;color:#1b1b1b;background:#fff}
            header,main,footer{max-width:46rem;margin:0 auto;padding:1.25rem}
            header{border-bottom:3px solid var(--accent)}h1{margin:.2rem 0;font-size:1.8rem}
            .tag{color:#555;margin:0}.logo{max-height:56px}
            h2{font-size:1.15rem;margin:1.8rem 0 .6rem;color:var(--accent)}
            ul{list-style:none;margin:0;padding:0}li{padding:.7rem 0;border-bottom:1px solid #eee}
            .row{display:flex;justify-content:space-between;gap:1rem}.price{font-weight:600;white-space:nowrap}
            .desc{color:#555;font-size:.95rem;margin:.2rem 0 0}
            footer{color:#444;font-size:.95rem;border-top:1px solid #eee}footer p{margin:.3rem 0}
            a{color:var(--accent)}
          </style>
          ${await v.slot("head", {})}
        </head>
        <body>
          <header>
            ${s.logoKey ? html`<img class="logo" src="${v.mediaUrl(s.logoKey)}" alt="${v.tenant.name}" />` : ""}
            <h1>${v.tenant.name}</h1>
            ${s.tagline ? html`<p class="tag">${s.tagline}</p>` : ""}
          </header>
          <main>
            ${await v.slot("home.top", {})}
            ${groups(v.items, v.categories).map(
              (g) => html`${g.title ? html`<h2>${g.title}</h2>` : ""}
                <ul>
                  ${g.items.map(
                    async (i) => html`<li>
                      <div class="row"><span>${i.name}</span><span class="price">${zl(i.price)}</span></div>
                      ${i.description ? html`<p class="desc">${i.description}</p>` : ""}
                      ${await v.slot("item.after", { item: i })}
                    </li>`,
                  )}
                </ul>`,
            )}
            ${await v.slot("home.bottom", {})}
          </main>
          <footer>
            ${s.hours ? html`<p>${s.hours}</p>` : ""}
            ${s.address ? html`<p>${s.address}</p>` : ""}
            ${s.phone ? html`<p><a href="tel:${s.phone.replace(/[^\d+]/g, "")}">${s.phone}</a></p>` : ""}
            ${s.email ? html`<p><a href="mailto:${s.email}">${s.email}</a></p>` : ""}
            ${await v.slot("footer", {})}
          </footer>
        </body>
      </html>`;
  },
});
