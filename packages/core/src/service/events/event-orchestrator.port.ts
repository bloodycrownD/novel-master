/**
 * Event orchestrator port — runs configured actions for event types.
 *
 * @module service/events/event-orchestrator.port
 */

import type { EventRunResult } from "./event-run-result.js";

/**
 * Scope for running configured event actions (hide-message, run-agent, etc.).
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
  /**
   * 等待 attachToBus 触发的全部 in-flight emit 完成（成功或失败均 settle）。
   *
   * 这是为了把原来 fire-and-forget 的 `void emit().then().catch()` 暴露给调用方：
   * 上层（CLI/runtime/测试）可以选择 await 它，确保 bus 触发的下游 action 真正落地后再继续；
   * 失败已由内部 reportActionFailure 处理，不会产生 unhandledRejection。
   */
  pendingEmits(): Promise<void>;
}
