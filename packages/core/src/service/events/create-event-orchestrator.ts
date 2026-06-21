/**
 * {@link DefaultEventOrchestrator} 工厂。
 *
 * @module service/events/create-event-orchestrator
 */

import type { MessageService } from "@/service/chat/message.port.js";
import type { MessageTranscriptEffectsService } from "@/service/chat/message-transcript-effects.port.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { EventsConfigStore } from "@/service/events-config/events-config-store.port.js";
import type { SessionWorktreeSnapshotStore } from "@/service/prompt/session-worktree-snapshot.port.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { RunAgentHandlerDeps } from "./impl/actions/run-agent.handler.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type { PersistentState } from "@/service/persistent-state/persistent-state.port.js";
import type { RegexConfigService } from "@/service/regex/regex-config.port.js";
import {
  DefaultEventOrchestrator,
  type DefaultEventOrchestratorDeps,
} from "./impl/event-orchestrator.service.js";
import type { EventOrchestrator } from "./event-orchestrator.port.js";

export interface CreateEventOrchestratorDeps {
  readonly onActionFailure?: DefaultEventOrchestratorDeps["onActionFailure"];
  readonly eventsConfig: EventsConfigStore;
  readonly eventBus: SimpleEventBus;
  readonly messages: MessageService;
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
  readonly runAgent?: RunAgentHandlerDeps;
}

/** 为 CLI / Mobile 等 runtime 装配 {@link RunAgentHandlerDeps}。 */
export function createRunAgentHandlerDeps(input: {
  readonly messages: MessageService;
  readonly agentRegistry: AgentRegistryService;
  readonly modelRequests: ModelRequestService;
  readonly worktreeSnapshot: SessionWorktreeSnapshotStore;
  readonly worktree: (scope: VfsScope) => WorktreeService;
  readonly sessionVfs: (projectId: string, sessionId: string) => VfsService;
  readonly messageCheckpoint: MessageCheckpointService;
  readonly eventBus: SimpleEventBus;
  readonly state: PersistentState;
  readonly regexConfig?: RegexConfigService;
}): RunAgentHandlerDeps {
  return {
    messages: input.messages,
    agentRegistry: input.agentRegistry,
    modelRequests: input.modelRequests,
    worktreeSnapshot: input.worktreeSnapshot,
    worktree: input.worktree,
    sessionVfs: input.sessionVfs,
    messageCheckpoint: input.messageCheckpoint,
    eventBus: input.eventBus,
    getWorkspaceModelId: () => input.state.getCurrentModelId(),
    regexConfig: input.regexConfig,
    getActiveRegexGroupId: () => input.state.getCurrentRegexGroupId(),
  };
}

export function createEventOrchestrator(
  deps: CreateEventOrchestratorDeps,
): EventOrchestrator {
  const orchestrator = new DefaultEventOrchestrator(deps);
  orchestrator.attachToBus();
  return orchestrator;
}

/** rebootstrap 或测试时卸载 orchestrator 的 bus 监听。 */
export function detachEventOrchestratorFromBus(
  orchestrator: EventOrchestrator,
): void {
  orchestrator.detachFromBus();
}
