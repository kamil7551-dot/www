import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

type Html = HtmlEscapedString | Promise<HtmlEscapedString> | string;

/** Panel stylesheet, served from /assets/panel.css so the CSP can forbid inline styles. No JavaScript anywhere. */
export const PANEL_CSS = `
:root{--bg:#f5f6f8;--card:#fff;--text:#16181d;--muted:#5f6573;--line:#e3e6eb;--accent:#2f6fed;--accent-ink:#fff;
--accent-soft:#e8efff;--ok:#127a3d;--ok-soft:#e5f5ec;--warn:#8a5a00;--warn-soft:#fff3d6;--danger:#b42318;--danger-soft:#fdecea;
--radius:12px;--shadow:0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06)}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a20;--text:#eef0f4;--muted:#9aa1ae;--line:#2a2f38;
--accent:#6b9bff;--accent-ink:#0b1020;--accent-soft:#1c2740;--ok:#5fd18f;--ok-soft:#14281d;--warn:#f1c35b;--warn-soft:#2b2410;
--danger:#ff8a80;--danger-soft:#2e1614;--shadow:none}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:1.5rem;line-height:1.25;margin:0}h2{font-size:1.05rem;margin:0 0 .75rem}
.top{background:var(--card);border-bottom:1px solid var(--line)}
.top-in{max-width:60rem;margin:0 auto;padding:.75rem 1rem;display:flex;align-items:center;gap:1rem}
.brand{font-weight:700;font-size:1.05rem;color:var(--text);letter-spacing:-.01em}
.brand:hover{text-decoration:none}.spacer{flex:1}
.who{color:var(--muted);font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:14rem}
.wrap{max-width:60rem;margin:0 auto;padding:1.25rem 1rem 3rem}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin:.25rem 0 1rem}
.crumb{color:var(--muted);font-size:.875rem;margin-bottom:.25rem;display:block}
.tabs{display:flex;gap:.25rem;border-bottom:1px solid var(--line);margin:0 0 1.25rem;overflow-x:auto}
.tabs a{padding:.6rem .85rem;color:var(--muted);border-bottom:2px solid transparent;white-space:nowrap;font-weight:500}
.tabs a:hover{color:var(--text);text-decoration:none}
.tabs a[aria-current=page]{color:var(--text);border-color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:1.25rem;margin-bottom:1rem}
.list{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:1rem;overflow:hidden}
.list>a,.list>div{display:flex;align-items:center;gap:.85rem;padding:.8rem 1rem;border-top:1px solid var(--line);color:var(--text)}
.rowlink{display:flex;align-items:center;gap:.85rem;flex:1;min-width:0;color:inherit}.rowlink:hover{text-decoration:none}.rowlink:hover .name{color:var(--accent)}
.checks{border:0;padding:0;display:grid;gap:.35rem .75rem;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))}
.checks legend{font-weight:600;font-size:.875rem;margin-bottom:.35rem;padding:0}.checks label{display:flex;gap:.45rem;align-items:center}
.checks input{width:1.1rem;min-height:1.1rem;margin:0}.checks .hint{grid-column:1/-1}
.list>:first-child{border-top:0}.list>a:hover{background:var(--accent-soft);text-decoration:none}
.grow{flex:1;min-width:0}.name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub{color:var(--muted);font-size:.85rem}.price{font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.thumb{width:44px;height:44px;border-radius:8px;object-fit:cover;background:var(--bg);border:1px solid var(--line);flex:none}
.thumb.none{display:grid;place-items:center;color:var(--muted);font-size:1.1rem}
.pill{display:inline-block;vertical-align:1px;margin-left:.35rem;padding:.1rem .5rem;border-radius:999px;font-size:.75rem;font-weight:600}
.pill.active{background:var(--ok-soft);color:var(--ok)}.pill.hidden{background:var(--line);color:var(--muted)}
.pill.draft{background:var(--warn-soft);color:var(--warn)}
.grid{display:grid;gap:1rem}@media(min-width:44rem){.grid.two{grid-template-columns:1fr 1fr}}
.field{display:block;margin-bottom:1rem}.field>span:not(.hint){display:block;font-weight:600;font-size:.875rem;margin-bottom:.35rem}
.hint{display:block;color:var(--muted);font-size:.8rem;margin-top:.3rem}
input,select,textarea{width:100%;font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.6rem .7rem;min-height:2.6rem}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:var(--accent)}
input[type=color]{padding:.2rem;width:4rem}input[type=file]{padding:.45rem}
textarea{min-height:6rem;resize:vertical}
.inline{display:flex;gap:.5rem;flex-wrap:wrap}.inline>input,.inline>select{flex:1 1 10rem;width:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;font:inherit;font-weight:600;border-radius:8px;
padding:.6rem 1rem;min-height:2.6rem;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer;white-space:nowrap}
.btn:hover{text-decoration:none;border-color:var(--muted)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}.btn.primary:hover{filter:brightness(1.07)}
.btn.danger{color:var(--danger);border-color:transparent;background:transparent}.btn.danger:hover{background:var(--danger-soft)}
.btn.small{padding:.35rem .7rem;min-height:2rem;font-size:.85rem}.btn.block{width:100%}
.actions{display:flex;gap:.5rem;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-top:.5rem}
.note{border-radius:8px;padding:.7rem .9rem;margin-bottom:1rem;font-weight:500}
.note.ok{background:var(--ok-soft);color:var(--ok)}.note.err{background:var(--danger-soft);color:var(--danger)}
.empty{text-align:center;color:var(--muted);padding:2rem 1rem}
.count{display:inline-block;min-width:1.25rem;padding:0 .35rem;border-radius:999px;background:var(--accent);color:var(--accent-ink);font-size:.75rem;text-align:center}
.msg{display:block!important}.msg.new{background:var(--accent-soft)}.msg p{margin:.5rem 0 .25rem;white-space:pre-wrap;overflow-wrap:anywhere}
.auth{min-height:100vh;display:grid;place-items:center;padding:1rem}
.auth .card{width:100%;max-width:24rem;padding:1.75rem}
.auth h1{margin-bottom:.5rem}.auth p{color:var(--muted);margin:0 0 1.25rem}
.kinds{display:grid;gap:.5rem;grid-template-columns:repeat(3,1fr);margin-bottom:1rem}
.kinds label{display:block;border:1px solid var(--line);border-radius:10px;padding:.7rem;cursor:pointer;text-align:center;font-weight:600;font-size:.9rem}
.kinds input{position:absolute;opacity:0;width:1px;height:1px}
.kinds label:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.kinds small{display:block;font-weight:400;color:var(--muted);font-size:.75rem}
.logo{max-height:48px;max-width:12rem;display:block;margin-bottom:.5rem}
@media(max-width:30rem){.who{display:none}.kinds{grid-template-columns:1fr}}
`;

