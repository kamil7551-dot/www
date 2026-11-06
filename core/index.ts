import { Catalog } from "./catalog";
import { TenantDb } from "./db";
import type { CoreEvents, EventBus, EventName } from "./events";
import type { ModuleRegistry } from "./modules";

export interface Platform {
  bus: EventBus;
  modules: ModuleRegistry;
}

/** Everything the core offers for one tenant during one request. */
export function forTenant(platform: Platform, d1: D1Database, tenantId: string) {
  const db = new TenantDb(d1, tenantId);
  let enabled: Promise<Set<string>> | undefined;
  const emit = async <E extends EventName>(event: E, payload: CoreEvents[E]) => {
    enabled ??= platform.modules.enabledFor(db);
    const active = await enabled;
    await platform.bus.emit(event, payload, { tenantId }, (source) => source === "core" || active.has(source));
  };
  return { db, catalog: new Catalog(db, emit) };
}

export { Catalog, ValidationError } from "./catalog";
export type { Category, Item, ItemKind, ItemStatus, NewItem } from "./catalog";
export { TenantDb, newId } from "./db";
export { EventBus } from "./events";
export type { CoreEvents, EventName } from "./events";
export { ModuleRegistry, defineModule } from "./modules";
export type { ModuleDefinition } from "./modules";
export { slugify } from "./slug";
export { Media, MediaError, IMAGE_TYPES, MAX_IMAGE_BYTES } from "./media";
export { resolveTenant } from "./tenants";
export type { SiteKind, Tenant } from "./tenants";
