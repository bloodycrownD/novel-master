/**
 * run-agent event action: run an agent by id without persisting its turns to the session.
 *
 * @module service/events/impl/actions/run-agent.handler
 */

import { resolveApplicationModelId } from "@/domain/agent/logic/resolve-application-model-id.js";
import { resolveAgentToolRegistry } from "@/domain/agent/logic/resolve-agent-tool-registry.js";
import { validateAgentDefinition } from "@/domain/agent/logic/validate-agent-definition.js";
import type { RunAgentActionParams } from "@/domain/events-config/model/events-config.js";
import { registerVfsTools } from "@/domain/tool/builtin/vfs-tools.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { VfsToolContext } from "@/domain/tool/builtin/vfs-tools.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import { createAgentRunner } from "@/service/agent/create-agent-runner.js";
import { ChatAgentSession } from "@/service/agent/impl/chat-agent-session.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import type { RegexConfigService } from "@/service/regex/regex-config.port.js";
import type { SessionMacroCache } from "@/service/prompt/session-macro-cache.port.js";
import type { SessionFsService } from "@/service/session-fs/session-fs.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { EventEmitContext } from "../../event-orchestrator.port.js";

export interface RunAgentHandlerDeps {
  readonly messages: MessageService;
  readonly agentRegistry: AgentRegistryService;
  readonly modelRequests: ModelRequestService;
  readonly macroCache: SessionMacroCache;
  readonly worktree: (scope: VfsScope) => WorktreeService;
  readonly sessionFs: SessionFsService;
  readonly sessionVfs: (projectId: string, sessionId: string) => VfsService;
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
  const applicationModelId = resolveApplicationModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });
  if (applicationModelId == null || applicationModelId === "") {
    throw new Error(`run-agent: no model resolved for agent "${agentId}"`);
  }

  const probe = new ToolRegistry<VfsToolContext>();
  registerVfsTools(probe);
  await validateAgentDefinition(definition, {
    registeredToolNames: probe.list(),
  });

  const vfs = deps.sessionVfs(ctx.projectId, ctx.sessionId);
  const registry = resolveAgentToolRegistry(probe, definition);
  const session = new ChatAgentSession(deps.messages, ctx.sessionId);

  const runner = createAgentRunner({
    session,
    modelRequests: deps.modelRequests,
    registry,
    toolCtx: {
      vfs,
      sessionFs: deps.sessionFs,
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
    },
    eventBus: deps.eventBus,
    macroCache: deps.macroCache,
    regexConfig: deps.regexConfig,
    listAllSessionMessages: () => deps.messages.listBySession(ctx.sessionId),
  });

  const activeRegexGroupId = await deps.getActiveRegexGroupId?.();

  await runner.run({
    definition,
    sessionId: ctx.sessionId,
    projectId: ctx.projectId,
    applicationModelId,
    workspaceModelId,
    maxSteps: definition.runtime?.maxSteps ?? 20,
    activeRegexGroupId,
    persistMessages: false,
    publishRunLifecycle: false,
    stream: false,
  });
}
