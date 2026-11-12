import { env } from "cloudflare:workers";
import { EventBus, ModuleRegistry, ThemeRegistry, forTenant, type Platform } from "../core";
import businessCardTheme from "../themes/business-card";
import qrCardTheme from "../themes/qr-card";
import simpleTheme from "../themes/simple";

export * from "../core";
export type { Mail } from "../core";

export function forTenantForTest(tenantId: string, platform?: Platform) {
  return forTenant(platform ?? testPlatform(), env.DB, tenantId);
}

export function testPlatform(): Platform {
  return { bus: new EventBus(), modules: new ModuleRegistry(), themes: new ThemeRegistry().register(businessCardTheme, qrCardTheme, simpleTheme) };
}
