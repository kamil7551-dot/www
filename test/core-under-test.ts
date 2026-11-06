import { env } from "cloudflare:workers";
import { EventBus, ModuleRegistry, forTenant, type Platform } from "../core";

export * from "../core";
export type { Mail } from "../core";

export function forTenantForTest(tenantId: string, platform?: Platform) {
  return forTenant(platform ?? { bus: new EventBus(), modules: new ModuleRegistry() }, env.DB, tenantId);
}
