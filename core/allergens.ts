import { ValidationError } from "./catalog";

/** The 14 allergens that EU law (Regulation 1169/2011, annex II) requires restaurants to disclose. */
export const ALLERGENS = [
  { id: "gluten", label: "Gluten" },
  { id: "crustaceans", label: "Skorupiaki" },
  { id: "eggs", label: "Jaja" },
  { id: "fish", label: "Ryby" },
  { id: "peanuts", label: "Orzeszki ziemne" },
  { id: "soy", label: "Soja" },
  { id: "milk", label: "Mleko" },
  { id: "nuts", label: "Orzechy" },
  { id: "celery", label: "Seler" },
  { id: "mustard", label: "Gorczyca" },
  { id: "sesame", label: "Sezam" },
  { id: "sulphites", label: "Siarczyny" },
  { id: "lupin", label: "Łubin" },
  { id: "molluscs", label: "Mięczaki" },
] as const;

export type AllergenId = (typeof ALLERGENS)[number]["id"];

const IDS = new Set<string>(ALLERGENS.map((a) => a.id));

/** Validates, removes duplicates and keeps the legal order, so the menu always lists them the same way. */
export function cleanAllergens(ids: readonly string[]): AllergenId[] {
  for (const id of ids) if (!IDS.has(id)) throw new ValidationError(`Unknown allergen: ${id}`);
  return ALLERGENS.map((a) => a.id).filter((id) => ids.includes(id));
}

/** Reads the stored column. Unknown ids (e.g. from a newer version) are skipped, never shown raw. */
export function parseAllergens(stored: string): AllergenId[] {
  return ALLERGENS.map((a) => a.id).filter((id) => stored.split(",").includes(id));
}

/** Number of an allergen in the legal list (1–14), used as a short mark next to dishes. */
export const allergenNumber = (id: AllergenId) => ALLERGENS.findIndex((a) => a.id === id) + 1;

/** End of the current day in Poland, as unix time. Used for "brak dziś": the dish comes back by itself tomorrow. */
export function endOfDayInPoland(at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at * 1000))
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) / 1000;
  const offset = wall - at;
  return Date.UTC(parts.year!, parts.month! - 1, parts.day! + 1) / 1000 - offset;
}
