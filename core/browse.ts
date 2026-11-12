import type { Category, Item } from "./catalog";

/**
 * Customer-side browsing of a shop: search, category, price range, sorting and pages.
 * Pure functions over the active items, so a shop of a few thousand products needs one
 * D1 read per page view. Move to SQL (FTS5) only when a shop outgrows that.
 */

export const SORTS = {
  polecane: "Polecane",
  "cena-rosnaco": "Cena: od najniższej",
  "cena-malejaco": "Cena: od najwyższej",
  nazwa: "Nazwa: A–Z",
  nowosci: "Najnowsze",
} as const;
export type Sort = keyof typeof SORTS;

export const PER_PAGE = 24;
const MAX_QUERY = 80;

export interface BrowseQuery {
  q: string;
  sort: Sort;
  /** Grosze, inclusive. */
  min: number | null;
  max: number | null;
  page: number;
}

export interface BrowseResult {
  query: BrowseQuery;
  items: Item[];
  total: number;
  page: number;
  pages: number;
  /** Cheapest and dearest price among the items that match everything except the price filter. */
  priceRange: { min: number; max: number } | null;
}

/** "29,99" or "29.99" or "30" -> 2999 grosze. Returns null for anything else. */
export function parsePrice(input: string): number | null {
  const m = input.trim().replace(/\s|zł/gi, "").match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** Reads a query string leniently: anything odd falls back to the default, never an error page. */
export function parseBrowse(params: URLSearchParams): BrowseQuery {
  const sort = params.get("sort") ?? "";
  const page = Number(params.get("strona"));
  let min = parsePrice(params.get("od") ?? "");
  let max = parsePrice(params.get("do") ?? "");
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return {
    q: (params.get("q") ?? "").trim().slice(0, MAX_QUERY),
    sort: sort in SORTS ? (sort as Sort) : "polecane",
    min,
    max,
    page: Number.isInteger(page) && page > 1 ? Math.min(page, 10_000) : 1,
  };
}

/** Query string for a link that keeps the current filters, with some of them changed. */
export function browseHref(base: string, query: BrowseQuery, change: Partial<BrowseQuery> = {}): string {
  const q = { ...query, page: 1, ...change };
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.min !== null) p.set("od", groszeToField(q.min));
  if (q.max !== null) p.set("do", groszeToField(q.max));
  if (q.sort !== "polecane") p.set("sort", q.sort);
  if (q.page > 1) p.set("strona", String(q.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export const groszeToField = (g: number) => (g % 100 ? (g / 100).toFixed(2).replace(".", ",") : String(g / 100));

/** Lowercase, Polish letters folded ("Żółć" -> "zolc"), so customers can type without diacritics. */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase("pl")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** The category and all categories below it. */
export function categoryAndChildren(categories: Category[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of categories) {
      if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Items of the whole shop, or of one category with its subcategories when categoryId is given. */
export function browse(items: Item[], categories: Category[], query: BrowseQuery, categoryId?: string): BrowseResult {
  const inside = categoryId ? categoryAndChildren(categories, categoryId) : null;
  let list = inside ? items.filter((i) => i.category_id && inside.has(i.category_id)) : items;
  if (query.q) {
    // Every word must appear in the name or description, in any order.
    const words = fold(query.q).split(/\s+/).filter(Boolean);
    list = list.filter((i) => {
      const text = fold(`${i.name} ${i.description}`);
      return words.every((w) => text.includes(w));
    });
  }
  const prices = list.map((i) => i.price);
  const priceRange = prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
  if (query.min !== null) list = list.filter((i) => i.price >= query.min!);
  if (query.max !== null) list = list.filter((i) => i.price <= query.max!);

  const order = new Map(categories.map((c, n) => [c.id, n]));
  const rank = (i: Item) => (i.category_id ? (order.get(i.category_id) ?? categories.length) : categories.length);
  const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, "pl");
  const sorters: Record<Sort, (a: Item, b: Item) => number> = {
    // The order the seller set in the panel: categories first, then items inside each one.
    polecane: (a, b) => rank(a) - rank(b) || a.position - b.position,
    "cena-rosnaco": (a, b) => a.price - b.price || byName(a, b),
    "cena-malejaco": (a, b) => b.price - a.price || byName(a, b),
    nazwa: byName,
    nowosci: (a, b) => b.created_at - a.created_at || byName(a, b),
  };
  list = [...list].sort(sorters[query.sort]);

  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(query.page, pages);
  return { query, items: list.slice((page - 1) * PER_PAGE, page * PER_PAGE), total, page, pages, priceRange };
}
