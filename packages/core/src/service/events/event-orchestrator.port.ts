/**
 * Event orchestrator port — runs configured actions for event types.
 *
 * @module service/events/event-orchestrator.port
 */

import type { EventRunResult } from "./event-run-result.js";

/**
 * Scope for running configured event actions (hide-message, refresh-macros, etc.).
 */
export interface EventEmitContext {
  readonly sessionId: string;
  readonly projectId: string;
  /** Distinguishes automatic condition emit from manual UI/CLI compaction. */
  readonly trigger?: "manual" | "condition";
}

/**
 * Loads `nm-events` config and runs action chains for an event type.
 * {@link attachToBus} handles async `bus.publish` from CLI/manual paths;
 * AgentRunner calls {@link emit} directly (awaited) on condition trigger.
 */
export interface EventOrchestrator {
  /** Runs configured actions for the event (direct invoke; also used by bus subscriber). */
  emit(eventType: string, ctx: EventEmitContext): Promise<EventRunResult>;
  /** Subscribes to compaction/message events published on the process bus. */
  attachToBus(): void;
  /** Removes bus listeners (rebootstrap / tests). */
  detachFromBus(): void;
}
