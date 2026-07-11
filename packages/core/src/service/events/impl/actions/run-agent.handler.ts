/**
 * run-agent event action: run an agent by id without persisting its turns to the session.
 *
 * @module service/events/impl/actions/run-agent.handler
 */

import { resolveSavedModelId } from "@/domain/agent/logic/resolve-saved-model-id.js";
import { resolveAgentToolRegistry } from "@/domain/agent/logic/resolve-agent-tool-registry.js";
import { validateAgentDefinition } from "@/domain/agent/logic/validate-agent-definition.js";
import type { RunAgentActionParams } from "@/domain/events-config/model/events-config.js";
import { registerBuiltinTools } from "@/domain/tool/builtin/register-builtin-tools.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import { createAgentRunner } from "@/service/agent/create-agent-runner.js";
import { assembleAgentRunnerDeps } from "@/service/agent/logic/assemble-agent-runner-deps.js";
import { DEFAULT_AGENT_MAX_STEPS } from "@/service/agent/logic/agent-run-max-steps.js";
import { ChatAgentSession } from "@/service/agent/impl/chat-agent-session.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { RegexConfigService } from "@/service/regex/regex-config.port.js";
import type { SessionWorktreeBlockStore } from "@/service/prompt/session-worktree-block.port.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { EventEmitContext } from "../../event-orchestrator.port.js";

export interface RunAgentHandlerDeps {
  readonly messages: MessageService;
  readonly agentRegistry: AgentRegistryService;
  readonly modelRequests: ModelRequestService;
  readonly savedModels: SavedModelRepository;
  readonly worktreeBlockStore: SessionWorktreeBlockStore;
  readonly worktree: (scope: VfsScope) => WorktreeService;
  readonly sessionVfs: (projectId: string, sessionId: string) => VfsService;
  readonly messageCheckpoint: MessageCheckpointService;
  readonly eventBus: SimpleEventBus;
  readonly getWorkspaceModelId: () => Promise<string | undefined>;
  readonly regexConfig?: RegexConfigService;
  readonly getActiveRegexGroupId?: () => Promise<string | undefined>;
}

export async function runRunAgentAction(
  ctx: EventEmitContext,
  params: RunAgentActionParams,
  deps: RunAgentHandlerDeps,
): Promise<void> {
  const agentId = params.agentId.trim();
  if (agentId === "") {
    throw new Error("run-agent requires agentId");
  }

  const definition = await deps.agentRegistry.get(agentId);
  const workspaceModelId = (await deps.getWorkspaceModelId()) ?? "";
  const savedModelId = resolveSavedModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });
  if (savedModelId == null || savedModelId === "") {
    throw new Error(`run-agent: no model resolved for agent "${agentId}"`);
  }

  const probe = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(probe);
  await validateAgentDefinition(definition, {
    registeredToolNames: probe.list(),
  });

  const vfs = deps.sessionVfs(ctx.projectId, ctx.sessionId);
  const registry = resolveAgentToolRegistry(probe, definition);
  const session = new ChatAgentSession(deps.messages, ctx.sessionId);

  const runner = createAgentRunner(
    assembleAgentRunnerDeps({
      session,
      runtime: deps,
      registry,
      toolCtx: {
        vfs,
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
        listSessionMessages: () => deps.messages.listBySession(ctx.sessionId),
      },
      includeCompactionOrchestrator: false,
    }),
  );

  const activeRegexGroupId = await deps.getActiveRegexGroupId?.();

  await runner.run({
    definition,
    sessionId: ctx.sessionId,
    projectId: ctx.projectId,
    savedModelId,
    workspaceModelId,
    maxSteps: definition.runtime?.maxSteps ?? DEFAULT_AGENT_MAX_STEPS,
    activeRegexGroupId,
    persistMessages: false,
    publishRunLifecycle: false,
    stream: false,
  });
}
