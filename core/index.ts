import { Catalog } from "./catalog";
import { TenantDb } from "./db";
import type { CoreEvents, EventBus, EventName } from "./events";
import type { ModuleRegistry } from "./modules";
import { Inbox } from "./contact";
import { Settings } from "./settings";
import { renderSlot, type SlotContext, type SlotData, type SlotName } from "./slots";
import type { ThemeRegistry } from "./themes";

export interface Platform {
  bus: EventBus;
  modules: ModuleRegistry;
  themes: ThemeRegistry;
}

/** Everything the core offers for one tenant during one request. */
export function forTenant(platform: Platform, d1: D1Database, tenantId: string) {
  const db = new TenantDb(d1, tenantId);
  let enabled: Promise<Set<string>> | undefined;
  const enabledModules = () => (enabled ??= platform.modules.enabledFor(db));
  const emit = async <E extends EventName>(event: E, payload: CoreEvents[E]) => {
    const active = await enabledModules();
    await platform.bus.emit(event, payload, { tenantId }, (source) => source === "core" || active.has(source));
  };
  const slot = async <S extends SlotName>(name: S, data: SlotData[S], ctx: SlotContext) =>
    renderSlot(platform.modules.slotRenderers(name, await enabledModules()), data, ctx);
  return { db, catalog: new Catalog(db, emit), settings: new Settings(db), inbox: new Inbox(db), enabledModules, slot };
}

export { Catalog, ValidationError, isSoldOut } from "./catalog";
export { ALLERGENS, allergenNumber, cleanAllergens, endOfDayInPoland, parseAllergens, type AllergenId } from "./allergens";
export type { Category, Item, ItemKind, ItemStatus, NewItem } from "./catalog";
export { TenantDb, newId } from "./db";
export { EventBus } from "./events";
export type { CoreEvents, EventName } from "./events";
export { ModuleRegistry, defineModule } from "./modules";
export type { ModuleDefinition } from "./modules";
export { slugify } from "./slug";
export { CONTACT_LIMIT_PER_IP_HOUR, Inbox } from "./contact";
export type { ContactMessage } from "./contact";
export { itemSeoHead, robotsTxt, safeJson, seoHead, sitemapXml } from "./seo";
export { DEFAULT_SETTINGS, Settings, cleanSettings } from "./settings";
export type { SiteSettings } from "./settings";
export type { SlotData, SlotName, SlotRenderer } from "./slots";
export { ThemeRegistry, defineTheme } from "./themes";
export type { Html, HomeView, PageView, ThemeDefinition } from "./themes";
export { IMAGE_TYPES, IMAGE_WIDTHS, MAX_IMAGE_BYTES, Media, MediaError } from "./media";
export { RESERVED_SLUGS, cachedTenantResolver, resolveTenant } from "./tenants";
export { TtlCache } from "./cache";
export * as auth from "./auth";
export { ConsoleMailer, ResendMailer } from "./mailer";
export type { Mail, Mailer } from "./mailer";
export type { SiteKind, Tenant } from "./tenants";
export { qrMatrix, qrPng, qrSvg } from "./qr";
