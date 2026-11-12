import { Hono, type Context } from "hono";
import { html } from "hono/html";
import {
  Media,
  cachedTenantResolver,
  forTenant,
  isSoldOut,
  itemSeoHead,
  robotsTxt,
  seoHead,
  sitemapXml,
  browse,
  categoryAndChildren,
  parseBrowse,
  type Category,
  ValidationError,
  type Checkout,
  type Html,
  type Mailer,
  type Platform,
  type Tenant,
} from "../../../core";
import { privacyPage, termsPage, withdrawalPage } from "../../../themes/legal";
import { addToCart, cartPage, checkoutPage, orderMails, orderPage } from "../../../themes/shop-pages";
import { categoryHref, listingPage } from "../../../themes/listing";
import { defaultPage, itemDetail } from "../../../themes/shared";
import { cartCount, changeCart, readCart, writeCart } from "./cart";

type StoreEnv = { Bindings: Env; Variables: { tenant: Tenant } };

export function storefrontApp(platform: Platform, mailer: (env: Env) => Mailer) {
  const app = new Hono<StoreEnv>();
  const resolveTenant = cachedTenantResolver();

  app.use("*", async (c, next) => {
    const tenant = await resolveTenant(c.env.DB, new URL(c.req.url).host, c.env.PLATFORM_DOMAIN);
    if (!tenant) return c.text("Nie znaleziono strony", 404);
    c.set("tenant", tenant);
    // A form posted from another website is refused (cart, checkout, contact).
    if (c.req.method === "POST" && c.req.header("origin") !== new URL(c.req.url).origin) return c.text("Niedozwolone żądanie", 403);
    await next();
  });

  app.get("/media/*", async (c) => {
    const key = decodeURIComponent(c.req.path.slice("/media/".length));
    const media = new Media(c.env.MEDIA, c.get("tenant").id, c.env.IMAGES);
    const width = Number(c.req.query("w"));
    const object = width > 0 ? await media.variant(key, width) : await media.get(key);
    if (!object) return c.notFound();
    const headers = new Headers({ "cache-control": "public, max-age=31536000, immutable", etag: object.httpEtag });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  });

  app.get("/robots.txt", (c) => c.text(robotsTxt(new URL(c.req.url).origin)));

  app.get("/sitemap.xml", async (c) => {
    const tenant = c.get("tenant");
    const items = await forTenant(platform, c.env.DB, tenant.id).catalog.listItems({ status: "active" });
    const lastModified = items.reduce((max, i) => Math.max(max, i.updated_at), 0) || undefined;
    const origin = new URL(c.req.url).origin;
    // Item pages are linked from the shop theme only, so only shops list them.
    const itemPages = tenant.kind === "shop" ? items.map((i) => ({ url: `${origin}/p/${encodeURIComponent(i.slug)}`, lastModified: i.updated_at })) : [];
    const categories = tenant.kind === "shop" ? await forTenant(platform, c.env.DB, tenant.id).catalog.listCategories() : [];
    const used = new Set(items.map((i) => i.category_id));
    const categoryPages = categories
      .filter((k) => [...categoryAndChildren(categories, k.id)].some((id) => used.has(id)))
      .map((k) => ({ url: `${origin}${categoryHref(k)}`, lastModified }));
    return c.body(sitemapXml([{ url: `${origin}/`, lastModified }, ...categoryPages, ...itemPages]), 200, {
      "content-type": "application/xml; charset=utf-8",
    });
  });

  app.post("/contact", async (c) => {
    const origin = new URL(c.req.url).origin;
    // Same rule as the panel: a form posted from another site is refused.
    if (c.req.header("origin") !== origin) return c.text("Niedozwolone żądanie", 403);
    const form = await c.req.parseBody();
    const field = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
    const tenant = c.get("tenant");
    const site = forTenant(platform, c.env.DB, tenant.id);
    const result = await site.inbox.submit(
      { name: field("name"), email: field("email"), phone: field("phone"), message: field("message"), trap: field("website") },
      c.req.header("cf-connecting-ip") ?? "unknown",
    );
    // Bots that filled the trap field see the same "sent" page as people.
    if (!result.ok && result.reason !== "spam") return c.redirect("/?contact=error#kontakt", 303);
    if (result.ok) {
      const { email } = await site.settings.get();
      if (email) {
        const m = result.message;
        const send = mailer(c.env)
          .send({
            to: email,
            replyTo: m.email,
            subject: `Nowa wiadomość ze strony ${tenant.name}`,
            text: `${m.name} <${m.email}>${m.phone ? `, tel. ${m.phone}` : ""} napisał(a):\n\n${m.message}\n\nWiadomość jest też w panelu, w zakładce Wiadomości.`,
          })
          .catch((err: unknown) => console.error("contact mail failed", err));
        c.executionCtx.waitUntil(send);
      }
    }
    return c.redirect("/?sent=1#kontakt", 303);
  });

  const mediaUrl = (key: string, width?: number) => `/media/${encodeURI(key)}${width ? `?w=${width}` : ""}`;

  app.get("/p/:slug", async (c) => {
    const tenant = c.get("tenant");
    const site = forTenant(platform, c.env.DB, tenant.id);
    const [settings, item] = await Promise.all([site.settings.get(), site.catalog.getItemBySlug(c.req.param("slug"))]);
    if (!item || item.status !== "active") return c.text("Nie znaleziono", 404);
    const theme = platform.themes.pick(tenant.kind, settings.theme);
    const origin = new URL(c.req.url).origin;
    const after = await site.slot("item.after", { item }, { tenant, settings });
    return c.html(
      (theme.page ?? defaultPage)({
        tenant,
        settings,
        title: item.name,
        body: itemDetail(
          { mediaUrl },
          item,
          html`${tenant.kind === "shop" && !isSoldOut(item) ? addToCart(item) : ""}${after}<p><a class="back" href="/">← Wszystkie produkty</a></p>`,
        ),
        cartCount: tenant.kind === "shop" ? cartCount(readCart(c)) : undefined,
        seo: itemSeoHead({
          tenant,
          item,
          url: `${origin}/p/${encodeURIComponent(item.slug)}`,
          imageUrl: item.image_key ? origin + mediaUrl(item.image_key, 1280) : undefined,
        }),
        slot: (name, data) => site.slot(name, data, { tenant, settings }),
        mediaUrl,
      }),
    );
  });

  // ---------- Shop: product search and category pages (shops only) ----------

  app.use("/produkty", async (c, next) => (c.get("tenant").kind === "shop" ? next() : c.notFound()));
  app.use("/kategoria/*", async (c, next) => (c.get("tenant").kind === "shop" ? next() : c.notFound()));

  async function listing(c: C, slug?: string) {
    const tenant = c.get("tenant");
    const site = forTenant(platform, c.env.DB, tenant.id);
    const [settings, items, categories] = await Promise.all([
      site.settings.get(),
      site.catalog.listItems({ status: "active" }),
      site.catalog.listCategories(),
    ]);
    const category = slug === undefined ? undefined : categories.find((k) => k.slug === slug);
    if (slug !== undefined && !category) return c.text("Nie znaleziono", 404);
    const url = new URL(c.req.url);
    const query = parseBrowse(url.searchParams);
    const result = browse(items, categories, query, category?.id);
    const base = category ? categoryHref(category) : "/produkty";
    const used = new Set(items.map((i) => i.category_id));
    const hasItems = (k: Category) => [...categoryAndChildren(categories, k.id)].some((id) => used.has(id));
    const chips = categories.filter((k) => k.parent_id === (category?.id ?? null) && hasItems(k));
    const parent = category?.parent_id ? categories.find((k) => k.id === category.parent_id) : undefined;
    const heading = category ? category.name : query.q ? `Wyniki dla „${query.q}”` : "Wszystkie produkty";
    // A category page is worth finding in Google; search results and filtered views are not.
    const plain = category && !query.q && query.min === null && query.max === null && query.sort === "polecane" && result.page === 1;
    const theme = platform.themes.pick(tenant.kind, settings.theme);
    return c.html(
      (theme.page ?? defaultPage)({
        tenant,
        settings,
        title: heading,
        body: listingPage({
          mediaUrl,
          result,
          base,
          heading,
          chips,
          up: parent ? { href: categoryHref(parent), label: parent.name } : { href: "/", label: "Strona główna" },
        }),
        cartCount: cartCount(readCart(c)),
        seo: plain
          ? html`<title>${category.name} – ${tenant.name}</title><link rel="canonical" href="${url.origin}${base}" />`
          : html`<title>${heading} – ${tenant.name}</title><meta name="robots" content="noindex" />`,
        slot: (name, data) => site.slot(name, data, { tenant, settings }),
        mediaUrl,
      }),
    );
  }

  app.get("/produkty", (c) => listing(c));
  app.get("/kategoria/:slug", (c) => listing(c, c.req.param("slug")));

  // ---------- Shop: cart, checkout, order page (shops only) ----------

  type C = Context<StoreEnv>;

  /** Cart, checkout and order pages: inside the theme's layout, never indexed by search engines. */
  async function shopPage(c: C, title: string, body: Html, status: 200 | 400 = 200) {
    const tenant = c.get("tenant");
    const site = forTenant(platform, c.env.DB, tenant.id);
    const settings = await site.settings.get();
    const theme = platform.themes.pick(tenant.kind, settings.theme);
    c.header("cache-control", "no-store");
    return c.html(
      (theme.page ?? defaultPage)({
        tenant,
        settings,
        title,
        body,
        seo: html`<title>${title} – ${tenant.name}</title><meta name="robots" content="noindex" />`,
        slot: (name, data) => site.slot(name, data, { tenant, settings }),
        mediaUrl,
        cartCount: tenant.kind === "shop" ? cartCount(readCart(c)) : undefined,
      }),
      status,
    );
  }

  // ---------- Legal pages: privacy for every site, terms and returns for shops ----------

  const legal = async (c: C) => {
    const tenant = c.get("tenant");
    const settings = await forTenant(platform, c.env.DB, tenant.id).settings.get();
    return { tenant, settings, origin: new URL(c.req.url).origin };
  };
  app.get("/polityka-prywatnosci", async (c) => shopPage(c, "Polityka prywatności", privacyPage(await legal(c))));
  app.get("/regulamin", async (c) => (c.get("tenant").kind === "shop" ? shopPage(c, "Regulamin", termsPage(await legal(c))) : c.notFound()));
  app.get("/odstapienie", async (c) => (c.get("tenant").kind === "shop" ? shopPage(c, "Zwroty", withdrawalPage(await legal(c))) : c.notFound()));

  app.use("/cart/*", async (c, next) => (c.get("tenant").kind === "shop" ? next() : c.notFound()));
  app.use("/cart", async (c, next) => (c.get("tenant").kind === "shop" ? next() : c.notFound()));
  app.use("/checkout", async (c, next) => (c.get("tenant").kind === "shop" ? next() : c.notFound()));
  app.use("/order/*", async (c, next) => (c.get("tenant").kind === "shop" ? next() : c.notFound()));

  const qtyOf = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : 1;
  };

  app.post("/cart/add", async (c) => {
    const form = await c.req.parseBody();
    const itemId = String(form.itemId ?? "");
    const site = forTenant(platform, c.env.DB, c.get("tenant").id);
    const item = await site.catalog.getItem(itemId);
    if (!item || item.status !== "active" || isSoldOut(item)) return c.redirect("/cart?n=gone", 303);
    writeCart(c, changeCart(readCart(c), item.id, Math.max(1, qtyOf(form.qty)), true));
    return c.redirect("/cart?n=added", 303);
  });

  app.post("/cart/update", async (c) => {
    const form = await c.req.parseBody();
    const qty = form.op === "remove" ? 0 : qtyOf(form.qty);
    writeCart(c, changeCart(readCart(c), String(form.itemId ?? ""), qty));
    return c.redirect("/cart", 303);
  });

  app.get("/cart", async (c) => {
    const site = forTenant(platform, c.env.DB, c.get("tenant").id);
    const cart = readCart(c);
    const [priced, settings] = await Promise.all([site.orders.price(cart), site.settings.get()]);
    // Keep the cookie in line with what can still be bought.
    if (priced.dropped) writeCart(c, priced.lines.map((l) => ({ itemId: l.item.id, qty: l.qty })));
    const notice = { added: "Dodano do koszyka.", gone: "Tego produktu nie można już kupić." }[c.req.query("n") ?? ""] ?? "";
    return shopPage(c, "Koszyk", cartPage({ mediaUrl }, priced, settings, notice));
  });

  app.get("/checkout", async (c) => {
    const site = forTenant(platform, c.env.DB, c.get("tenant").id);
    const [priced, settings] = await Promise.all([site.orders.price(readCart(c)), site.settings.get()]);
    if (!priced.lines.length) return c.redirect("/cart", 303);
    return shopPage(c, "Zamówienie", checkoutPage(priced, settings));
  });

  app.post("/checkout", async (c) => {
    const tenant = c.get("tenant");
    const site = forTenant(platform, c.env.DB, tenant.id);
    const form = await c.req.parseBody();
    const field = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
    const input: Checkout = {
      name: field("name"),
      email: field("email"),
      phone: field("phone"),
      delivery: field("delivery") as Checkout["delivery"],
      address: field("address"),
      note: field("note"),
    };
    const cart = readCart(c);
    const settings = await site.settings.get();
    if (form.terms !== "1") {
      const priced = await site.orders.price(cart);
      if (!priced.lines.length) return c.redirect("/cart", 303);
      return shopPage(c, "Zamówienie", checkoutPage(priced, settings, input, "terms"), 400);
    }
    let placed;
    try {
      placed = await site.orders.place(cart, input, settings);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      if (error.message === "cart") return c.redirect("/cart", 303);
      return shopPage(c, "Zamówienie", checkoutPage(await site.orders.price(cart), settings, input, error.message), 400);
    }
    const { order, key } = placed;
    writeCart(c, []);
    const url = new URL(c.req.url);
    const orderUrl = `${url.origin}/order/${order.id}?k=${key}`;
    const panelUrl = `${url.protocol}//panel.${c.env.PLATFORM_DOMAIN}${url.port ? `:${url.port}` : ""}/sites/${tenant.id}/orders/${order.id}`;
    const mails = orderMails(order, settings, tenant.name, orderUrl, panelUrl);
    const send = mailer(c.env);
    // The order is saved; a mail provider hiccup must not turn it into an error page.
    c.executionCtx.waitUntil(
      Promise.all([send.send(mails.customer), mails.seller && send.send(mails.seller)]).catch((err: unknown) => console.error("order mail failed", err)),
    );
    return c.redirect(`/order/${order.id}?k=${key}&new=1`, 303);
  });

  app.get("/order/:id", async (c) => {
    const site = forTenant(platform, c.env.DB, c.get("tenant").id);
    const [order, settings] = await Promise.all([
      site.orders.getForCustomer(c.req.param("id"), c.req.query("k") ?? ""),
      site.settings.get(),
    ]);
    if (!order) return c.text("Nie znaleziono zamówienia", 404);
    // The secret is in the address: never send it to other sites as a referrer.
    c.header("referrer-policy", "no-referrer");
    return shopPage(c, `Zamówienie nr ${order.number}`, orderPage(order, settings, c.req.query("new") === "1"));
  });

  app.get("/", async (c) => {
    const tenant = c.get("tenant");
    const site = forTenant(platform, c.env.DB, tenant.id);
    const [settings, items, categories] = await Promise.all([
      site.settings.get(),
      site.catalog.listItems({ status: "active" }),
      site.catalog.listCategories(),
    ]);
    const theme = platform.themes.pick(tenant.kind, settings.theme);
    const origin = new URL(c.req.url).origin;
    return c.html(
      theme.home({
        tenant,
        settings,
        items,
        categories,
        slot: (name, data) => site.slot(name, data, { tenant, settings }),
        mediaUrl,
        cartCount: tenant.kind === "shop" ? cartCount(readCart(c)) : undefined,
        flash: c.req.query("sent") ? "sent" : c.req.query("contact") === "error" ? "contact-error" : undefined,
        seo: seoHead({
          tenant,
          settings,
          url: `${origin}/`,
          logoUrl: settings.logoKey ? origin + mediaUrl(settings.logoKey, 640) : undefined,
          items,
        }),
      }),
    );
  });

  return app;
}
