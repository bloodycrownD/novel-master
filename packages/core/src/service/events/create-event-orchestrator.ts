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
import type { RunAgentHandlerDeps } from "./impl/actions/run-agent.handler.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import type { SessionFsService } from "@/service/session-fs/session-fs.port.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type { PersistentState } from "@/service/persistent-state/persistent-state.port.js";
import type { RegexConfigService } from "@/service/regex/regex-config.port.js";
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
  readonly runAgent?: RunAgentHandlerDeps;
}

/** Wires {@link RunAgentHandlerDeps} for CLI / Mobile runtimes. */
export function createRunAgentHandlerDeps(input: {
  readonly messages: MessageService;
  readonly agentRegistry: AgentRegistryService;
  readonly modelRequests: ModelRequestService;
  readonly macroCache: SessionMacroCache;
  readonly worktree: (scope: VfsScope) => WorktreeService;
  readonly sessionFs: SessionFsService;
  readonly sessionVfs: (projectId: string, sessionId: string) => VfsService;
  readonly eventBus: SimpleEventBus;
  readonly state: PersistentState;
  readonly regexConfig?: RegexConfigService;
}): RunAgentHandlerDeps {
  return {
    messages: input.messages,
    agentRegistry: input.agentRegistry,
    modelRequests: input.modelRequests,
    macroCache: input.macroCache,
    worktree: input.worktree,
    sessionFs: input.sessionFs,
    sessionVfs: input.sessionVfs,
    eventBus: input.eventBus,
    getWorkspaceModelId: () => input.state.getCurrentModelId(),
    regexConfig: input.regexConfig,
    getActiveRegexGroupId: () => input.state.getCurrentRegexGroupId(),
  };
}

export function createEventOrchestrator(
  deps: CreateEventOrchestratorDeps,
): EventOrchestrator {
  const fullDeps: DefaultEventOrchestratorDeps = {
    ...deps,
    createSession: (sessionId) => new ChatAgentSession(deps.messages, sessionId),
    runAgent: deps.runAgent,
  };
  const orchestrator = new DefaultEventOrchestrator(fullDeps);
  orchestrator.attachToBus();
  return orchestrator;
}
