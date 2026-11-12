import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../apps/worker/src/index";
import { ValidationError, forTenantForTest } from "./core-under-test";
import { createTenant } from "./helpers";
import { harness, uniqueEmail } from "./panel-harness";

async function site(slug: string, kind: "shop" | "qr-menu" | "business-card") {
  const id = await createTenant(kind);
  await env.DB.prepare("UPDATE tenants SET slug = ?2, name = ?3 WHERE id = ?1").bind(id, slug, `Firma ${slug}`).run();
  return { id, ...forTenantForTest(id) };
}

const app = createApp({ mailer: () => ({ send: async () => {} }) });
const get = async (slug: string, path: string) => {
  const res = await app.fetch(new Request(`https://${slug}.localhost${path}`), env, createExecutionContext());
  return { status: res.status, body: await res.text() };
};

describe("legal pages", () => {
  it("fills the shop terms, privacy policy and withdrawal page from the settings", async () => {
    const s = await site("prawo-sklep", "shop");
    await s.settings.update({
      companyName: "Jan Kowalski Kawa",
      nip: "526-025-02-74",
      address: "ul. Prosta 1, Kraków",
      email: "sklep@kawa.pl",
      pickup: true,
      extraTerms: "Paczki wysyłamy <b>codziennie</b>.",
    });
    const terms = await get("prawo-sklep", "/regulamin");
    expect(terms.status).toBe(200);
    expect(terms.body).toContain("Jan Kowalski Kawa");
    expect(terms.body).toContain("NIP 5260250274");
    expect(terms.body).toContain("odbiór osobisty");
    expect(terms.body).toContain("Paczki wysyłamy &lt;b&gt;codziennie&lt;/b&gt;.");
    expect((await get("prawo-sklep", "/polityka-prywatnosci")).body).toContain("sklep@kawa.pl");
    expect((await get("prawo-sklep", "/odstapienie")).body).toContain("14 dni");
    const home = await get("prawo-sklep", "/");
    for (const href of ["/regulamin", "/odstapienie", "/polityka-prywatnosci"]) expect(home.body).toContain(`href="${href}"`);
  });

  it("gives other sites only a privacy policy", async () => {
    for (const kind of ["business-card", "qr-menu"] as const) {
      const slug = `prawo-${kind}`;
      await site(slug, kind);
      expect((await get(slug, "/polityka-prywatnosci")).status).toBe(200);
      expect((await get(slug, "/regulamin")).status).toBe(404);
      expect((await get(slug, "/odstapienie")).status).toBe(404);
      const home = await get(slug, "/");
      expect(home.body).toContain('href="/polityka-prywatnosci"');
      expect(home.body).not.toContain('href="/regulamin"');
    }
  });

  it("checks the NIP check digit", async () => {
    const s = await site("prawo-nip", "shop");
    await expect(s.settings.update({ nip: "5260250275" })).rejects.toThrow(ValidationError);
    await expect(s.settings.update({ nip: "123" })).rejects.toThrow(ValidationError);
    expect((await s.settings.update({ nip: "" })).nip).toBe("");
  });

  it("lets the owner fill in company data in the panel", async () => {
    const h = harness();
    await h.login(uniqueEmail());
    const url = await h.newSite("Kawiarnia Prawna");
    const id = url.split("/").at(-1)!;
    const form = (extra: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(extra)) f.set(k, v);
      return f;
    };
    expect((await h.call(`${url}/settings`)).status).toBe(200);
    const bad = await h.call(`${url}/settings`, { multipart: form({ nip: "5260250275" }) });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("NIP");
    const ok = await h.call(`${url}/settings`, { multipart: form({ companyName: "Kawa Sp. z o.o.", nip: "5260250274", extraTerms: "Rabaty nie łączą się." }) });
    expect(ok.status).toBe(303);
    expect(await forTenantForTest(id).settings.get()).toMatchObject({ companyName: "Kawa Sp. z o.o.", nip: "5260250274", extraTerms: "Rabaty nie łączą się." });
  });
});
