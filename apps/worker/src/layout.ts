/** Shared formatting helpers for panel and storefront. */

export const zl = (grosze: number) => (grosze / 100).toLocaleString("pl-PL", { style: "currency", currency: "PLN" });

/** "29,99" or "29.99" or "30" -> 2999 grosze. Returns null for anything else. */
export function parsePrice(input: string): number | null {
  const m = input.trim().replace(/\s|zł/gi, "").match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
