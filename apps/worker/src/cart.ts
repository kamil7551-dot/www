import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { MAX_CART_LINES, MAX_QTY, type CartLine } from "../../../core";

/**
 * The cart lives in a cookie of the shop's own domain: no account, no database rows for
 * abandoned carts, nothing to clean up. It holds only item ids and quantities; prices are
 * always taken from the catalog, so editing the cookie gains nothing.
 */
const COOKIE = "cart";
const ID = /^[0-9a-f-]{36}$/;

export function readCart(c: Context): CartLine[] {
  const raw = getCookie(c, COOKIE);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l): l is [string, number] => Array.isArray(l) && typeof l[0] === "string" && ID.test(l[0]) && Number.isInteger(l[1]) && l[1] > 0)
      .slice(0, MAX_CART_LINES)
      .map(([itemId, qty]) => ({ itemId, qty: Math.min(qty, MAX_QTY) }));
  } catch {
    return [];
  }
}

export function writeCart(c: Context, cart: CartLine[]): void {
  const lines = cart.filter((l) => l.qty > 0).slice(0, MAX_CART_LINES);
  if (!lines.length) {
    deleteCookie(c, COOKIE, { path: "/" });
    return;
  }
  setCookie(c, COOKIE, encodeURIComponent(JSON.stringify(lines.map((l) => [l.itemId, l.qty]))), {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Sets the quantity of one item (0 removes it); `add` adds to what is already there. */
export function changeCart(cart: CartLine[], itemId: string, qty: number, add = false): CartLine[] {
  const current = cart.find((l) => l.itemId === itemId)?.qty ?? 0;
  const next = Math.max(0, Math.min(MAX_QTY, add ? current + qty : qty));
  const rest = cart.filter((l) => l.itemId !== itemId);
  return next ? (current ? cart.map((l) => (l.itemId === itemId ? { itemId, qty: next } : l)) : [...rest, { itemId, qty: next }]) : rest;
}

export const cartCount = (cart: CartLine[]) => cart.reduce((n, l) => n + l.qty, 0);
