import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html, raw } from "hono/html";
import {
  ALLERGENS,
  Media,
  MediaError,
  RESERVED_SLUGS,
  ValidationError,
  auth,
  cleanSettings,
  forTenant,
  isSoldOut,
  newId,
  parseAllergens,
  qrPng,
  qrSvg,
  slugify,
  type Item,
  type ItemKind,
  type ItemStatus,
  type Mailer,
  type Platform,
  type SiteKind,
  type SiteSettings,
} from "../../../core";
import { parsePrice, zl } from "./layout";
import { PANEL_CSS, PANEL_CSS_VERSION, authPage, notice, panelPage, type SiteNav } from "./panel-ui";

export const SESSION_COOKIE = "__Host-sid";

type PanelEnv = { Bindings: Env; Variables: { user: auth.SessionUser } };
type C = Context<PanelEnv>;

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  // "same-origin": no referrer leaves the panel (so a login token in the URL never leaks), while the panel
  // still gets a real Origin header on its own forms. "no-referrer" would make browsers send "Origin: null".
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

const KIND_LABEL: Record<SiteKind, string> = { shop: "Sklep", "business-card": "Wizytówka", "qr-menu": "Menu QR" };
const ITEM_KIND_LABEL: Record<ItemKind, string> = { product: "Produkt", service: "Usługa", dish: "Danie" };
const STATUS_LABEL: Record<ItemStatus, string> = { active: "Widoczna", hidden: "Ukryta", draft: "Szkic" };

/** "29,99" for a form field. */
const priceField = (grosze: number) => (grosze / 100).toFixed(2).replace(".", ",");

