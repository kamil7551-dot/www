import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Item } from "./catalog";
import type { SiteSettings } from "./settings";
import type { Tenant } from "./tenants";

/** Places in a page where modules may add content. Only add new names; never rename one. */
export interface SlotData {
  /** Inside <head>: meta tags, tiny styles. */
  head: Record<string, never>;
  "home.top": Record<string, never>;
  "home.bottom": Record<string, never>;
  /** Under each item on a list, e.g. "Dodaj do koszyka", allergen icons. */
  "item.after": { item: Item };
  footer: Record<string, never>;
}

export type SlotName = keyof SlotData;

export interface SlotContext {
  tenant: Tenant;
  settings: SiteSettings;
}

export type SlotRenderer<S extends SlotName> = (
  data: SlotData[S],
  ctx: SlotContext,
) => HtmlEscapedString | Promise<HtmlEscapedString> | string;

/** Joins the output of several modules for one slot. A module that throws is skipped and logged. */
export async function renderSlot<S extends SlotName>(
  renderers: { source: string; render: SlotRenderer<S> }[],
  data: SlotData[S],
  ctx: SlotContext,
  log: (message: string, error: unknown) => void = (m, e) => console.error(m, e),
): Promise<HtmlEscapedString> {
  const parts: string[] = [];
  for (const { source, render } of renderers) {
    try {
      const out = await render(data, ctx);
      // Plain strings from modules are escaped; only html`` results pass through as markup.
      parts.push(typeof out === "string" && !(out as { isEscaped?: boolean }).isEscaped ? (await html`${out}`).toString() : out.toString());
    } catch (error) {
      log(`Slot "${source}" failed in "${String(ctx.tenant.slug)}"`, error);
    }
  }
  return raw(parts.join(""));
}
