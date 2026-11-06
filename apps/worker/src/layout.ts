import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export const page = (title: string, body: Html) => html`<!doctype html>
  <html lang="pl">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>${title}</title>
      <style>
        body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
        input,select,button{font:inherit;padding:.4rem .6rem}button{cursor:pointer}
        .muted{color:#666}.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
      </style>
    </head>
    <body>
      ${body}
    </body>
  </html>`;

export const zl = (grosze: number) => (grosze / 100).toLocaleString("pl-PL", { style: "currency", currency: "PLN" });

/** "29,99" or "29.99" or "30" -> 2999 grosze. Returns null for anything else. */
export function parsePrice(input: string): number | null {
  const m = input.trim().replace(/\s|zł/gi, "").match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
