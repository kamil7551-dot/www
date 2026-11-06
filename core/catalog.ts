import { newId, type TenantDb } from "./db";
import type { CoreEvents, EventName } from "./events";
import { slugify } from "./slug";

export type ItemKind = "product" | "service" | "dish";
export type ItemStatus = "active" | "hidden" | "draft";

export interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  slug: string;
  description: string;
  /** Smallest currency unit, e.g. grosze. */
  price: number;
  currency: string;
  category_id: string | null;
  status: ItemStatus;
  image_key: string | null;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  position: number;
}

export interface NewItem {
  kind: ItemKind;
  name: string;
  price: number;
  slug?: string;
  description?: string;
  currency?: string;
  categoryId?: string | null;
  status?: ItemStatus;
  imageKey?: string | null;
  position?: number;
}

export type ItemPatch = Partial<Omit<NewItem, "kind">>;

type Emit = <E extends EventName>(event: E, payload: CoreEvents[E]) => Promise<void>;

export class ValidationError extends Error {}

const KINDS: ItemKind[] = ["product", "service", "dish"];
const STATUSES: ItemStatus[] = ["active", "hidden", "draft"];
const ITEM_COLUMNS =
  "id, kind, name, slug, description, price, currency, category_id, status, image_key, position, created_at, updated_at";

function check(input: ItemPatch & { kind?: ItemKind }): void {
  if (input.kind !== undefined && !KINDS.includes(input.kind)) throw new ValidationError(`Unknown kind: ${input.kind}`);
  if (input.status !== undefined && !STATUSES.includes(input.status)) {
    throw new ValidationError(`Unknown status: ${input.status}`);
  }
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError("Name is required");
  if (input.price !== undefined && (!Number.isInteger(input.price) || input.price < 0)) {
    throw new ValidationError("Price must be a non-negative integer in the smallest currency unit");
  }
  if (input.slug !== undefined && !slugify(input.slug)) throw new ValidationError("Slug is empty");
}

/** Catalog of one tenant: products, services and dishes, plus their categories. */
export class Catalog {
  constructor(
    private db: TenantDb,
    private emit: Emit,
  ) {}

  async createItem(input: NewItem): Promise<Item> {
    check(input);
    const id = newId();
    const slug = slugify(input.slug ?? input.name) || id;
    await this.db.run(
      `INSERT INTO items (tenant_id, id, kind, name, slug, description, price, currency, category_id, status, image_key, position)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      id,
      input.kind,
      input.name.trim(),
      slug,
      input.description ?? "",
      input.price,
      input.currency ?? "PLN",
      input.categoryId ?? null,
      input.status ?? "active",
      input.imageKey ?? null,
      input.position ?? 0,
    );
    const item = (await this.getItem(id))!;
    await this.emit("item.created", { item });
    return item;
  }

  getItem(id: string): Promise<Item | null> {
    return this.db.first<Item>(`SELECT ${ITEM_COLUMNS} FROM items WHERE tenant_id = ?1 AND id = ?2`, id);
  }

  getItemBySlug(slug: string): Promise<Item | null> {
    return this.db.first<Item>(`SELECT ${ITEM_COLUMNS} FROM items WHERE tenant_id = ?1 AND slug = ?2`, slug);
  }

  listItems(filter: { categoryId?: string; status?: ItemStatus } = {}): Promise<Item[]> {
    return this.db.all<Item>(
      `SELECT ${ITEM_COLUMNS} FROM items
       WHERE tenant_id = ?1 AND (?2 IS NULL OR category_id = ?2) AND (?3 IS NULL OR status = ?3)
       ORDER BY position, name`,
      filter.categoryId ?? null,
      filter.status ?? null,
    );
  }

  async updateItem(id: string, patch: ItemPatch): Promise<Item | null> {
    check(patch);
    const current = await this.getItem(id);
    if (!current) return null;
    await this.db.run(
      `UPDATE items SET name = ?3, slug = ?4, description = ?5, price = ?6, currency = ?7, category_id = ?8,
         status = ?9, image_key = ?10, position = ?11, updated_at = unixepoch()
       WHERE tenant_id = ?1 AND id = ?2`,
      id,
      patch.name?.trim() ?? current.name,
      patch.slug !== undefined ? slugify(patch.slug) : current.slug,
      patch.description ?? current.description,
      patch.price ?? current.price,
      patch.currency ?? current.currency,
      patch.categoryId !== undefined ? patch.categoryId : current.category_id,
      patch.status ?? current.status,
      patch.imageKey !== undefined ? patch.imageKey : current.image_key,
      patch.position ?? current.position,
    );
    const item = (await this.getItem(id))!;
    await this.emit("item.updated", { item });
    return item;
  }

  async deleteItem(id: string): Promise<boolean> {
    const deleted = (await this.db.run(`DELETE FROM items WHERE tenant_id = ?1 AND id = ?2`, id)) > 0;
    if (deleted) await this.emit("item.deleted", { id });
    return deleted;
  }

  async createCategory(input: { name: string; slug?: string; parentId?: string | null; position?: number }): Promise<Category> {
    if (!input.name.trim()) throw new ValidationError("Name is required");
    const id = newId();
    await this.db.run(
      `INSERT INTO categories (tenant_id, id, parent_id, name, slug, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      id,
      input.parentId ?? null,
      input.name.trim(),
      slugify(input.slug ?? input.name) || id,
      input.position ?? 0,
    );
    const category = (await this.db.first<Category>(
      `SELECT id, parent_id, name, slug, position FROM categories WHERE tenant_id = ?1 AND id = ?2`,
      id,
    ))!;
    await this.emit("category.created", { category });
    return category;
  }

  listCategories(): Promise<Category[]> {
    return this.db.all<Category>(
      `SELECT id, parent_id, name, slug, position FROM categories WHERE tenant_id = ?1 ORDER BY position, name`,
    );
  }
}
