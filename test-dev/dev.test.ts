import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { d1Shim, type DevDatabase } from "../apps/worker/src/dev/database";

const ORIGIN = "https://www-dev.example.workers.dev";
const devEnv = env as unknown as { DEV_DB: DurableObjectNamespace<DevDatabase> };

function browser() {
  let cookie = "";
  return async (path: string, form?: Record<string, string>, origin = ORIGIN) => {
    const headers = new Headers();
    if (cookie) headers.set("cookie", cookie);
    if (form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      headers.set("origin", origin);
    }
    const res = await exports.default.fetch(
      new Request(ORIGIN + path, { method: form ? "POST" : "GET", headers, body: form ? new URLSearchParams(form) : undefined, redirect: "manual" }),
    );
    const set = res.headers.get("set-cookie");
    if (set?.startsWith("__Host-sid=")) cookie = set.split(";")[0]!;
    return { status: res.status, location: res.headers.get("location"), headers: res.headers, body: await res.text() };
  };
}

async function login(go: ReturnType<typeof browser>, email = "kamil@example.com") {
  const sent = await go("/panel/login", { email, password: "testowe-haslo-123" });
  expect(sent.status).toBe(303);
  expect(sent.location).toMatch(/^\/panel\/login\/verify\?t=/);
  const t = new URL(ORIGIN + sent.location!).searchParams.get("t")!;
  expect((await go("/panel/login/verify", { t })).status).toBe(303);
}

describe("dev database (Durable Object posing as D1)", () => {
  it("runs the app's migrations and D1-style queries", async () => {
    const db = d1Shim(devEnv.DEV_DB);
    await db.prepare("INSERT INTO tenants (id, slug, name, kind) VALUES (?1, ?2, ?3, ?4)").bind("t1", "baza", "Baza", "qr-menu").run();
    expect(await db.prepare("SELECT name FROM tenants WHERE slug = ?1").bind("baza").first()).toEqual({ name: "Baza" });
    expect(await db.prepare("SELECT name FROM tenants WHERE slug = ?1").bind("brak").first()).toBeNull();
    const res = await db.prepare("UPDATE tenants SET name = ?2 WHERE id = ?1").bind("t1", "Nowa").run();
    expect(res.meta.changes).toBe(1);
    await expect(db.prepare("INSERT INTO tenants (id, slug, name, kind) VALUES ('t2', 'baza', 'X', 'qr-menu')").run()).rejects.toThrow(/UNIQUE/);
  });

  it("rolls back a whole batch when one statement fails", async () => {
    const db = d1Shim(devEnv.DEV_DB);
    await expect(
      db.batch([
        db.prepare("INSERT INTO tenants (id, slug, name, kind) VALUES ('t3', 'raz', 'Raz', 'qr-menu')"),
        db.prepare("INSERT INTO tenants (id, slug, name, kind) VALUES ('t4', 'raz', 'Dwa', 'qr-menu')"),
      ]),
    ).rejects.toThrow();
    expect(await db.prepare("SELECT 1 FROM tenants WHERE id = 't3'").first()).toBeNull();
  });
});

describe("dev deployment on one address", () => {
  it("sends the start page to the panel and hides everything from search engines", async () => {
    const go = browser();
    const start = await go("/");
    expect(start.location).toBe(`${ORIGIN}/panel/`);
    const loginPage = await go("/panel/login");
    expect(loginPage.headers.get("x-robots-tag")).toBe("noindex");
    expect(loginPage.body).toContain('action="/panel/login"');
    expect(loginPage.body).toContain('href="/panel/assets/panel.css');
    expect((await go("/cokolwiek")).status).toBe(404);
  });

  it("logs in with the test password only", async () => {
    const go = browser();
    const wrong = await go("/panel/login", { email: "ktos@example.com", password: "zgaduje" });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toContain("Złe hasło testowe");
    expect((await go("/panel/login", { email: "ktos@example.com", password: "testowe-haslo-123" }, "https://evil.example")).status).toBe(403);
    await login(go);
    expect((await go("/panel/")).body).toContain("kamil@example.com");
  });

  it("creates a QR menu, shows it under /s/<slug>/ and points the QR code there", async () => {
    const go = browser();
    await login(go, "menu@example.com");
    const home = await go("/panel/");
    expect(home.body).toContain('value="qr-menu"');
    expect(home.body).not.toContain('value="shop"');
    expect((await go("/panel/sites", { name: "Bistro Pod Lipą", kind: "shop" })).status).toBe(400);

    const created = await go("/panel/sites", { name: "Bistro Pod Lipą", kind: "qr-menu" });
    expect(created.location).toMatch(/^\/panel\/sites\/[\w-]+$/);
    const qr = await go(`${created.location}/qr`);
    expect(qr.body).toContain(`${ORIGIN}/s/bistro-pod-lipa/`);

    const site = await go("/s/bistro-pod-lipa/");
    expect(site.status).toBe(200);
    expect(site.body).toContain("Bistro Pod Lipą");
    expect(site.body).toContain('href="/s/bistro-pod-lipa/polityka-prywatnosci"');
    expect(site.body).toContain(`${ORIGIN}/s/bistro-pod-lipa/`); // canonical
    expect(site.body).not.toContain("dev.invalid\"");
    expect((await go("/s/bistro-pod-lipa/polityka-prywatnosci")).status).toBe(200);
  });

  it("does not let a client fake the public origin", async () => {
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}/panel/login`, { headers: { "x-dev-public-origin": "https://evil.example" } }),
    );
    expect(await res.text()).not.toContain("evil.example");
  });
});
