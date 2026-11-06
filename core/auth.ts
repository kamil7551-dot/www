/**
 * Passwordless login with one-time e-mail links, and panel sessions.
 * Security model: docs/SECURITY.md. Accounts are global, so this file uses raw D1, not TenantDb.
 */

export const LOGIN_TTL = 15 * 60; // a link works for 15 minutes
export const SESSION_IDLE_TTL = 30 * 24 * 3600; // a session ends after 30 days without use
export const SESSION_MAX_AGE = 90 * 24 * 3600; // and after 90 days in any case
export const LIMIT_WINDOW = 15 * 60;
export const LIMIT_PER_EMAIL = 3;
export const LIMIT_PER_IP = 10;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const now = (): number => Math.floor(Date.now() / 1000);

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export type LoginRequest = { ok: true; token: string; email: string } | { ok: false; reason: "invalid" | "rate-limited" };

/** Creates a one-time login token. The caller must answer the visitor the same way whatever this returns. */
export async function requestLogin(db: D1Database, rawEmail: string, ip: string, at = now()): Promise<LoginRequest> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, reason: "invalid" };
  const ipHash = await sha256(`ip:${ip}`);
  const since = at - LIMIT_WINDOW;
  const counts = await db
    .prepare(
      `SELECT
         (SELECT count(*) FROM login_tokens WHERE email = ?1 AND created_at > ?3) AS by_email,
         (SELECT count(*) FROM login_tokens WHERE ip_hash = ?2 AND created_at > ?3) AS by_ip`,
    )
    .bind(email, ipHash, since)
    .first<{ by_email: number; by_ip: number }>();
  if (!counts || counts.by_email >= LIMIT_PER_EMAIL || counts.by_ip >= LIMIT_PER_IP) {
    return { ok: false, reason: "rate-limited" };
  }
  const token = randomToken();
  await db
    .prepare(`INSERT INTO login_tokens (token_hash, email, ip_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(await sha256(token), email, ipHash, at, at + LOGIN_TTL)
    .run();
  return { ok: true, token, email };
}

/**
 * Uses up a login token (once, atomically) and opens a session.
 * Every other unused link for the same e-mail stops working too.
 */
export async function consumeLogin(
  db: D1Database,
  token: string,
  userAgent: string,
  at = now(),
): Promise<{ sessionToken: string; userId: string } | null> {
  if (!token || token.length > 100) return null;
  const row = await db
    .prepare(
      `UPDATE login_tokens SET used_at = ?2
       WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2
       RETURNING email`,
    )
    .bind(await sha256(token), at)
    .first<{ email: string }>();
  if (!row) return null;

  const user = await db
    .prepare(
      `INSERT INTO users (id, email) VALUES (?1, ?2)
       ON CONFLICT (email) DO UPDATE SET email = excluded.email
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), row.email)
    .first<{ id: string }>();
  await db.batch([
    db.prepare(`UPDATE login_tokens SET used_at = ?2 WHERE email = ?1 AND used_at IS NULL`).bind(row.email, at),
    db.prepare(`DELETE FROM login_tokens WHERE created_at < ?1`).bind(at - 7 * 24 * 3600),
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?1`).bind(at),
  ]);
  const sessionToken = await createSession(db, user!.id, userAgent, at);
  return { sessionToken, userId: user!.id };
}

export async function createSession(db: D1Database, userId: string, userAgent: string, at = now()): Promise<string> {
  const token = randomToken();
  await db
    .prepare(`INSERT INTO sessions (id_hash, user_id, created_at, expires_at, user_agent) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(await sha256(token), userId, at, at + SESSION_IDLE_TTL, userAgent.slice(0, 200))
    .run();
  return token;
}

export interface SessionUser {
  userId: string;
  email: string;
}

/** Finds a live session and slides its idle expiry forward (never past the absolute maximum). */
export async function getSession(db: D1Database, token: string | undefined, at = now()): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const idHash = await sha256(token);
  const row = await db
    .prepare(
      `SELECT s.user_id, s.created_at, s.expires_at, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = ?1 AND s.expires_at > ?2 AND s.created_at > ?3`,
    )
    .bind(idHash, at, at - SESSION_MAX_AGE)
    .first<{ user_id: string; created_at: number; expires_at: number; email: string }>();
  if (!row) return null;
  if (row.expires_at - at < SESSION_IDLE_TTL - 24 * 3600) {
    const next = Math.min(at + SESSION_IDLE_TTL, row.created_at + SESSION_MAX_AGE);
    await db.prepare(`UPDATE sessions SET expires_at = ?2 WHERE id_hash = ?1`).bind(idHash, next).run();
  }
  return { userId: row.user_id, email: row.email };
}

export async function destroySession(db: D1Database, token: string | undefined): Promise<void> {
  if (token) await db.prepare(`DELETE FROM sessions WHERE id_hash = ?1`).bind(await sha256(token)).run();
}

/** Logs the user out everywhere, e.g. after a suspected leak. */
export async function destroyAllSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(userId).run();
}

export interface UserSite {
  id: string;
  slug: string;
  name: string;
  kind: string;
  role: "owner" | "staff";
}

export async function sitesOf(db: D1Database, userId: string): Promise<UserSite[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.slug, t.name, t.kind, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = ?1 ORDER BY t.name`,
    )
    .bind(userId)
    .all<UserSite>();
  return results;
}

/** The only gate between a logged-in user and a site's data. Use it on every panel route that takes a site id. */
export async function membership(db: D1Database, userId: string, tenantId: string): Promise<"owner" | "staff" | null> {
  const row = await db
    .prepare(`SELECT role FROM memberships WHERE user_id = ?1 AND tenant_id = ?2`)
    .bind(userId, tenantId)
    .first<{ role: "owner" | "staff" }>();
  return row?.role ?? null;
}
