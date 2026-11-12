/** Small in-memory cache with expiry and a size cap (oldest entries go first). Lives as long as the Worker isolate. */
export class TtlCache<V> {
  private entries = new Map<string, { value: V; until: number }>();

  constructor(
    private max = 1000,
    private clock: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.until <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh position so frequently used entries survive the size cap.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, until: this.clock() + ttlMs });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
