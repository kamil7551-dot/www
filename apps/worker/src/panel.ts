import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { RESERVED_SLUGS, auth, forTenant, newId, slugify, ValidationError, type Mailer, type Platform } from "../../../core";
import { page, parsePrice, zl } from "./layout";

export const SESSION_COOKIE = "__Host-sid";

type PanelEnv = { Bindings: Env; Variables: { user: auth.SessionUser } };

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

export function panelApp(platform: Platform, mailer: (env: Env) => Mailer) {
  const app = new Hono<PanelEnv>();

  app.use("*", async (c, next) => {
    // Cross-site form posts are refused: a POST must come from the panel's own pages.
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("origin") !== new URL(c.req.url).origin) {
      return c.text("Niedozwolone żądanie", 403);
    }
    await next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
  });

  app.get("/login", (c) =>
    c.html(
      page(
        "Logowanie",
        html`<h1>Zaloguj się</h1>
          <form method="post" action="/login">
            <p><label>E-mail <input type="email" name="email" required autocomplete="email" /></label></p>
            <button>Wyślij link do logowania</button>
          </form>`,
      ),
    ),
  );

  app.post("/login", async (c) => {
    const form = await c.req.parseBody();
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const result = await auth.requestLogin(c.env.DB, String(form.email ?? ""), ip);
    if (result.ok) {
      const link = `${new URL(c.req.url).origin}/login/verify?t=${result.token}`;
      try {
        await mailer(c.env).send({
          to: result.email,
          subject: "Twój link do logowania",
          text: `Kliknij, aby się zalogować (link działa 15 minut i tylko raz):\n\n${link}\n\nJeśli to nie Ty, zignoruj tę wiadomość.`,
        });
      } catch (error) {
        console.error("Login mail failed", error);
      }
    }
    // Same answer whatever happened, so nobody can learn which e-mails have accounts.
    return c.html(
      page(
        "Sprawdź skrzynkę",
        html`<h1>Sprawdź skrzynkę</h1>
          <p>Jeśli adres jest poprawny, za chwilę dostaniesz link do logowania. Działa 15 minut.</p>`,
      ),
    );
  });

  // Mail scanners open links automatically, so opening the link only shows a button; the POST logs in.
  app.get("/login/verify", (c) =>
    c.html(
      page(
        "Potwierdź logowanie",
        html`<h1>Potwierdź logowanie</h1>
          <form method="post" action="/login/verify">
            <input type="hidden" name="t" value="${c.req.query("t") ?? ""}" />
            <button>Zaloguj mnie</button>
          </form>`,
      ),
    ),
  );

  app.post("/login/verify", async (c) => {
    const form = await c.req.parseBody();
    const session = await auth.consumeLogin(c.env.DB, String(form.t ?? ""), c.req.header("user-agent") ?? "");
    if (!session) {
      return c.html(
        page("Link nieważny", html`<h1>Link wygasł albo był już użyty</h1><p><a href="/login">Wyślij nowy link</a></p>`),
        400,
      );
    }
    setCookie(c, SESSION_COOKIE, session.sessionToken, {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      maxAge: auth.SESSION_IDLE_TTL,
    });
    return c.redirect("/", 303);
  });

  app.post("/logout", async (c) => {
    await auth.destroySession(c.env.DB, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
    return c.redirect("/login", 303);
  });

  // Everything below needs a logged-in user.
  app.use("*", async (c, next) => {
    const user = await auth.getSession(c.env.DB, getCookie(c, SESSION_COOKIE));
    if (!user) return c.redirect("/login", 303);
    c.set("user", user);
    await next();
  });

  app.get("/", async (c) => {
    const sites = await auth.sitesOf(c.env.DB, c.get("user").userId);
    return c.html(
      page(
        "Panel",
        html`<h1>Twoje strony</h1>
          <ul>
            ${sites.map((s) => html`<li><a href="/sites/${s.id}">${s.name}</a> <span class="muted">${s.slug}</span></li>`)}
          </ul>
          <h2>Nowa strona</h2>
          <form method="post" action="/sites" class="row">
            <input name="name" placeholder="Nazwa" required maxlength="80" />
            <select name="kind">
              <option value="shop">Sklep</option>
              <option value="business-card">Wizytówka</option>
              <option value="qr-menu">Menu QR</option>
            </select>
            <button>Utwórz</button>
          </form>
          <form method="post" action="/logout"><button>Wyloguj</button></form>`,
      ),
    );
  });

  app.post("/sites", async (c) => {
    const form = await c.req.parseBody();
    const name = String(form.name ?? "").trim().slice(0, 80);
    const kind = String(form.kind ?? "");
    if (!name || !["shop", "business-card", "qr-menu"].includes(kind)) return c.text("Niepoprawne dane", 400);
    let slug = slugify(name) || "strona";
    if (RESERVED_SLUGS.has(slug)) slug = `${slug}-1`;
    const taken = await c.env.DB.prepare("SELECT 1 FROM tenants WHERE slug = ?1").bind(slug).first();
    if (taken) slug = `${slug}-${crypto.randomUUID().slice(0, 4)}`;
    const id = newId();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO tenants (id, slug, name, kind) VALUES (?1, ?2, ?3, ?4)").bind(id, slug, name, kind),
      c.env.DB.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?1, ?2, 'owner')").bind(
        c.get("user").userId,
        id,
      ),
    ]);
    return c.redirect(`/sites/${id}`, 303);
  });

  /** Returns the site's core API only if the logged-in user is a member; otherwise null. */
  async function siteFor(c: Context<PanelEnv>) {
    const tenantId = c.req.param("site") ?? "";
    const role = await auth.membership(c.env.DB, c.get("user").userId, tenantId);
    return role ? { tenantId, ...forTenant(platform, c.env.DB, tenantId) } : null;
  }

  app.get("/sites/:site", async (c) => {
    const site = await siteFor(c);
    if (!site) return c.text("Nie znaleziono", 404);
    const items = await site.catalog.listItems();
    return c.html(
      page(
        "Pozycje",
        html`<p><a href="/">← Twoje strony</a></p>
          <h1>Pozycje</h1>
          <ul>
            ${items.map(
              (i) => html`<li class="row">
                ${i.name} <strong>${zl(i.price)}</strong> <span class="muted">${i.status}</span>
                <form method="post" action="/sites/${site.tenantId}/items/${i.id}/delete"><button>Usuń</button></form>
              </li>`,
            )}
          </ul>
          <h2>Dodaj</h2>
          <form method="post" action="/sites/${site.tenantId}/items" class="row">
            <input name="name" placeholder="Nazwa" required maxlength="120" />
            <input name="price" placeholder="Cena, np. 29,99" required inputmode="decimal" />
            <select name="kind">
              <option value="product">Produkt</option>
              <option value="service">Usługa</option>
              <option value="dish">Danie</option>
            </select>
            <button>Dodaj</button>
          </form>`,
      ),
    );
  });

  app.post("/sites/:site/items", async (c) => {
    const site = await siteFor(c);
    if (!site) return c.text("Nie znaleziono", 404);
    const form = await c.req.parseBody();
    const price = parsePrice(String(form.price ?? ""));
    if (price === null) return c.text("Niepoprawna cena", 400);
    try {
      await site.catalog.createItem({
        kind: String(form.kind) as "product",
        name: String(form.name ?? "").slice(0, 120),
        price,
      });
    } catch (error) {
      if (error instanceof ValidationError) return c.text(error.message, 400);
      throw error;
    }
    return c.redirect(`/sites/${site.tenantId}`, 303);
  });

  app.post("/sites/:site/items/:item/delete", async (c) => {
    const site = await siteFor(c);
    if (!site) return c.text("Nie znaleziono", 404);
    await site.catalog.deleteItem(c.req.param("item"));
    return c.redirect(`/sites/${site.tenantId}`, 303);
  });

  return app;
}
