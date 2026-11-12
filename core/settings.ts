import type { TenantDb } from "./db";
import { ValidationError } from "./catalog";
import { normalizeEmail } from "./auth";

/** Everything a seller can set about how the site looks and how to reach them. */
export interface SiteSettings {
  tagline: string;
  /** Longer "about us" text; blank lines split paragraphs. */
  about: string;
  email: string;
  phone: string;
  address: string;
  /** Free text, e.g. "Pn–Pt 9–17, Sob 10–14". */
  hours: string;
  /** #rrggbb */
  accent: string;
  logoKey: string | null;
  /** Theme id; empty = the default theme for the site kind. */
  theme: string;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  tagline: "",
  about: "",
  email: "",
  phone: "",
  address: "",
  hours: "",
  accent: "#2f6fed",
  logoKey: null,
  theme: "",
};

const LIMITS: Partial<Record<keyof SiteSettings, number>> = { tagline: 160, about: 3000, address: 200, hours: 200, phone: 30, theme: 40 };

/** Validates a partial update and returns the cleaned values. Throws ValidationError with a field name. */
export function cleanSettings(patch: Partial<Record<keyof SiteSettings, unknown>>): Partial<SiteSettings> {
  const out: Partial<SiteSettings> = {};
  for (const [key, raw] of Object.entries(patch) as [keyof SiteSettings, unknown][]) {
    if (!(key in DEFAULT_SETTINGS)) throw new ValidationError(`Unknown setting: ${key}`);
    if (key === "logoKey") {
      if (raw !== null && typeof raw !== "string") throw new ValidationError("logoKey");
      out.logoKey = raw === "" ? null : (raw as string | null);
      continue;
    }
    if (typeof raw !== "string") throw new ValidationError(key);
    const value = raw.trim();
    const max = LIMITS[key];
    if (max && value.length > max) throw new ValidationError(`${key}: max ${max} characters`);
    if (key === "email" && value && !normalizeEmail(value)) throw new ValidationError("email");
    if (key === "phone" && value && !/^\+?[\d\s()-]{6,30}$/.test(value)) throw new ValidationError("phone");
    if (key === "accent" && !/^#[0-9a-f]{6}$/i.test(value)) throw new ValidationError("accent");
    if (key === "theme" && value && !/^[a-z][a-z0-9-]*$/.test(value)) throw new ValidationError("theme");
    out[key] = key === "email" ? value.toLowerCase() : key === "accent" ? value.toLowerCase() : value;
  }
  return out;
}

export class Settings {
  constructor(private db: TenantDb) {}

  async get(): Promise<SiteSettings> {
    const row = await this.db.first<{ data: string }>(`SELECT data FROM tenant_settings WHERE tenant_id = ?1`);
    let stored: Partial<Record<keyof SiteSettings, unknown>>;
    try {
      stored = row ? JSON.parse(row.data) : {};
    } catch {
      stored = {};
    }
    // Re-validate on read, so a bad value saved by an old version can never reach a page.
    const safe: Partial<SiteSettings> = {};
    for (const [key, value] of Object.entries(stored)) {
      try {
        Object.assign(safe, cleanSettings({ [key]: value }));
      } catch {
        /* ignore invalid stored value, default wins */
      }
    }
    return { ...DEFAULT_SETTINGS, ...safe };
  }

  async update(patch: Partial<Record<keyof SiteSettings, unknown>>): Promise<SiteSettings> {
    const next = { ...(await this.get()), ...cleanSettings(patch) };
    await this.db.run(
      `INSERT INTO tenant_settings (tenant_id, data, updated_at) VALUES (?1, ?2, unixepoch())
       ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      JSON.stringify(next),
    );
    return next;
  }
}
