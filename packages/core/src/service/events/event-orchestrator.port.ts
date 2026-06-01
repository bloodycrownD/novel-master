/**
 * Event orchestrator port — runs configured actions for event types.
 *
 * @module service/events/event-orchestrator.port
 */

import type { EventRunResult } from "./event-run-result.js";

export interface EventEmitContext {
  readonly sessionId: string;
  readonly projectId: string;
  readonly trigger?: "manual" | "condition";
}

export interface EventOrchestrator {
  /** Runs configured actions for the event (direct invoke; also used by bus subscriber). */
  emit(eventType: string, ctx: EventEmitContext): Promise<EventRunResult>;
  /** Subscribes to the bus for all configured event types. */
  attachToBus(): void;
}
