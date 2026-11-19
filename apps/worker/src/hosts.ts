/**
 * Single-address mode, for the dev deployment on <name>.<account>.workers.dev, where wildcard
 * subdomains do not exist. Turned on by the SINGLE_HOST variable (dev config only); the public
 * origin is the one the request came in on.
 *
 *   PUBLIC_ORIGIN/panel/...     is served as  https://panel.<PLATFORM_DOMAIN>/...
 *   PUBLIC_ORIGIN/s/<slug>/...  is served as  https://<slug>.<PLATFORM_DOMAIN>/...
 *
 * The panel and storefront keep working on their own virtual hosts, untouched. This file maps
 * requests in and maps links, redirects and cookie paths in the responses back out.
 * Production uses real subdomains and never goes through here.
 */

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface SingleHost {
  publicOrigin: string;
  platformDomain: string;
}

/** Set by serveSingleHost on every forwarded request (any value sent by a client is overwritten). */
export const PUBLIC_ORIGIN_HEADER = "x-dev-public-origin";

const enabled = (env: Env) => (env as Env & { SINGLE_HOST?: string }).SINGLE_HOST === "1";

/** For the router: the request's own origin is the public one. */
export function singleHostFor(env: Env, req: Request): SingleHost | null {
  return enabled(env) ? { publicOrigin: new URL(req.url).origin, platformDomain: env.PLATFORM_DOMAIN } : null;
}

/** For the apps behind the router: read the public origin the router passed along. */
export function singleHostBehind(env: Env, header: string | undefined): SingleHost | null {
  return enabled(env) && header ? { publicOrigin: header, platformDomain: env.PLATFORM_DOMAIN } : null;
}

/** Public path prefix for a virtual host: "/panel" or "/s/<slug>". Null for hosts outside the platform. */
function prefixFor(h: SingleHost, host: string): string | null {
  const suffix = `.${h.platformDomain}`;
  if (!host.endsWith(suffix)) return null;
  const sub = host.slice(0, -suffix.length);
  if (sub === "panel") return "/panel";
  return SLUG.test(sub) ? `/s/${sub}` : null;
}

/** Virtual URL -> public URL. Anything that is not a platform URL comes back unchanged. */
export function toPublic(h: SingleHost | null, url: string): string {
  if (!h) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const prefix = prefixFor(h, u.hostname);
  return prefix ? `${h.publicOrigin}${prefix}${u.pathname}${u.search}${u.hash}` : url;
}

/** Public request -> the virtual URL it stands for, or null when the path is not a panel or site path. */
export function toVirtual(h: SingleHost, url: URL): { url: string; prefix: string } | null {
  const panel = url.pathname.match(/^\/panel(\/.*)?$/);
  if (panel) return { url: `https://panel.${h.platformDomain}${panel[1] ?? "/"}${url.search}`, prefix: "/panel" };
  const site = url.pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
  if (site && SLUG.test(site[1]!)) {
    return { url: `https://${site[1]}.${h.platformDomain}${site[2] ?? "/"}${url.search}`, prefix: `/s/${site[1]}` };
  }
  return null;
}

/** A link in a page: root-relative paths get the prefix, virtual absolute URLs become public. */
function mapLink(h: SingleHost, prefix: string, value: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) return prefix + value;
  return toPublic(h, value);
}

const LINK_ATTRS = ["href", "src", "action", "formaction", "content"] as const;

export async function serveSingleHost(h: SingleHost, req: Request, handle: (req: Request) => Promise<Response>): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/" || url.pathname === "/panel") return Response.redirect(`${h.publicOrigin}/panel/`, 302);
  const target = toVirtual(h, url);
  if (!target) return new Response("Nie znaleziono", { status: 404, headers: { "x-robots-tag": "noindex" } });

  const headers = new Headers(req.headers);
  // Both apps refuse posts from other origins. A post from our own public origin counts as theirs.
  if (headers.get("origin") === h.publicOrigin) headers.set("origin", new URL(target.url).origin);
  headers.set(PUBLIC_ORIGIN_HEADER, h.publicOrigin);
  const virtual = new Request(target.url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    redirect: "manual",
  });
  const res = await handle(virtual);

  const out = new Response(res.body, res);
  out.headers.set("x-robots-tag", "noindex");
  const location = res.headers.get("location");
  if (location) out.headers.set("location", mapLink(h, target.prefix, location));
  // Site cookies (the cart) stay with their own site instead of the whole dev address.
  if (target.prefix !== "/panel") {
    const cookies = res.headers.getSetCookie();
    if (cookies.length) {
      out.headers.delete("set-cookie");
      for (const cookie of cookies) out.headers.append("set-cookie", cookie.replace(/;\s*Path=\/(?=;|$)/i, `; Path=${target.prefix}/`));
    }
  }
  if (!(res.headers.get("content-type") ?? "").startsWith("text/html")) return out;

  let rewriter = new HTMLRewriter();
  for (const attr of LINK_ATTRS) {
    rewriter = rewriter.on(`[${attr}]`, {
      element(el) {
        const value = el.getAttribute(attr);
        if (value && (attr !== "content" || /^(https?:)?\//.test(value))) el.setAttribute(attr, mapLink(h, target.prefix, value));
      },
    });
  }
  rewriter = rewriter.on("[srcset]", {
    element(el) {
      const value = el.getAttribute("srcset") ?? "";
      el.setAttribute(
        "srcset",
        value
          .split(",")
          .map((part) => {
            const [src, ...rest] = part.trim().split(/\s+/);
            return [src ? mapLink(h, target.prefix, src) : "", ...rest].join(" ");
          })
          .join(", "),
      );
    },
  });
  return rewriter.transform(out);
}
