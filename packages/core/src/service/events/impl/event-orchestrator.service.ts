/**
 * Event orchestrator: loads config and runs sequential/parallel action chains.
 *
 * @module service/events/impl/event-orchestrator.service
 */

import type { EventAction, EventActionNode } from "@/domain/events-config/model/events-config.js";
import type { EventsConfigStore } from "@/service/events-config/events-config-store.port.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { SessionMacroCache } from "@/service/prompt/session-macro-cache.port.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { DepthSlice } from "@/domain/depth/logic/depth-slice.js";
import {
  EVENT_SESSION_COMPACTION_REQUESTED,
  EVENT_SESSION_MESSAGE_RECEIVED,
  type SessionCompactionRequestedPayload,
  type SessionMessageReceivedPayload,
} from "@/domain/events/model/event-types.js";
import type {
  EventEmitContext,
  EventOrchestrator,
} from "../event-orchestrator.port.js";
import type { EventActionFailure, EventRunResult } from "../event-run-result.js";
import { runHideMessageAction } from "./actions/hide-message.handler.js";
import { runRefreshMacrosAction } from "./actions/refresh-macros.handler.js";
import {
  runRunAgentAction,
  type RunAgentHandlerDeps,
} from "./actions/run-agent.handler.js";
import type { RunAgentActionParams } from "@/domain/events-config/model/events-config.js";

export interface DefaultEventOrchestratorDeps {
  readonly eventsConfig: EventsConfigStore;
  readonly eventBus: SimpleEventBus;
  readonly messages: MessageService;
  readonly macroCache: SessionMacroCache;
  readonly worktree: (scope: VfsScope) => WorktreeService;
  readonly createSession: (sessionId: string) => AgentSession;
  readonly runAgent?: RunAgentHandlerDeps;
}

export class DefaultEventOrchestrator implements EventOrchestrator {
  private busAttached = false;

  constructor(private readonly deps: DefaultEventOrchestratorDeps) {}

  attachToBus(): void {
    if (this.busAttached) {
      return;
    }
    this.busAttached = true;
    const handler = async (eventType: string, payload: unknown) => {
      const ctx = payloadToEmitContext(payload);
      if (ctx == null) {
        return;
      }
      await this.emit(eventType, ctx);
    };
    this.deps.eventBus.subscribe(
      EVENT_SESSION_COMPACTION_REQUESTED,
      (p) => void handler(EVENT_SESSION_COMPACTION_REQUESTED, p),
    );
    this.deps.eventBus.subscribe(EVENT_SESSION_MESSAGE_RECEIVED, (p) =>
      void handler(EVENT_SESSION_MESSAGE_RECEIVED, p),
    );
  }

  async emit(eventType: string, ctx: EventEmitContext): Promise<EventRunResult> {
    const config = await this.deps.eventsConfig.getConfig();
    const nodes = config.events[eventType];
    if (nodes == null) {
      return { ok: true, partialFailure: false, failures: [] };
    }
    return this.runDag(nodes, ctx);
  }

  private async runDag(
    nodes: readonly EventActionNode[],
    ctx: EventEmitContext,
  ): Promise<EventRunResult> {
    if (nodes.length === 0) {
      return { ok: true, partialFailure: false, failures: [] };
    }

    const byType = new Map<EventAction["type"], EventActionNode>(
      nodes.map((n) => [n.type, n] as const),
    );
    const remainingDeps = new Map<EventAction["type"], number>();
    const dependents = new Map<EventAction["type"], EventAction["type"][]>();
    for (const n of nodes) {
      remainingDeps.set(n.type, n.dependency?.length ?? 0);
      dependents.set(n.type, []);
    }
    for (const n of nodes) {
      for (const dep of n.dependency ?? []) {
        dependents.get(dep)?.push(n.type);
      }
    }

    const ready = new Set<EventAction["type"]>();
    for (const [t, count] of remainingDeps.entries()) {
      if (count === 0) ready.add(t);
    }

    const success = new Set<EventAction["type"]>();
    while (ready.size > 0) {
      const batch = Array.from(ready);
      ready.clear();

      const results = await Promise.allSettled(
        batch.map((t) => {
          const node = byType.get(t);
          if (node == null) {
            throw new Error(`missing action node: ${t}`);
          }
          return this.runAction(node, ctx);
        }),
      );

      const failures: EventActionFailure[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        if (r.status === "rejected") {
          failures.push({
            actionType: batch[i]!,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      }
      if (failures.length > 0) {
        // Fail-fast: do not schedule any further actions.
        return { ok: false, partialFailure: false, failures };
      }

      for (const t of batch) {
        success.add(t);
        for (const dep of dependents.get(t) ?? []) {
          const next = (remainingDeps.get(dep) ?? 0) - 1;
          remainingDeps.set(dep, next);
          if (next === 0 && !success.has(dep)) {
            ready.add(dep);
          }
        }
      }
    }

    return { ok: success.size === nodes.length, partialFailure: false, failures: [] };
  }

  private async runAction(action: EventAction, ctx: EventEmitContext): Promise<void> {
    const session = this.deps.createSession(ctx.sessionId);
    switch (action.type) {
      case "hide-message":
        await runHideMessageAction(
          session,
          ctx.sessionId,
          action.params as DepthSlice,
          { messages: this.deps.messages },
        );
        return;
      case "refresh-macros":
        await runRefreshMacrosAction(ctx.projectId, ctx.sessionId, {
          macroCache: this.deps.macroCache,
          worktree: this.deps.worktree,
        });
        return;
      case "run-agent": {
        if (this.deps.runAgent == null) {
          throw new Error("run-agent is not configured for this runtime");
        }
        await runRunAgentAction(
          ctx,
          action.params as RunAgentActionParams,
          this.deps.runAgent,
        );
        return;
      }
      default:
        throw new Error(`unknown action: ${(action as EventAction).type}`);
    }
  }
}

function payloadToEmitContext(payload: unknown): EventEmitContext | null {
  if (payload == null || typeof payload !== "object") {
    return null;
  }
  const p = payload as SessionCompactionRequestedPayload | SessionMessageReceivedPayload;
  if (typeof p.sessionId !== "string" || typeof p.projectId !== "string") {
    return null;
  }
  const trigger =
    "trigger" in p && (p.trigger === "manual" || p.trigger === "condition")
      ? p.trigger
      : undefined;
  return {
    sessionId: p.sessionId,
    projectId: p.projectId,
    trigger,
  };
}