export function panelApp(platform: Platform, mailer: (env: Env) => Mailer) {
  const app = new Hono<PanelEnv>();

  app.use("*", async (c, next) => {
    // Cross-site form posts are refused: a POST must come from the panel's own pages.
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("origin") !== new URL(c.req.url).origin) {
      return c.text("Niedozwolone żądanie", 403);
    }
    await next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
    if (!c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "no-store");
  });

  app.get("/assets/panel.css", (c) =>
    c.body(PANEL_CSS, 200, {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    }),
  );

  // ---------- Signing in ----------

  app.get("/login", (c) =>
    c.html(
      authPage(
        "Logowanie",
        html`<h1>Zaloguj się</h1>
          <p>Podaj e-mail, a wyślemy Ci link do logowania. Bez hasła.</p>
          <form method="post" action="/login">
            <label class="field"><span>E-mail</span><input type="email" name="email" required autocomplete="email" autofocus /></label>
            <button class="btn primary block">Wyślij link</button>
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
      authPage(
        "Sprawdź skrzynkę",
        html`<h1>Sprawdź skrzynkę</h1>
          <p>Jeśli adres jest poprawny, za chwilę dostaniesz link do logowania. Działa 15 minut i tylko raz.</p>
          <a class="btn block" href="/login">Wpisz inny adres</a>`,
      ),
    );
  });

  // Mail scanners open links automatically, so opening the link only shows a button; the POST logs in.
  app.get("/login/verify", (c) =>
    c.html(
      authPage(
        "Potwierdź logowanie",
        html`<h1>Prawie gotowe</h1>
          <p>Kliknij, aby zalogować się na tym urządzeniu.</p>
          <form method="post" action="/login/verify">
            <input type="hidden" name="t" value="${c.req.query("t") ?? ""}" />
            <button class="btn primary block">Zaloguj mnie</button>
          </form>`,
      ),
    ),
  );

  app.post("/login/verify", async (c) => {
    const form = await c.req.parseBody();
    const session = await auth.consumeLogin(c.env.DB, String(form.t ?? ""), c.req.header("user-agent") ?? "");
    if (!session) {
      return c.html(
        authPage(
          "Link nieważny",
          html`<h1>Ten link już nie działa</h1>
            <p>Wygasł albo był już użyty. Wyślij sobie nowy.</p>
            <a class="btn primary block" href="/login">Wyślij nowy link</a>`,
        ),
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

  // ---------- Everything below needs a logged-in user ----------

  app.use("*", async (c, next) => {
    const user = await auth.getSession(c.env.DB, getCookie(c, SESSION_COOKIE));
    if (!user) return c.redirect("/login", 303);
    c.set("user", user);
    await next();
  });

  const savedNotice = (c: C) => (c.req.query("ok") ? notice("ok", "Zapisano.") : "");

  app.get("/", async (c) => {
    const sites = await auth.sitesOf(c.env.DB, c.get("user").userId);
    return c.html(
      panelPage({
        title: "Twoje strony",
        email: c.get("user").email,
        body: html`<div class="head"><h1>Twoje strony</h1></div>
          ${sites.length
            ? html`<div class="list">
                ${sites.map(
                  (s) => html`<a href="/sites/${s.id}">
                    <div class="grow"><div class="name">${s.name}</div><div class="sub">${KIND_LABEL[s.kind as SiteKind] ?? s.kind} · ${s.slug}</div></div>
                    <span class="sub">→</span>
                  </a>`,
                )}
              </div>`
            : html`<div class="card empty">Nie masz jeszcze żadnej strony. Załóż pierwszą poniżej.</div>`}
          <div class="card">
            <h2>Nowa strona</h2>
            <form method="post" action="/sites">
              <div class="kinds">
                <label><input type="radio" name="kind" value="business-card" required />Wizytówka<small>firma, usługi, kontakt</small></label>
                <label><input type="radio" name="kind" value="qr-menu" />Menu QR<small>karta dań do stolika</small></label>
                <label><input type="radio" name="kind" value="shop" checked />Sklep<small>produkty i zamówienia</small></label>
              </div>
              <div class="inline">
                <input name="name" placeholder="Nazwa, np. Serwis Laptopów Kowalski" required maxlength="80" />
                <button class="btn primary">Utwórz</button>
              </div>
            </form>
          </div>`,
      }),
    );
  });

  app.post("/sites", async (c) => {
    const form = await c.req.parseBody();
    const name = String(form.name ?? "").trim().slice(0, 80);
    const kind = String(form.kind ?? "");
    if (!name || !(kind in KIND_LABEL)) return bad(c, "Podaj nazwę i wybierz rodzaj strony.");
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

  // ---------- One site ----------

  /** Returns the site's core API only if the logged-in user is a member; otherwise null. */
  async function siteFor(c: C) {
    const tenantId = c.req.param("site") ?? "";
    const role = await auth.membership(c.env.DB, c.get("user").userId, tenantId);
    if (!role) return null;
    const tenant = await c.env.DB.prepare("SELECT name, slug, kind FROM tenants WHERE id = ?1")
      .bind(tenantId)
      .first<{ name: string; slug: string; kind: string }>();
    if (!tenant) return null;
    const api = forTenant(platform, c.env.DB, tenantId);
    const unread = await api.inbox.unreadCount();
    const url = new URL(c.req.url);
    const publicUrl = `${url.protocol}//${tenant.slug}.${c.env.PLATFORM_DOMAIN}${url.port ? `:${url.port}` : ""}/`;
    const nav = (active: SiteNav["active"]): SiteNav => ({
      id: tenantId,
      name: tenant.name,
      publicUrl,
      isOwner: role === "owner",
      active,
      unread: active === "messages" ? 0 : unread,
    });
    return { tenantId, role, nav, tenant, publicUrl, media: new Media(c.env.MEDIA, tenantId, c.env.IMAGES), ...api };
  }

  const notFound = (c: C) => c.text("Nie znaleziono", 404);

  function bad(c: C, message: string, back = "/") {
    return c.html(
      panelPage({
        title: "Coś się nie zgadza",
        email: c.get("user").email,
        notice: notice("err", message),
        body: html`<a class="btn" href="${back}">← Wróć</a>`,
      }),
      400,
    );
  }

  /** Stores an uploaded image if the form has one. Returns the new key, undefined when no file was sent. */
  async function upload(media: Media, file: unknown): Promise<string | undefined> {
    if (!(file instanceof File) || file.size === 0) return undefined;
    return media.putImage(await file.arrayBuffer(), file.type);
  }

  const mediaError = (error: MediaError) =>
    /larger than 5 MB/.test(error.message)
      ? "Zdjęcie jest większe niż 5 MB."
      : "To nie jest obsługiwane zdjęcie. Użyj JPG, PNG, WebP albo AVIF.";

  // Thumbnails for the panel, same membership check as everything else.
  app.get("/sites/:site/media/*", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const key = decodeURIComponent(c.req.path.split("/media/")[1] ?? "");
    const object = await site.media.variant(key, 320);
    if (!object) return notFound(c);
    const headers = new Headers({ "cache-control": "private, max-age=86400" });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  });

  /** What sellers of each site kind add most often, preselected in the "add item" form. */
  const DEFAULT_ITEM_KIND: Record<string, ItemKind> = { "qr-menu": "dish", "business-card": "service", shop: "product" };

  const thumb = (siteId: string, item: Item) =>
    item.image_key
      ? html`<img class="thumb" src="/sites/${siteId}/media/${encodeURI(item.image_key)}" alt="" loading="lazy" />`
      : html`<span class="thumb none" aria-hidden="true">▢</span>`;

  app.get("/sites/:site", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const q = (c.req.query("q") ?? "").slice(0, 80);
    const cat = c.req.query("cat") ?? "";
    const show = c.req.query("show") ?? "";
    const filtered = Boolean(q || cat || show);
    const [all, categories] = await Promise.all([
      site.catalog.listItems({ search: q || undefined, status: show in STATUS_LABEL ? (show as ItemStatus) : undefined }),
      site.catalog.listCategories(),
    ]);
    const items = all.filter(
      (i) => (show !== "soldout" || isSoldOut(i)) && (!cat || (cat === "none" ? !i.category_id : i.category_id === cat)),
    );
    // Same grouping as on the site, so the arrows move things where customers will see them.
    const known = new Set(categories.map((x) => x.id));
    const groups = [
      ...categories.map((x) => ({ title: x.name, items: items.filter((i) => i.category_id === x.id) })),
      { title: "Bez kategorii", items: items.filter((i) => !i.category_id || !known.has(i.category_id)) },
    ].filter((g) => g.items.length);
    const ret = new URL(c.req.url).search;
    const base = `/sites/${site.tenantId}`;
    const arrows = (i: Item, n: number, len: number) =>
      filtered
        ? ""
        : html`<form method="post" action="${base}/items/${i.id}/move" class="arrows">
            <button class="btn small icon" name="dir" value="up" ${n === 0 ? "disabled" : ""} aria-label="Przesuń wyżej: ${i.name}">↑</button>
            <button class="btn small icon" name="dir" value="down" ${n === len - 1 ? "disabled" : ""} aria-label="Przesuń niżej: ${i.name}">↓</button>
          </form>`;
    const row = (i: Item, n: number, len: number) => {
      const out = isSoldOut(i);
      return html`<div id="i-${i.id}">
        <a class="rowlink" href="${base}/items/${i.id}">
          ${thumb(site.tenantId, i)}
          <div class="grow">
            <div class="name">${i.name}</div>
            <div class="sub">
              ${ITEM_KIND_LABEL[i.kind]} <span class="pill ${i.status}">${STATUS_LABEL[i.status]}</span>${out
                ? html`<span class="pill draft">Brak dziś</span>`
                : ""}
            </div>
          </div>
          <span class="price">${zl(i.price)}</span>
        </a>
        ${arrows(i, n, len)}
        ${i.kind === "dish"
          ? html`<form method="post" action="${base}/items/${i.id}/sold-out">
              <input type="hidden" name="soldOut" value="${out ? "0" : "1"}" />
              <input type="hidden" name="ret" value="${ret}" />
              <button class="btn small ${out ? "primary" : ""}">${out ? "Znów jest" : "Brak dziś"}</button>
            </form>`
          : ""}
      </div>`;
    };
    const option = (value: string, label: string, current: string) =>
      html`<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
    return c.html(
      panelPage({
        title: "Pozycje",
        email: c.get("user").email,
        site: site.nav("items"),
        notice: savedNotice(c),
        body: html`<div class="card">
            <h2>Dodaj pozycję</h2>
            <form method="post" action="${base}/items" class="inline">
              <input name="name" placeholder="Nazwa" required maxlength="120" aria-label="Nazwa" />
              <input name="price" placeholder="Cena, np. 29,99" required inputmode="decimal" aria-label="Cena" />
              <select name="kind" aria-label="Rodzaj">
                ${(Object.keys(ITEM_KIND_LABEL) as ItemKind[]).map(
                  (k) => html`<option value="${k}" ${k === DEFAULT_ITEM_KIND[site.tenant.kind] ? "selected" : ""}>${ITEM_KIND_LABEL[k]}</option>`,
                )}
              </select>
              <button class="btn primary">Dodaj</button>
            </form>
          </div>
          <form method="get" action="${base}" class="inline filters" role="search">
            <input type="search" name="q" value="${q}" placeholder="Szukaj po nazwie" aria-label="Szukaj po nazwie" />
            <select name="cat" aria-label="Kategoria">
              ${option("", "Wszystkie kategorie", cat)} ${categories.map((x) => option(x.id, x.name, cat))} ${option("none", "Bez kategorii", cat)}
            </select>
            <select name="show" aria-label="Status">
              ${option("", "Każdy status", show)} ${(Object.keys(STATUS_LABEL) as ItemStatus[]).map((k) => option(k, STATUS_LABEL[k], show))}
              ${option("soldout", "Brak dziś", show)}
            </select>
            <button class="btn">Filtruj</button>
            ${filtered ? html`<a class="btn" href="${base}">Wyczyść</a>` : ""}
          </form>
          ${filtered ? html`<p class="sub">Znaleziono: ${items.length}. Kolejność zmienisz po wyczyszczeniu filtrów.</p>` : ""}
          ${groups.length
            ? groups.map(
                (g) => html`${categories.length ? html`<h3 class="group">${g.title}</h3>` : ""}
                  <div class="list">${g.items.map((i, n) => row(i, n, g.items.length))}</div>`,
              )
            : html`<div class="card empty">${filtered ? "Nic nie pasuje do filtrów." : "Brak pozycji. Dodaj pierwszą powyżej."}</div>`}`,
      }),
    );
  });

  /** Only a plain query string (from our own filter form) is accepted as a place to return to. */
  const backToList = (siteId: string, ret: unknown, anchor = "") =>
    `/sites/${siteId}${typeof ret === "string" && /^\?[\w=&%+.-]*$/.test(ret) ? ret : ""}${anchor}`;

  app.post("/sites/:site/items/:item/move", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const form = await c.req.parseBody();
    const id = c.req.param("item");
    if (!(await site.catalog.getItem(id))) return notFound(c);
    await site.catalog.moveItem(id, form.dir === "up" ? "up" : "down");
    return c.redirect(`/sites/${site.tenantId}#i-${id}`, 303);
  });

  app.post("/sites/:site/items", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const back = `/sites/${site.tenantId}`;
    const form = await c.req.parseBody();
    const price = parsePrice(String(form.price ?? ""));
    if (price === null) return bad(c, "Niepoprawna cena. Wpisz np. 29,99.", back);
    try {
      const item = await site.catalog.createItem({
        kind: String(form.kind) as ItemKind,
        name: String(form.name ?? "").slice(0, 120),
        price,
      });
      return c.redirect(`/sites/${site.tenantId}/items/${item.id}`, 303);
    } catch (error) {
      if (error instanceof ValidationError) return bad(c, "Sprawdź nazwę i rodzaj pozycji.", back);
      throw error;
    }
  });

  app.get("/sites/:site/items/:item", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const [item, categories] = await Promise.all([site.catalog.getItem(c.req.param("item")), site.catalog.listCategories()]);
    if (!item) return notFound(c);
    return c.html(
      panelPage({
        title: item.name,
        email: c.get("user").email,
        site: site.nav("items"),
        notice: savedNotice(c),
        body: html`<form method="post" action="/sites/${site.tenantId}/items/${item.id}" enctype="multipart/form-data">
            <div class="card">
              <h2>${ITEM_KIND_LABEL[item.kind]}</h2>
              <label class="field"><span>Nazwa</span><input name="name" value="${item.name}" required maxlength="120" /></label>
              <div class="grid two">
                <label class="field"><span>Cena (zł)</span><input name="price" value="${priceField(item.price)}" required inputmode="decimal" /></label>
                <label class="field"><span>Status</span>
                  <select name="status">
                    ${(Object.keys(STATUS_LABEL) as ItemStatus[]).map(
                      (s) => html`<option value="${s}" ${s === item.status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`,
                    )}
                  </select>
                  <span class="hint">Ukryta i szkic nie są widoczne na stronie.</span>
                </label>
              </div>
              <label class="field"><span>Kategoria</span>
                <select name="categoryId">
                  <option value="">Bez kategorii</option>
                  ${categories.map((x) => html`<option value="${x.id}" ${x.id === item.category_id ? "selected" : ""}>${x.name}</option>`)}
                </select>
              </label>
              <label class="field"><span>Opis</span><textarea name="description" maxlength="2000">${item.description}</textarea></label>
              ${item.kind === "dish"
                ? html`<fieldset class="field checks"><legend>Alergeny</legend>
                    <input type="hidden" name="allergensShown" value="1" />
                    ${ALLERGENS.map(
                      (a) => html`<label><input type="checkbox" name="allergens" value="${a.id}" ${parseAllergens(item.allergens).includes(a.id)
                          ? "checked"
                          : ""} />${a.label}</label>`,
                    )}
                    <span class="hint">Na karcie pokażą się jako numery z legendą na dole.</span>
                  </fieldset>`
                : ""}
              <label class="field"><span>Zdjęcie</span>
                ${item.image_key ? html`<img class="thumb" src="/sites/${site.tenantId}/media/${encodeURI(item.image_key)}" alt="" />` : ""}
                <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif" />
                <span class="hint">JPG, PNG, WebP lub AVIF, do 5 MB.${item.image_key ? " Nowy plik zastąpi obecne zdjęcie." : ""}</span>
              </label>
              <div class="actions">
                <a class="btn" href="/sites/${site.tenantId}">Anuluj</a>
                <button class="btn primary">Zapisz</button>
              </div>
            </div>
          </form>
          <form method="post" action="/sites/${site.tenantId}/items/${item.id}/delete">
            <button class="btn danger">Usuń tę pozycję</button>
          </form>`,
      }),
    );
  });

  app.post("/sites/:site/items/:item", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const current = await site.catalog.getItem(c.req.param("item"));
    if (!current) return notFound(c);
    const back = `/sites/${site.tenantId}/items/${current.id}`;
    const form = await c.req.parseBody({ all: true });
    const allergens = form.allergensShown ? ([] as unknown[]).concat(form.allergens ?? []).map(String) : undefined;
    const price = parsePrice(String(form.price ?? ""));
    if (price === null) return bad(c, "Niepoprawna cena. Wpisz np. 29,99.", back);
    const categoryId = String(form.categoryId ?? "");
    let imageKey: string | undefined;
    try {
      imageKey = await upload(site.media, form.image);
      await site.catalog.updateItem(current.id, {
        name: String(form.name ?? "").slice(0, 120),
        description: String(form.description ?? "").slice(0, 2000),
        price,
        categoryId: categoryId || null,
        status: String(form.status) as ItemStatus,
        ...(imageKey ? { imageKey } : {}),
        ...(allergens ? { allergens } : {}),
      });
      if (imageKey && current.image_key) await site.media.delete(current.image_key);
    } catch (error) {
      // Never leave an orphaned upload behind when the rest of the form was rejected.
      if (imageKey) await site.media.delete(imageKey);
      if (error instanceof MediaError) return bad(c, mediaError(error), back);
      if (error instanceof ValidationError) {
        return bad(c, /category/i.test(error.message) ? "Nieznana kategoria." : "Sprawdź pola formularza.", back);
      }
      throw error;
    }
    return c.redirect(`${back}?ok=1`, 303);
  });

  app.post("/sites/:site/items/:item/sold-out", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const form = await c.req.parseBody();
    const item = await site.catalog.setSoldOut(c.req.param("item"), form.soldOut === "1");
    if (!item) return notFound(c);
    return c.redirect(backToList(site.tenantId, form.ret, `#i-${item.id}`), 303);
  });

  app.post("/sites/:site/items/:item/delete", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const item = await site.catalog.getItem(c.req.param("item"));
    if (item && (await site.catalog.deleteItem(item.id)) && item.image_key) await site.media.delete(item.image_key);
    return c.redirect(`/sites/${site.tenantId}`, 303);
  });

  app.get("/sites/:site/categories", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const [categories, items] = await Promise.all([site.catalog.listCategories(), site.catalog.listItems()]);
    const count = (id: string) => items.filter((i) => i.category_id === id).length;
    return c.html(
      panelPage({
        title: "Kategorie",
        email: c.get("user").email,
        site: site.nav("categories"),
        notice: savedNotice(c),
        body: html`<div class="card">
            <h2>Nowa kategoria</h2>
            <form method="post" action="/sites/${site.tenantId}/categories" class="inline">
              <input name="name" placeholder="np. Naprawy, Akcesoria, Desery" required maxlength="80" aria-label="Nazwa kategorii" />
              <button class="btn primary">Dodaj</button>
            </form>
          </div>
          ${categories.length
            ? html`<div class="list cats">
                ${categories.map((x, n) => {
                  const url = `/sites/${site.tenantId}/categories/${x.id}`;
                  return html`<div id="c-${x.id}" class="cat">
                    <div class="grow">
                      <div class="name">${x.name}</div>
                      <span class="sub">${count(x.id)} poz.</span>
                    </div>
                    <form method="post" action="${url}/move" class="arrows">
                      <button class="btn small icon" name="dir" value="up" ${n === 0 ? "disabled" : ""} aria-label="Przesuń wyżej: ${x.name}">↑</button>
                      <button class="btn small icon" name="dir" value="down" ${n === categories.length - 1 ? "disabled" : ""} aria-label="Przesuń niżej: ${x.name}">↓</button>
                    </form>
                    <details>
                      <summary class="btn small">Zmień</summary>
                      <div class="pop">
                        <form method="post" action="${url}" class="inline">
                          <input name="name" value="${x.name}" required maxlength="80" aria-label="Nowa nazwa" />
                          <button class="btn small primary">Zapisz</button>
                        </form>
                        <form method="post" action="${url}/delete">
                          <button class="btn small danger">Usuń kategorię</button>
                          <span class="hint">Pozycje zostaną, tylko bez kategorii.</span>
                        </form>
                      </div>
                    </details>
                  </div>`;
                })}
              </div>`
            : html`<div class="card empty">Kategorie pomagają klientom szybko znaleźć to, czego szukają.</div>`}`,
      }),
    );
  });

  app.post("/sites/:site/categories", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const back = `/sites/${site.tenantId}/categories`;
    const form = await c.req.parseBody();
    try {
      await site.catalog.createCategory({ name: String(form.name ?? "").slice(0, 80) });
    } catch (error) {
      if (error instanceof ValidationError) return bad(c, "Podaj nazwę kategorii.", back);
      if (String(error).includes("UNIQUE")) return bad(c, "Taka kategoria już jest.", back);
      throw error;
    }
    return c.redirect(`${back}?ok=1`, 303);
  });

  app.post("/sites/:site/categories/:cat/move", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const form = await c.req.parseBody();
    const id = c.req.param("cat");
    if (!(await site.catalog.getCategory(id))) return notFound(c);
    await site.catalog.moveCategory(id, form.dir === "up" ? "up" : "down");
    return c.redirect(`/sites/${site.tenantId}/categories#c-${id}`, 303);
  });

  app.post("/sites/:site/categories/:cat", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const back = `/sites/${site.tenantId}/categories`;
    const form = await c.req.parseBody();
    try {
      if (!(await site.catalog.renameCategory(c.req.param("cat"), String(form.name ?? "").slice(0, 80)))) return notFound(c);
    } catch (error) {
      if (error instanceof ValidationError) return bad(c, "Podaj nazwę kategorii.", back);
      throw error;
    }
    return c.redirect(`${back}?ok=1`, 303);
  });

  app.post("/sites/:site/categories/:cat/delete", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    if (!(await site.catalog.deleteCategory(c.req.param("cat")))) return notFound(c);
    return c.redirect(`/sites/${site.tenantId}/categories?ok=1`, 303);
  });

  // ---------- Contact form messages: any member ----------

  app.get("/sites/:site/messages", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const messages = await site.inbox.list();
    await site.inbox.markAllRead();
    const when = (t: number) =>
      new Date(t * 1000).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "medium", timeStyle: "short" });
    return c.html(
      panelPage({
        title: "Wiadomości",
        email: c.get("user").email,
        site: site.nav("messages"),
        notice: c.req.query("ok") ? notice("ok", "Usunięto.") : "",
        body: messages.length
          ? html`<div class="list">
              ${messages.map(
                (m) => html`<div class="msg ${m.read_at ? "" : "new"}">
                  <div class="actions">
                    <div class="grow">
                      <div class="name">${m.name}</div>
                      <div class="sub"><a href="mailto:${m.email}">${m.email}</a>${m.phone ? html` · <a href="tel:${m.phone}">${m.phone}</a>` : ""} · ${when(m.created_at)}</div>
                    </div>
                    <form method="post" action="/sites/${site.tenantId}/messages/${m.id}/delete">
                      <button class="btn small danger">Usuń</button>
                    </form>
                  </div>
                  <p>${m.message}</p>
                </div>`,
              )}
            </div>`
          : html`<div class="card empty">Tu pojawią się wiadomości z formularza kontaktowego na Twojej stronie.</div>`,
      }),
    );
  });

  app.post("/sites/:site/messages/:id/delete", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    await site.inbox.delete(c.req.param("id"));
    return c.redirect(`/sites/${site.tenantId}/messages?ok=1`, 303);
  });

  // ---------- QR code for tables, windows and flyers: any member ----------

  /** The address printed in the code: the site's own domain when it has one, otherwise its subdomain. */
  async function qrTarget(c: C, site: { tenantId: string; publicUrl: string }) {
    const own = await c.env.DB.prepare("SELECT domain FROM tenant_domains WHERE tenant_id = ?1 ORDER BY domain LIMIT 1")
      .bind(site.tenantId)
      .first<{ domain: string }>();
    return own ? `https://${own.domain}/` : site.publicUrl;
  }

  const qrCaption = (kind: string) => (kind === "qr-menu" ? "Zeskanuj, aby zobaczyć menu" : "Zeskanuj, aby odwiedzić naszą stronę");

  app.get("/sites/:site/qr", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const target = await qrTarget(c, site);
    const base = `/sites/${site.tenantId}/qr`;
    return c.html(
      panelPage({
        title: "Kod QR",
        email: c.get("user").email,
        site: site.nav("qr"),
        body: html`<div class="card qr-card">
          <div class="qr">${raw(qrSvg(target, { label: `Kod QR: ${target}` }))}</div>
          <div class="grow">
            <h2>Kod QR Twojej strony</h2>
            <p class="sub">Prowadzi do <a href="${target}" target="_blank" rel="noopener">${target}</a>. Kod się nie zmienia, więc raz wydrukowany działa zawsze, także po zmianie menu.</p>
            <div class="inline">
              <a class="btn primary" href="${base}/print?n=1">Wydruk: jeden duży</a>
              <a class="btn" href="${base}/print?n=6">Wydruk: 6 na stoliki</a>
            </div>
            <div class="inline">
              <a class="btn small" href="${base}.png" download>Pobierz PNG</a>
              <a class="btn small" href="${base}.svg" download>Pobierz SVG</a>
            </div>
            <p class="hint">PDF: otwórz wydruk i wybierz „Drukuj”, a potem „Zapisz jako PDF”. SVG nadaje się dla drukarni, PNG do social mediów.</p>
          </div>
        </div>`,
      }),
    );
  });

  app.get("/sites/:site/qr.svg", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    return c.body(qrSvg(await qrTarget(c, site)), 200, {
      "content-type": "image/svg+xml",
      "content-disposition": `attachment; filename="kod-qr-${site.tenant.slug}.svg"`,
    });
  });

  app.get("/sites/:site/qr.png", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    return c.body((await qrPng(await qrTarget(c, site))).buffer as ArrayBuffer, 200, {
      "content-type": "image/png",
      "content-disposition": `attachment; filename="kod-qr-${site.tenant.slug}.png"`,
    });
  });

  app.get("/sites/:site/qr/print", async (c) => {
    const site = await siteFor(c);
    if (!site) return notFound(c);
    const target = await qrTarget(c, site);
    const many = c.req.query("n") === "6";
    const svg = raw(qrSvg(target));
    const card = html`<div class="qr-print-card">
      <div class="qr">${svg}</div>
      <strong>${site.tenant.name}</strong>
      <span>${qrCaption(site.tenant.kind)}</span>
      <small>${target.replace(/^https?:\/\//, "").replace(/\/$/, "")}</small>
    </div>`;
    return c.html(html`<!doctype html>
      <html lang="pl">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <meta name="robots" content="noindex" />
          <title>Kod QR do druku · ${site.tenant.name}</title>
          <link rel="stylesheet" href="/assets/panel.css?v=${PANEL_CSS_VERSION}" />
        </head>
        <body class="qr-sheet">
          <p class="noprint"><a href="/sites/${site.tenantId}/qr">← Wróć</a> · Wybierz w przeglądarce „Drukuj” (Ctrl+P, na telefonie: Udostępnij → Drukuj), a potem „Zapisz jako PDF” albo swoją drukarkę.</p>
          <main class="${many ? "six" : "one"}">${many ? Array.from({ length: 6 }, () => card) : card}</main>
        </body>
      </html>`);
  });

  // ---------- Site settings: owners only ----------

  app.get("/sites/:site/settings", async (c) => {
    const site = await siteFor(c);
    if (!site || site.role !== "owner") return notFound(c);
    const s = await site.settings.get();
    const field = (name: keyof SiteSettings, label: string, type = "text", hint = "") =>
      html`<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${String(s[name] ?? "")}" />${hint
          ? html`<span class="hint">${hint}</span>`
          : ""}</label>`;
    return c.html(
      panelPage({
        title: "Ustawienia",
        email: c.get("user").email,
        site: site.nav("settings"),
        notice: savedNotice(c),
        body: html`<form method="post" action="/sites/${site.tenantId}/settings" enctype="multipart/form-data">
          <div class="card">
            <h2>O firmie</h2>
            ${field("tagline", "Krótki opis", "text", "Jedno zdanie pod nazwą, widoczne też w Google.")}
            <label class="field"><span>O nas</span><textarea name="about" maxlength="3000" rows="5">${s.about}</textarea><span class="hint"
                >Kilka zdań o firmie. Pusta linia zaczyna nowy akapit.</span></label>
            <div class="grid two">${field("email", "E-mail kontaktowy", "email")} ${field("phone", "Telefon", "tel")}</div>
            ${field("address", "Adres")} ${field("hours", "Godziny otwarcia", "text", "np. Pn–Pt 9–17, Sob 10–14")}
          </div>
          <div class="card">
            <h2>Wygląd</h2>
            <div class="grid two">
              ${field("accent", "Kolor przewodni", "color")}
              <label class="field"><span>Szablon</span>
                <select name="theme">
                  ${platform.themes.list().map((t) => html`<option value="${t.id}" ${t.id === s.theme ? "selected" : ""}>${t.name}</option>`)}
                </select>
              </label>
            </div>
            <label class="field"><span>Logo</span>
              ${s.logoKey ? html`<img class="logo" src="/sites/${site.tenantId}/media/${encodeURI(s.logoKey)}" alt="Obecne logo" />` : ""}
              <input type="file" name="logo" accept="image/png,image/webp,image/jpeg,image/avif" />
            </label>
            <div class="actions"><span></span><button class="btn primary">Zapisz ustawienia</button></div>
          </div>
        </form>`,
      }),
    );
  });

  app.post("/sites/:site/settings", async (c) => {
    const site = await siteFor(c);
    if (!site || site.role !== "owner") return notFound(c);
    const back = `/sites/${site.tenantId}/settings`;
    const form = await c.req.parseBody();
    const patch: Record<string, unknown> = {};
    for (const key of ["tagline", "about", "email", "phone", "address", "hours", "accent", "theme"] as const) {
      if (typeof form[key] === "string") patch[key] = form[key];
    }
    const FIELD: Record<string, string> = {
      email: "E-mail kontaktowy",
      phone: "Telefon",
      accent: "Kolor przewodni",
      theme: "Szablon",
      tagline: "Krótki opis",
      about: "O nas",
      address: "Adres",
      hours: "Godziny otwarcia",
    };
    try {
      cleanSettings(patch); // validate before uploading, so a rejected form leaves no file behind
      const before = await site.settings.get();
      const logoKey = await upload(site.media, form.logo);
      if (logoKey) patch.logoKey = logoKey;
      await site.settings.update(patch);
      if (logoKey && before.logoKey) await site.media.delete(before.logoKey);
    } catch (error) {
      if (error instanceof MediaError) return bad(c, mediaError(error), back);
      if (error instanceof ValidationError) {
        const name = Object.keys(FIELD).find((k) => error.message.startsWith(k));
        return bad(c, name ? `Popraw pole: ${FIELD[name]}.` : "Sprawdź pola formularza.", back);
      }
      throw error;
    }
    return c.redirect(`${back}?ok=1`, 303);
  });

  return app;
}
