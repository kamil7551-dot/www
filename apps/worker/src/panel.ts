import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import {
  Media,
  MediaError,
  RESERVED_SLUGS,
  ValidationError,
  auth,
  forTenant,
  newId,
  slugify,
  type ItemKind,
  type ItemStatus,
  type Mailer,
  type Platform,
  type SiteSettings,
} from "../../../core";
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
    if (!role) return null;
    return { tenantId, role, media: new Media(c.env.MEDIA, tenantId, c.env.IMAGES), ...forTenant(platform, c.env.DB, tenantId) };
  }

  const notFound = (c: Context<PanelEnv>) => c.text("Nie znaleziono", 404);
  const bad = (c: Context<PanelEnv>, message: string) =>
    c.html(page("Błąd", html`<h1>Coś się nie zgadza</h1><p>${message}</p><p><a href="/">Wróć do panelu</a></p>`), 400);

  /** Stores an uploaded image if the form has one. Returns the new key, undefined when no file was sent. */
  async function upload(media: Media, file: unknown): Promise<string | undefined> {
    if (!(file instanceof File) || file.size === 0) return undefined;
    return media.putImage(await file.arrayBuffer(), file.type);
  }

  const STATUS_LABEL: Record<ItemStatus, string> = { active: "widoczna", hidden: "ukryta", draft: "szkic" };

  app.get("/sites/:site", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const [items, categories] = await Promise.all([site.catalog.listItems(), site.catalog.listCategories()]);
    const catName = new Map(categories.map((x) => [x.id, x.name]));
    return c.html(
      page(
        "Pozycje",
        html`<p><a href="/">← Twoje strony</a>${site.role === "owner" ? html` · <a href="/sites/${site.tenantId}/settings">Ustawienia strony</a>` : ""}</p>
          <h1>Pozycje</h1>
          <ul>
            ${items.map(
              (i) => html`<li class="row">
                <a href="/sites/${site.tenantId}/items/${i.id}">${i.name}</a> <strong>${zl(i.price)}</strong>
                <span class="muted">${STATUS_LABEL[i.status]}${i.category_id ? html` · ${catName.get(i.category_id) ?? ""}` : ""}</span>
                <form method="post" action="/sites/${site.tenantId}/items/${i.id}/delete"><button>Usuń</button></form>
              </li>`,
            )}
          </ul>
          <h2>Dodaj pozycję</h2>
          <form method="post" action="/sites/${site.tenantId}/items" class="row">
            <input name="name" placeholder="Nazwa" required maxlength="120" />
            <input name="price" placeholder="Cena, np. 29,99" required inputmode="decimal" />
            <select name="kind">
              <option value="product">Produkt</option>
              <option value="service">Usługa</option>
              <option value="dish">Danie</option>
            </select>
            <button>Dodaj</button>
          </form>
          <h2>Kategorie</h2>
          <ul>
            ${categories.map((x) => html`<li>${x.name}</li>`)}
          </ul>
          <form method="post" action="/sites/${site.tenantId}/categories" class="row">
            <input name="name" placeholder="Nowa kategoria" required maxlength="80" />
            <button>Dodaj kategorię</button>
          </form>`,
      ),
    );
  });

  app.post("/sites/:site/items", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const form = await c.req.parseBody();
    const price = parsePrice(String(form.price ?? ""));
    if (price === null) return bad(c, "Niepoprawna cena. Wpisz np. 29,99.");
    try {
      const item = await site.catalog.createItem({
        kind: String(form.kind) as ItemKind,
        name: String(form.name ?? "").slice(0, 120),
        price,
      });
      return c.redirect(`/sites/${site.tenantId}/items/${item.id}`, 303);
    } catch (error) {
      if (error instanceof ValidationError) return bad(c, error.message);
      throw error;
    }
  });

  app.get("/sites/:site/items/:item", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const [item, categories] = await Promise.all([site.catalog.getItem(c.req.param("item")), site.catalog.listCategories()]);
    if (!item) return notFound(c);
    return c.html(
      page(
        item.name,
        html`<p><a href="/sites/${site.tenantId}">← Pozycje</a></p>
          <h1>${item.name}</h1>
          <form method="post" action="/sites/${site.tenantId}/items/${item.id}" enctype="multipart/form-data">
            <p><label>Nazwa<br /><input name="name" value="${item.name}" required maxlength="120" /></label></p>
            <p><label>Cena<br /><input name="price" value="${(item.price / 100).toFixed(2).replace(".", ",")}" required inputmode="decimal" /></label></p>
            <p><label>Opis<br /><textarea name="description" rows="4" cols="50" maxlength="2000">${item.description}</textarea></label></p>
            <p>
              <label>Kategoria<br />
                <select name="categoryId">
                  <option value="">brak</option>
                  ${categories.map((x) => html`<option value="${x.id}" ${x.id === item.category_id ? "selected" : ""}>${x.name}</option>`)}
                </select>
              </label>
            </p>
            <p>
              <label>Status<br />
                <select name="status">
                  ${(Object.keys(STATUS_LABEL) as ItemStatus[]).map(
                    (s) => html`<option value="${s}" ${s === item.status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`,
                  )}
                </select>
              </label>
            </p>
            <p>
              <label>Zdjęcie (JPG, PNG, WebP, AVIF, do 5 MB)<br /><input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif" /></label>
              ${item.image_key ? html`<br /><span class="muted">Zdjęcie jest dodane. Nowy plik je zastąpi.</span>` : ""}
            </p>
            <button>Zapisz</button>
          </form>`,
      ),
    );
  });

  app.post("/sites/:site/items/:item", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const current = await site.catalog.getItem(c.req.param("item"));
    if (!current) return notFound(c);
    const form = await c.req.parseBody();
    const price = parsePrice(String(form.price ?? ""));
    if (price === null) return bad(c, "Niepoprawna cena. Wpisz np. 29,99.");
    const categoryId = String(form.categoryId ?? "");
    if (categoryId && !(await site.catalog.listCategories()).some((x) => x.id === categoryId)) {
      return bad(c, "Nieznana kategoria.");
    }
    try {
      const imageKey = await upload(site.media, form.image);
      await site.catalog.updateItem(current.id, {
        name: String(form.name ?? "").slice(0, 120),
        description: String(form.description ?? "").slice(0, 2000),
        price,
        categoryId: categoryId || null,
        status: String(form.status) as ItemStatus,
        ...(imageKey ? { imageKey } : {}),
      });
      if (imageKey && current.image_key) await site.media.delete(current.image_key);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof MediaError) return bad(c, error.message);
      throw error;
    }
    return c.redirect(`/sites/${site.tenantId}`, 303);
  });

  app.post("/sites/:site/items/:item/delete", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const item = await site.catalog.getItem(c.req.param("item"));
    if (item && (await site.catalog.deleteItem(item.id)) && item.image_key) await site.media.delete(item.image_key);
    return c.redirect(`/sites/${site.tenantId}`, 303);
  });

  app.post("/sites/:site/categories", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const form = await c.req.parseBody();
    try {
      await site.catalog.createCategory({ name: String(form.name ?? "").slice(0, 80) });
    } catch (error) {
      if (error instanceof ValidationError) return bad(c, error.message);
      if (String(error).includes("UNIQUE")) return bad(c, "Taka kategoria już jest.");
      throw error;
    }
    return c.redirect(`/sites/${site.tenantId}`, 303);
  });

  // Site settings: owners only.
  app.get("/sites/:site/settings", async (c) => {
    const site = await siteFor(c);
    if (!site || site.role !== "owner") return notFound(c);
    const s = await site.settings.get();
    const field = (name: keyof SiteSettings, label: string, type = "text") =>
      html`<p><label>${label}<br /><input type="${type}" name="${name}" value="${String(s[name] ?? "")}" /></label></p>`;
    return c.html(
      page(
        "Ustawienia",
        html`<p><a href="/sites/${site.tenantId}">← Pozycje</a></p>
          <h1>Ustawienia strony</h1>
          <form method="post" action="/sites/${site.tenantId}/settings" enctype="multipart/form-data">
            ${field("tagline", "Krótki opis")} ${field("email", "E-mail kontaktowy", "email")} ${field("phone", "Telefon", "tel")}
            ${field("address", "Adres")} ${field("hours", "Godziny otwarcia")} ${field("accent", "Kolor przewodni", "color")}
            <p>
              <label>Szablon<br />
                <select name="theme">
                  ${platform.themes.list().map((t) => html`<option value="${t.id}" ${t.id === s.theme ? "selected" : ""}>${t.name}</option>`)}
                </select>
              </label>
            </p>
            <p><label>Logo<br /><input type="file" name="logo" accept="image/png,image/webp,image/jpeg,image/avif" /></label></p>
            <button>Zapisz</button>
          </form>`,
      ),
    );
  });

  app.post("/sites/:site/settings", async (c) => {
    const site = await siteFor(c);
    if (!site || site.role !== "owner") return notFound(c);
    const form = await c.req.parseBody();
    const patch: Record<string, unknown> = {};
    for (const key of ["tagline", "email", "phone", "address", "hours", "accent", "theme"] as const) {
      if (typeof form[key] === "string") patch[key] = form[key];
    }
    try {
      const before = await site.settings.get();
      const logoKey = await upload(site.media, form.logo);
      if (logoKey) patch.logoKey = logoKey;
      await site.settings.update(patch);
      if (logoKey && before.logoKey) await site.media.delete(before.logoKey);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof MediaError) return bad(c, `Niepoprawne pole: ${error.message}`);
      throw error;
    }
    return c.redirect(`/sites/${site.tenantId}/settings`, 303);
  });

  return app;
}
