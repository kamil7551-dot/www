import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../apps/worker/src/index";
import { CONTACT_LIMIT_PER_IP_HOUR, forTenantForTest, type Mail } from "./core-under-test";
import { createTenant } from "./helpers";
import { harness, uniqueEmail } from "./panel-harness";

async function site(slug: string, kind: "shop" | "business-card" = "business-card") {
  const id = await createTenant(kind);
  await env.DB.prepare("UPDATE tenants SET slug = ?2, name = ?3 WHERE id = ?1").bind(id, slug, `Firma ${slug}`).run();
  return { id, ...forTenantForTest(id) };
}

function store(slug: string) {
  const outbox: Mail[] = [];
  const app = createApp({ mailer: () => ({ send: async (m) => void outbox.push(m) }) });
  const origin = `https://${slug}.localhost`;
  const fetch = async (path: string, form?: Record<string, string>, opts: { origin?: string; ip?: string } = {}) => {
    const headers = new Headers({ "cf-connecting-ip": opts.ip ?? "203.0.113.7" });
    if (form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      headers.set("origin", opts.origin ?? origin);
    }
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request(origin + path, { method: form ? "POST" : "GET", headers, body: form && new URLSearchParams(form).toString(), redirect: "manual" }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  };
  return { outbox, fetch };
}

const msg = { name: "Anna", email: "Anna@Example.com", phone: "600 100 200", message: "Czy naprawiacie MacBooki?" };

describe("business card theme", () => {
  it("is the default for business cards and shows offer, contact and form", async () => {
    const s = await site("wizytowka-bc");
    await s.settings.update({ phone: "+48 600 100 200", address: "Rynek 1, Kraków", hours: "Pn–Pt 9–17", about: "Pierwszy akapit.\n\nDrugi <i>akapit</i>." });
    await s.catalog.createItem({ name: "Diagnoza laptopa", price: 5000, kind: "service" });
    const body = await (await store("wizytowka-bc").fetch("/")).text();
    expect(body).toContain('id="kontakt"');
    expect(body).toContain("Diagnoza laptopa");
    expect(body).toContain('href="tel:+48600100200"');
    expect(body).toContain('action="/contact"');
    expect(body).toContain("<p>Pierwszy akapit.</p>");
    expect(body).toContain("<p>Drugi &lt;i&gt;akapit&lt;/i&gt;.</p>");
    expect(body).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });
});

describe("contact form", () => {
  it("stores the message, mails the owner with reply-to and shows a thank-you", async () => {
    const s = await site("kontakt-ok");
    await s.settings.update({ email: "wlasciciel@firma.pl" });
    const st = store("kontakt-ok");
    const res = await st.fetch("/contact", msg);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?sent=1#kontakt");
    const [saved] = await s.inbox.list();
    expect(saved).toMatchObject({ name: "Anna", email: "anna@example.com", read_at: null });
    expect(st.outbox).toHaveLength(1);
    expect(st.outbox[0]).toMatchObject({ to: "wlasciciel@firma.pl", replyTo: "anna@example.com" });
    expect(st.outbox[0]!.text).toContain("Czy naprawiacie MacBooki?");
    expect(await (await st.fetch("/?sent=1")).text()).toContain("Dziękujemy");
  });

  it("silently drops bots that fill the hidden field", async () => {
    const s = await site("kontakt-bot");
    await s.settings.update({ email: "wlasciciel@firma.pl" });
    const st = store("kontakt-bot");
    const res = await st.fetch("/contact", { ...msg, website: "http://spam.example" });
    expect(res.headers.get("location")).toBe("/?sent=1#kontakt");
    expect(await s.inbox.list()).toHaveLength(0);
    expect(st.outbox).toHaveLength(0);
  });

  it("rejects invalid input and forms posted from other sites", async () => {
    const s = await site("kontakt-zle");
    const st = store("kontakt-zle");
    expect((await st.fetch("/contact", { ...msg, email: "nie-mail" })).headers.get("location")).toBe("/?contact=error#kontakt");
    expect((await st.fetch("/contact", msg, { origin: "https://evil.example" })).status).toBe(403);
    expect(await s.inbox.list()).toHaveLength(0);
  });

  it("limits messages per visitor", async () => {
    const s = await site("kontakt-limit");
    const st = store("kontakt-limit");
    for (let i = 0; i < CONTACT_LIMIT_PER_IP_HOUR; i++) await st.fetch("/contact", msg);
    expect((await st.fetch("/contact", msg)).headers.get("location")).toBe("/?contact=error#kontakt");
    expect((await st.fetch("/contact", msg, { ip: "198.51.100.1" })).headers.get("location")).toBe("/?sent=1#kontakt");
    expect(await s.inbox.list()).toHaveLength(CONTACT_LIMIT_PER_IP_HOUR + 1);
  });
});

describe("panel inbox", () => {
  it("shows messages with an unread badge, marks them read and deletes them", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const path = await h.newSite("Skrzynka", "business-card");
    const id = path.split("/").pop()!;
    const s = forTenantForTest(id);
    await s.inbox.submit({ name: "Jan <b>", email: "jan@example.com", message: "Dzień dobry" }, "1.1.1.1");

    expect(await (await h.call(path)).text()).toContain('<span class="count">1</span>');
    const page = await (await h.call(`${path}/messages`)).text();
    expect(page).toContain("Jan &lt;b&gt;");
    expect(page).toContain("Dzień dobry");
    expect(await s.inbox.unreadCount()).toBe(0);

    const [m] = await s.inbox.list();
    expect((await h.call(`${path}/messages/${m!.id}/delete`, { form: {} })).status).toBe(303);
    expect(await s.inbox.list()).toHaveLength(0);
  });

  it("does not show another seller's messages", async () => {
    const owner = harness();
    await owner.login(uniqueEmail());
    const path = await owner.newSite("Cudza skrzynka", "business-card");
    const other = harness();
    await other.login(uniqueEmail());
    expect((await other.call(`${path}/messages`)).status).toBe(404);
  });
});
