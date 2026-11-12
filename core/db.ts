/**
 * Tenant-scoped access to D1.
 *
 * Every query gets the tenant id bound as `?1`, so SQL must reference it
 * (e.g. `WHERE tenant_id = ?1`). Other parameters start at `?2`.
 * A query that does not mention `tenant_id` is rejected before it runs.
 */
export class TenantDb {
  constructor(
    readonly raw: D1Database,
    readonly tenantId: string,
  ) {
    if (!tenantId) throw new Error("TenantDb requires a tenant id");
  }

  private stmt(sql: string, params: unknown[]): D1PreparedStatement {
    if (!/\btenant_id\b/.test(sql) || !sql.includes("?1")) {
      throw new Error(`Query is not tenant-scoped: ${sql}`);
    }
    return this.raw.prepare(sql).bind(this.tenantId, ...params);
  }

  async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    const { results } = await this.stmt(sql, params).all<T>();
    return results;
  }

  first<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return this.stmt(sql, params).first<T>();
  }

  /** Runs several tenant-scoped statements in one transaction: all succeed or none does. */
  async batch(statements: [sql: string, ...params: unknown[]][]): Promise<void> {
    if (statements.length) await this.raw.batch(statements.map(([sql, ...params]) => this.stmt(sql, params)));
  }

  async run(sql: string, ...params: unknown[]): Promise<number> {
    const res = await this.stmt(sql, params).run();
    return res.meta.changes;
  }
}

export const newId = (): string => crypto.randomUUID();