/** Bump when PANEL_CSS changes, so browsers fetch the new file. */
export const PANEL_CSS_VERSION = "5";

const head = (title: string) => html`<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title} · Panel</title>
  <link rel="stylesheet" href="/assets/panel.css?v=${PANEL_CSS_VERSION}" />`;

/** Centered single card: login and other screens before signing in. */
export const authPage = (title: string, body: Html) =>
  html`<!doctype html>
    <html lang="pl">
      <head>
        ${head(title)}
      </head>
      <body>
        <main class="auth"><div class="card">${body}</div></main>
      </body>
    </html>`;

export interface SiteNav {
  id: string;
  name: string;
  publicUrl: string;
  isOwner: boolean;
  active: "items" | "categories" | "messages" | "settings";
  /** Unread contact form messages, shown as a badge on the tab. */
  unread: number;
}

/** Signed-in layout: top bar, optional site tabs, content. */
export function panelPage(opts: { title: string; email: string; site?: SiteNav; notice?: Html; body: Html }) {
  const s = opts.site;
  const tab = (key: SiteNav["active"], href: string, label: string | Html) =>
    html`<a href="${href}" ${s?.active === key ? raw('aria-current="page"') : ""}>${label}</a>`;
  return html`<!doctype html>
    <html lang="pl">
      <head>
        ${head(opts.title)}
      </head>
      <body>
        <header class="top">
          <div class="top-in">
            <a class="brand" href="/">Panel</a>
            <span class="spacer"></span>
            <span class="who">${opts.email}</span>
            <form method="post" action="/logout"><button class="btn small">Wyloguj</button></form>
          </div>
        </header>
        <main class="wrap">
          ${s
            ? html`<div class="head">
                  <div><a class="crumb" href="/">← Twoje strony</a><h1>${s.name}</h1></div>
                  <a class="btn small" href="${s.publicUrl}" target="_blank" rel="noopener">Zobacz stronę ↗</a>
                </div>
                <nav class="tabs">
                  ${tab("items", `/sites/${s.id}`, "Pozycje")} ${tab("categories", `/sites/${s.id}/categories`, "Kategorie")}
                  ${tab("messages", `/sites/${s.id}/messages`, html`Wiadomości${s.unread ? html` <span class="count">${s.unread}</span>` : ""}`)}
                  ${s.isOwner ? tab("settings", `/sites/${s.id}/settings`, "Ustawienia") : ""}
                </nav>`
            : ""}
          ${opts.notice ?? ""} ${opts.body}
        </main>
      </body>
    </html>`;
}

export const notice = (kind: "ok" | "err", text: string) => html`<div class="note ${kind}" role="status">${text}</div>`;
