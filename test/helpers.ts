import { env } from "cloudflare:workers";
import { newId } from "../core";

export async function createTenant(kind: "business-card" | "qr-menu" | "shop" = "shop"): Promise<string> {
  const id = newId();
  await env.DB.prepare(`INSERT INTO tenants (id, slug, name, kind) VALUES (?1, ?2, ?3, ?4)`)
    .bind(id, `t-${id.slice(0, 8)}`, "Test", kind)
    .run();
  return id;
}
