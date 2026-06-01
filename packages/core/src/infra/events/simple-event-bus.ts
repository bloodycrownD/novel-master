/**
 * Synchronous in-process typed event bus (Library infra).
 *
 * @module infra/events/simple-event-bus
 */

export type EventHandler<T = unknown> = (payload: T) => void;

export interface EventSubscription {
  unsubscribe(): void;
}

/** Synchronous publish/subscribe bus for a single process. */
export class SimpleEventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  /** Registers a handler; returns subscription for cleanup. */
  subscribe<T>(eventType: string, handler: EventHandler<T>): EventSubscription {
    let set = this.handlers.get(eventType);
    if (set == null) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler as EventHandler);
    return {
      unsubscribe: () => {
        set!.delete(handler as EventHandler);
        if (set!.size === 0) {
          this.handlers.delete(eventType);
        }
      },
    };
  }

  /** Invokes all handlers for the event type in registration order. */
  publish<T>(eventType: string, payload: T): void {
    const set = this.handlers.get(eventType);
    if (set == null) {
      return;
    }
    for (const handler of set) {
      handler(payload);
    }
  }

  /** Removes every handler (tests). */
  clear(): void {
    this.handlers.clear();
  }
}

export type EventBus = SimpleEventBus;
