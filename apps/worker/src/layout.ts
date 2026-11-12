/** Shared formatting helpers for panel and storefront. */

export const zl = (grosze: number) => (grosze / 100).toLocaleString("pl-PL", { style: "currency", currency: "PLN" });

export { parsePrice } from "../../../core/browse";
