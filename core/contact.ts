import { normalizeEmail, now, sha256 } from "./auth";
import { newId, type TenantDb } from "./db";

export const CONTACT_LIMIT_PER_IP_HOUR = 5;
export const CONTACT_LIMIT_PER_SITE_DAY = 100;

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  created_at: number;
  read_at: number | null;
}

export type ContactResult =
  | { ok: true; message: ContactMessage }
  | { ok: false; reason: "invalid" | "rate-limited" | "spam" };

/** Contact form inbox of one site. */
export class Inbox {
  constructor(private db: TenantDb) {}

  /**
   * Validates and stores a message. `trap` is a hidden form field people never fill in;
   * bots that fill it are told "ok" by the caller but nothing is stored or sent.
   */
  async submit(
    input: { name: string; email: string; phone?: string; message: string; trap?: string },
    ip: string,
    at = now(),
  ): Promise<ContactResult> {
    if (input.trap) return { ok: false, reason: "spam" };
    const name = input.name.trim().slice(0, 100);
    const email = normalizeEmail(input.email);
    const phone = (input.phone ?? "").trim().slice(0, 30);
    const message = input.message.trim().slice(0, 4000);
    if (!name || !email || message.length < 2) return { ok: false, reason: "invalid" };

    const ipHash = await sha256(`contact-ip:${ip}`);
    const counts = await this.db.first<{ by_ip: number; by_site: number }>(
      `SELECT
         (SELECT count(*) FROM contact_messages WHERE tenant_id = ?1 AND ip_hash = ?2 AND created_at > ?3) AS by_ip,
         (SELECT count(*) FROM contact_messages WHERE tenant_id = ?1 AND created_at > ?4) AS by_site`,
      ipHash,
      at - 3600,
      at - 86400,
    );
    if (!counts || counts.by_ip >= CONTACT_LIMIT_PER_IP_HOUR || counts.by_site >= CONTACT_LIMIT_PER_SITE_DAY) {
      return { ok: false, reason: "rate-limited" };
    }
    const id = newId();
    await this.db.run(
      `INSERT INTO contact_messages (tenant_id, id, name, email, phone, message, ip_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      id,
      name,
      email,
      phone,
      message,
      ipHash,
      at,
    );
    return { ok: true, message: { id, name, email, phone, message, created_at: at, read_at: null } };
  }

  list(limit = 100): Promise<ContactMessage[]> {
    return this.db.all<ContactMessage>(
      `SELECT id, name, email, phone, message, created_at, read_at FROM contact_messages
       WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT ?2`,
      limit,
    );
  }

  async unreadCount(): Promise<number> {
    const row = await this.db.first<{ n: number }>(
      `SELECT count(*) AS n FROM contact_messages WHERE tenant_id = ?1 AND read_at IS NULL`,
    );
    return row?.n ?? 0;
  }

  async markAllRead(at = now()): Promise<void> {
    await this.db.run(`UPDATE contact_messages SET read_at = ?2 WHERE tenant_id = ?1 AND read_at IS NULL`, at);
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run(`DELETE FROM contact_messages WHERE tenant_id = ?1 AND id = ?2`, id)) > 0;
  }
}
