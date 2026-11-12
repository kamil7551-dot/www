import type { HtmlEscapedString } from "hono/utils/html";
import type { Category, Item } from "./catalog";
import type { SiteSettings } from "./settings";
import type { SlotName, SlotData } from "./slots";
import type { SiteKind, Tenant } from "./tenants";

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export interface HomeView {
  tenant: Tenant;
  settings: SiteSettings;
  items: Item[];
  categories: Category[];
  /** Renders what enabled modules put in a slot. Always safe to call; returns "" when nothing is there. */
  slot: <S extends SlotName>(name: S, data: SlotData[S]) => Promise<HtmlEscapedString>;
  /** Public URL of a media key (logo, item image); with a width, a resized WebP copy. */
  mediaUrl: (key: string, width?: number) => string;
}

export interface ThemeDefinition {
  /** kebab-case, unique, never changes. */
  id: string;
  name: string;
  /** Site kinds this theme can show. */
  kinds: SiteKind[];
  home: (view: HomeView) => Html;
}

export function defineTheme<const T extends ThemeDefinition>(def: T): T {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(def.id)) throw new Error(`Invalid theme id "${def.id}"`);
  if (!def.kinds.length) throw new Error(`Theme "${def.id}" must support at least one site kind`);
  return def;
}

export class ThemeRegistry {
  private themes = new Map<string, ThemeDefinition>();

  register(...defs: ThemeDefinition[]): this {
    for (const def of defs) {
      if (this.themes.has(def.id)) throw new Error(`Theme "${def.id}" is registered twice`);
      this.themes.set(def.id, def);
    }
    return this;
  }

  list(kind?: SiteKind): ThemeDefinition[] {
    return [...this.themes.values()].filter((t) => !kind || t.kinds.includes(kind));
  }

  /** The chosen theme if it fits the site kind, otherwise the first registered theme for that kind. */
  pick(kind: SiteKind, chosen: string): ThemeDefinition {
    const wanted = this.themes.get(chosen);
    if (wanted?.kinds.includes(kind)) return wanted;
    const fallback = this.list(kind)[0];
    if (!fallback) throw new Error(`No theme for site kind "${kind}"`);
    return fallback;
  }
}
