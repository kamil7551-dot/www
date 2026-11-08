import { Hono } from "hono";
import {
  ConsoleMailer,
  EventBus,
  ModuleRegistry,
  ResendMailer,
  ThemeRegistry,
  type Mailer,
  type ModuleDefinition,
  type Platform,
} from "../../../core";
import simpleTheme from "../../../themes/simple";
import { panelApp } from "./panel";
import { storefrontApp } from "./storefront";

export interface Deps {
  mailer: (env: Env) => Mailer;
  /** Modules installed in the platform. Sites turn them on one by one in the panel. */
  modules?: ModuleDefinition[];
}

const defaultMailer = (env: Env): Mailer => {
  const key = (env as Env & { RESEND_API_KEY?: string }).RESEND_API_KEY;
  return key ? new ResendMailer(key, `Logowanie <no-reply@${env.PLATFORM_DOMAIN}>`) : new ConsoleMailer();
};

export function createApp(deps: Deps = { mailer: defaultMailer }) {
  const platform: Platform = {
    bus: new EventBus(),
    modules: new ModuleRegistry().register(...(deps.modules ?? [])),
    themes: new ThemeRegistry().register(simpleTheme),
  };
  platform.modules.attach(platform.bus);
  const panel = panelApp(platform, deps.mailer);
  const store = storefrontApp(platform);

  const app = new Hono<{ Bindings: Env }>();
  app.get("/health", async (c) => {
    const row = await c.env.DB.prepare("SELECT count(*) AS tenants FROM tenants").first<{ tenants: number }>();
    return c.json({ ok: true, tenants: row?.tenants ?? 0 });
  });
  // The panel lives only on panel.<platform domain>, so seller cookies never reach shop domains.
  app.all("*", (c) => {
    const isPanel = new URL(c.req.url).hostname === `panel.${c.env.PLATFORM_DOMAIN}`;
    return (isPanel ? panel : store).fetch(c.req.raw, c.env, c.executionCtx);
  });
  return app;
}

export default createApp();
