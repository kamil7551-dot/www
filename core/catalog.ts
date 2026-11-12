import { cleanAllergens, endOfDayInPoland } from "./allergens";
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
  /** Comma-separated allergen ids; read with parseAllergens(). */
  allergens: string;
  /** Unix time until which the item is sold out ("brak dziś"); null = available. */
  sold_out_until: number | null;
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
  allergens?: string[];
}

export type ItemPatch = Partial<Omit<NewItem, "kind">>;

type Emit = <E extends EventName>(event: E, payload: CoreEvents[E]) => Promise<void>;

export class ValidationError extends Error {}

export const isSoldOut = (item: Pick<Item, "sold_out_until">, at = Math.floor(Date.now() / 1000)) =>
  item.sold_out_until !== null && item.sold_out_until > at;

const KINDS: ItemKind[] = ["product", "service", "dish"];
const STATUSES: ItemStatus[] = ["active", "hidden", "draft"];
const ITEM_COLUMNS =
  "id, kind, name, slug, description, price, currency, category_id, status, image_key, position, allergens, sold_out_until, created_at, updated_at";

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

  /** A category id from another site must never be attached to this site's items. */
  private async checkCategory(categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) return;
    const found = await this.db.first(`SELECT 1 FROM categories WHERE tenant_id = ?1 AND id = ?2`, categoryId);
    if (!found) throw new ValidationError("Unknown category");
  }

  async createItem(input: NewItem): Promise<Item> {
    check(input);
    await this.checkCategory(input.categoryId);
    const id = newId();
    const slug = await this.freeSlug(slugify(input.slug ?? input.name) || id);
    const position = input.position ?? (await this.nextPosition("items"));
    await this.db.run(
      `INSERT INTO items (tenant_id, id, kind, name, slug, description, price, currency, category_id, status, image_key, position, allergens)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
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
      position,
      cleanAllergens(input.allergens ?? []).join(","),
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

  /** `search` matches part of the name, ignoring letter case (also Polish letters). */
  async listItems(filter: { categoryId?: string; status?: ItemStatus; search?: string } = {}): Promise<Item[]> {
    const items = await this.db.all<Item>(
      `SELECT ${ITEM_COLUMNS} FROM items
       WHERE tenant_id = ?1 AND (?2 IS NULL OR category_id = ?2) AND (?3 IS NULL OR status = ?3)
       ORDER BY position, name`,
      filter.categoryId ?? null,
      filter.status ?? null,
    );
    // SQLite's LIKE ignores case only for ASCII ("ż" ≠ "Ż"), so the name match runs here.
    const needle = filter.search?.trim().toLocaleLowerCase("pl");
    return needle ? items.filter((i) => i.name.toLocaleLowerCase("pl").includes(needle)) : items;
  }

  async updateItem(id: string, patch: ItemPatch): Promise<Item | null> {
    check(patch);
    const current = await this.getItem(id);
    if (!current) return null;
    await this.checkCategory(patch.categoryId);
    await this.db.run(
      `UPDATE items SET name = ?3, slug = ?4, description = ?5, price = ?6, currency = ?7, category_id = ?8,
         status = ?9, image_key = ?10, position = ?11, allergens = ?12, updated_at = unixepoch()
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
      patch.allergens !== undefined ? cleanAllergens(patch.allergens).join(",") : current.allergens,
    );
    const item = (await this.getItem(id))!;
    await this.emit("item.updated", { item });
    return item;
  }

  /** "Brak dziś": sold out until the end of today in Poland, then available again by itself. */
  async setSoldOut(id: string, soldOut: boolean, at = Math.floor(Date.now() / 1000)): Promise<Item | null> {
    const changed = await this.db.run(
      `UPDATE items SET sold_out_until = ?3, updated_at = unixepoch() WHERE tenant_id = ?1 AND id = ?2`,
      id,
      soldOut ? endOfDayInPoland(at) : null,
    );
    if (!changed) return null;
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
    if (input.parentId) {
      const parent = await this.db.first(`SELECT 1 FROM categories WHERE tenant_id = ?1 AND id = ?2`, input.parentId);
      if (!parent) throw new ValidationError("Unknown parent category");
    }
    const id = newId();
    await this.db.run(
      `INSERT INTO categories (tenant_id, id, parent_id, name, slug, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      id,
      input.parentId ?? null,
      input.name.trim(),
      slugify(input.slug ?? input.name) || id,
      input.position ?? (await this.nextPosition("categories")),
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

  /** Two items may share a name ("Kawa"), but each needs its own address: kawa, kawa-2, kawa-3… */
  private async freeSlug(base: string): Promise<string> {
    const taken = new Set(
      (await this.db.all<{ slug: string }>(`SELECT slug FROM items WHERE tenant_id = ?1 AND (slug = ?2 OR slug LIKE ?3)`, base, `${base}-%`)).map(
        (r) => r.slug,
      ),
    );
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  /** New entries go to the end of the list, so the seller's order is kept. */
  private async nextPosition(table: "items" | "categories"): Promise<number> {
    const row = await this.db.first<{ next: number }>(`SELECT coalesce(max(position) + 1, 0) AS next FROM ${table} WHERE tenant_id = ?1`);
    return row?.next ?? 0;
  }

  /**
   * Moves an entry one place up or down among its siblings and renumbers them 0..n-1,
   * so old rows that all had position 0 get a stable order on the first move.
   */
  private async move(table: "items" | "categories", siblings: { id: string; position: number }[], id: string, direction: "up" | "down") {
    const ids = siblings.map((x) => x.id);
    const from = ids.indexOf(id);
    const to = from + (direction === "up" ? -1 : 1);
    if (from < 0 || to < 0 || to >= ids.length) return false;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    // Items keep their place relative to items of other categories by reusing the siblings' old slots.
    const slots = siblings.map((x) => x.position).sort((a, b) => a - b);
    const unique = slots.every((p, n) => n === 0 || p > slots[n - 1]!);
    await this.db.batch(
      ids.map((rowId, n): [string, ...unknown[]] => [
        `UPDATE ${table} SET position = ?3 WHERE tenant_id = ?1 AND id = ?2`,
        rowId,
        unique ? slots[n] : n,
      ]),
    );
    return true;
  }

  /** Moves an item within its category (that is how customers see it). */
  async moveItem(id: string, direction: "up" | "down"): Promise<boolean> {
    const item = await this.getItem(id);
    if (!item) return false;
    const siblings = (await this.listItems()).filter((i) => i.category_id === item.category_id);
    const moved = await this.move("items", siblings, id, direction);
    if (moved) await this.emit("item.updated", { item: (await this.getItem(id))! });
    return moved;
  }

  async moveCategory(id: string, direction: "up" | "down"): Promise<boolean> {
    const all = await this.listCategories();
    const category = all.find((c) => c.id === id);
    if (!category) return false;
    const moved = await this.move("categories", all.filter((c) => c.parent_id === category.parent_id), id, direction);
    if (moved) await this.emit("category.updated", { category: (await this.getCategory(id))! });
    return moved;
  }

  getCategory(id: string): Promise<Category | null> {
    return this.db.first<Category>(`SELECT id, parent_id, name, slug, position FROM categories WHERE tenant_id = ?1 AND id = ?2`, id);
  }

  /** Renames a category. The address (slug) stays, so links and QR codes keep working. */
  async renameCategory(id: string, name: string): Promise<Category | null> {
    if (!name.trim()) throw new ValidationError("Name is required");
    const changed = await this.db.run(`UPDATE categories SET name = ?3 WHERE tenant_id = ?1 AND id = ?2`, id, name.trim());
    if (!changed) return null;
    const category = (await this.getCategory(id))!;
    await this.emit("category.updated", { category });
    return category;
  }

  /** Deletes a category; its items stay and become "without category". */
  async deleteCategory(id: string): Promise<boolean> {
    if (!(await this.getCategory(id))) return false;
    await this.db.batch([
      [`UPDATE items SET category_id = NULL, updated_at = unixepoch() WHERE tenant_id = ?1 AND category_id = ?2`, id],
      [`UPDATE categories SET parent_id = NULL WHERE tenant_id = ?1 AND parent_id = ?2`, id],
      [`DELETE FROM categories WHERE tenant_id = ?1 AND id = ?2`, id],
    ]);
    await this.emit("category.deleted", { id });
    return true;
  }

}
