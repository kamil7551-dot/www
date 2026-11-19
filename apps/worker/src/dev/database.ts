import { DurableObject } from "cloudflare:workers";
import { MIGRATIONS } from "./migrations";

/**
 * Dev deployment only: the whole database lives in one Durable Object with built-in SQLite,
 * and d1Shim() gives the app the slice of the D1 API it uses (prepare/bind/first/all/run, batch).
 * Same SQLite underneath, so the SQL in core/ runs unchanged. Production uses real D1.
 */

type Row = Record<string, SqlStorageValue>;
interface Result {
  rows: Row[];
  changes: number;
}

export class DevDatabase extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS dev_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    const done = new Set(sql.exec<{ name: string }>("SELECT name FROM dev_migrations").toArray().map((r) => r.name));
    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      this.ctx.storage.transactionSync(() => {
        sql.exec(m.sql);
        sql.exec("INSERT INTO dev_migrations (name, applied_at) VALUES (?, unixepoch())", m.name);
      });
    }
  }

  private one(query: string, params: unknown[]): Result {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<Row>(query, ...(params as SqlStorageValue[])).toArray();
    const changes = Number(sql.exec<{ n: number }>("SELECT changes() AS n").one().n);
    return { rows, changes };
  }

  query(query: string, params: unknown[]): Result {
    return this.one(query, params);
  }

  /** All statements in one transaction, like D1's batch. */
  batch(statements: { query: string; params: unknown[] }[]): Result[] {
    return this.ctx.storage.transactionSync(() => statements.map((s) => this.one(s.query, s.params)));
  }
}

class Statement {
  constructor(
    private readonly db: DurableObjectStub<DevDatabase>,
    readonly query: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    // D1 stores booleans as 1/0 and undefined is not allowed; keep the same rules.
    return new Statement(this.db, this.query, params.map((p) => (typeof p === "boolean" ? Number(p) : p)));
  }

  private async exec(): Promise<Result> {
    return (await this.db.query(this.query, this.params)) as Result;
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const row = (await this.exec()).rows[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Row>() {
    const r = await this.exec();
    return { results: r.rows as T[], success: true as const, meta: { changes: r.changes } };
  }

  async run() {
    const r = await this.exec();
    return { results: [], success: true as const, meta: { changes: r.changes } };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return (await this.exec()).rows.map((r) => Object.values(r)) as T[];
  }
}

export function d1Shim(ns: DurableObjectNamespace<DevDatabase>): D1Database {
  const db = ns.get(ns.idFromName("db"));
  const shim = {
    prepare: (query: string) => new Statement(db, query),
    async batch(statements: Statement[]) {
      const results = (await db.batch(statements.map((s) => ({ query: s.query, params: s.params })))) as Result[];
      return results.map((r) => ({ results: r.rows, success: true, meta: { changes: r.changes } }));
    },
    exec: () => Promise.reject(new Error("exec() is not used by the app")),
    dump: () => Promise.reject(new Error("dump() is not available in dev")),
    withSession: () => shim,
  };
  return shim as unknown as D1Database;
}
