import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { createApp } from "../apps/worker/src/index";
import type { Mail } from "./core-under-test";

const PANEL = "https://panel.localhost";

export function harness() {
  const outbox: Mail[] = [];
  const app = createApp({ mailer: () => ({ send: async (m) => void outbox.push(m) }) });
  let cookie = "";
  const call = async (
    path: string,
    init: RequestInit & { form?: Record<string, string>; multipart?: FormData; origin?: string | null } = {},
  ) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    const posting = Boolean(init.form || init.multipart);
    if (init.form) headers.set("content-type", "application/x-www-form-urlencoded");
    if (posting && init.origin !== null) headers.set("origin", init.origin ?? PANEL);
    const req = new Request(`${PANEL}${path}`, {
      method: posting ? "POST" : (init.method ?? "GET"),
      headers,
      body: init.form ? new URLSearchParams(init.form).toString() : init.multipart,
      redirect: "manual",
    });
    const res = await app.fetch(req, env, createExecutionContext());
    const set = res.headers.get("set-cookie");
    if (set?.startsWith("__Host-sid=")) cookie = set.split(";")[0]!;
    return res;
  };
  const tokenFrom = (mail: Mail) => new URL(mail.text.match(/https:\S+/)![0]).searchParams.get("t")!;
  const login = async (email: string) => {
    await call("/login", { form: { email } });
    const res = await call("/login/verify", { form: { t: tokenFrom(outbox.at(-1)!) } });
    expect(res.status).toBe(303);
  };
  /** Logs in, creates a site and returns its panel URL, e.g. /sites/<id>. */
  const newSite = async (name: string, kind = "shop") => {
    const res = await call("/sites", { form: { name, kind } });
    return res.headers.get("location")!;
  };
  return { outbox, call, tokenFrom, login, newSite, setCookie: (c: string) => (cookie = c), getCookie: () => cookie };
}

export const uniqueEmail = () => `user-${crypto.randomUUID().slice(0, 8)}@example.com`;

