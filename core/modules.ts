import type { TenantDb } from "./db";
import type { EventBus, EventHandler, EventName } from "./events";

export interface SettingField {
  type: "text" | "number" | "boolean" | "secret";
  label: string;
  required?: boolean;
}

export interface ModuleDefinition {
  /** kebab-case, unique, never changes. */
  id: string;
  name: string;
  version: string;
  requires?: string[];
  settings?: Record<string, SettingField>;
  hooks?: { [E in EventName]?: EventHandler<E> };
}

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function defineModule<const M extends ModuleDefinition>(def: M): M {
  if (!ID_PATTERN.test(def.id)) throw new Error(`Invalid module id "${def.id}": use kebab-case`);
  if (!def.name.trim()) throw new Error(`Module "${def.id}" needs a name`);
  return def;
}

/** All modules installed in the platform. Which ones a tenant uses is stored in tenant_modules. */
export class ModuleRegistry {
  private modules = new Map<string, ModuleDefinition>();

  register(...defs: ModuleDefinition[]): this {
    for (const def of defs) {
      if (this.modules.has(def.id)) throw new Error(`Module "${def.id}" is registered twice`);
      this.modules.set(def.id, def);
    }
    return this;
  }

  get(id: string): ModuleDefinition | undefined {
    return this.modules.get(id);
  }

  list(): ModuleDefinition[] {
    return [...this.modules.values()];
  }

  /** Checks dependencies and connects every module's hooks to the bus. Call once at startup. */
  attach(bus: EventBus): void {
    for (const def of this.modules.values()) {
      for (const dep of def.requires ?? []) {
        if (!this.modules.has(dep)) throw new Error(`Module "${def.id}" requires missing module "${dep}"`);
      }
      for (const [event, handler] of Object.entries(def.hooks ?? {})) {
        bus.on(event as EventName, handler as EventHandler<EventName>, def.id);
      }
    }
  }

  async enabledFor(db: TenantDb): Promise<Set<string>> {
    const rows = await db.all<{ module_id: string }>(
      `SELECT module_id FROM tenant_modules WHERE tenant_id = ?1 AND enabled = 1`,
    );
    return new Set(rows.map((r) => r.module_id).filter((id) => this.modules.has(id)));
  }

  async enable(db: TenantDb, id: string, settings: Record<string, unknown> = {}): Promise<void> {
    const def = this.modules.get(id);
    if (!def) throw new Error(`Unknown module "${id}"`);
    const enabled = await this.enabledFor(db);
    const missing = (def.requires ?? []).filter((dep) => !enabled.has(dep));
    if (missing.length) throw new Error(`Enable ${missing.join(", ")} before "${id}"`);
    for (const [key, field] of Object.entries(def.settings ?? {})) {
      if (field.required && (settings[key] === undefined || settings[key] === "")) {
        throw new Error(`Module "${id}" needs setting "${key}"`);
      }
    }
    await db.run(
      `INSERT INTO tenant_modules (tenant_id, module_id, enabled, settings) VALUES (?1, ?2, 1, ?3)
       ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = 1, settings = excluded.settings`,
      id,
      JSON.stringify(settings),
    );
  }

  async disable(db: TenantDb, id: string): Promise<void> {
    await db.run(`UPDATE tenant_modules SET enabled = 0 WHERE tenant_id = ?1 AND module_id = ?2`, id);
  }
}
