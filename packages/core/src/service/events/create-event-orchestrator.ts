/**
 * Factory for {@link DefaultEventOrchestrator}.
 *
 * @module service/events/create-event-orchestrator
 */

import { ChatAgentSession } from "@/service/agent/impl/chat-agent-session.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { EventsConfigStore } from "@/service/events-config/events-config-store.port.js";
import type { SessionMacroCache } from "@/service/prompt/session-macro-cache.port.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import {
  DefaultEventOrchestrator,
  type DefaultEventOrchestratorDeps,
} from "./impl/event-orchestrator.service.js";
import type { EventOrchestrator } from "./event-orchestrator.port.js";

export interface CreateEventOrchestratorDeps {
  readonly eventsConfig: EventsConfigStore;
  readonly eventBus: SimpleEventBus;
  readonly messages: MessageService;
  readonly macroCache: SessionMacroCache;
  readonly worktree: (scope: VfsScope) => WorktreeService;
}

export function createEventOrchestrator(
  deps: CreateEventOrchestratorDeps,
): EventOrchestrator {
  const fullDeps: DefaultEventOrchestratorDeps = {
    ...deps,
    createSession: (sessionId) => new ChatAgentSession(deps.messages, sessionId),
  };
  const orchestrator = new DefaultEventOrchestrator(fullDeps);
  orchestrator.attachToBus();
  return orchestrator;
}
