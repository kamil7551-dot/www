import type { Category, Item } from "./catalog";
import type { Order } from "./orders";

/** Events the core emits. Names and payloads only grow; never rename or repurpose one. */
export interface CoreEvents {
  "item.created": { item: Item };
  "item.updated": { item: Item };
  "item.deleted": { id: string };
  "category.created": { category: Category };
  "category.updated": { category: Category };
  "category.deleted": { id: string };
  "order.created": { order: Order };
  "order.paid": { order: Order };
  "order.shipped": { order: Order };
  "order.cancelled": { order: Order };
}

export type EventName = keyof CoreEvents;

export interface EventContext {
  tenantId: string;
}

export type EventHandler<E extends EventName> = (
  payload: CoreEvents[E],
  ctx: EventContext,
) => void | Promise<void>;

type Logger = (message: string, error: unknown) => void;

/**
 * Delivers core events to module hooks. A failing handler is logged and
 * never breaks the operation that emitted the event.
 */
export class EventBus {
  private handlers = new Map<EventName, { source: string; fn: EventHandler<EventName> }[]>();

  constructor(private log: Logger = (m, e) => console.error(m, e)) {}

  on<E extends EventName>(event: E, handler: EventHandler<E>, source = "core"): void {
    const list = this.handlers.get(event) ?? [];
    list.push({ source, fn: handler as EventHandler<EventName> });
    this.handlers.set(event, list);
  }

  async emit<E extends EventName>(
    event: E,
    payload: CoreEvents[E],
    ctx: EventContext,
    isEnabled: (source: string) => boolean = () => true,
  ): Promise<void> {
    for (const { source, fn } of this.handlers.get(event) ?? []) {
      if (!isEnabled(source)) continue;
      try {
        await fn(payload, ctx);
      } catch (error) {
        this.log(`Handler from "${source}" failed on "${event}"`, error);
      }
    }
  }
}
