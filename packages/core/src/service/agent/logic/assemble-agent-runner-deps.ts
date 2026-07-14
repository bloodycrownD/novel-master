/**
 * createAgentRunner 依赖单点装配；对话轨 / 事件轨差异经 includeCompactionOrchestrator 表达。
 *
 * @module service/agent/logic/assemble-agent-runner-deps
 */

import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { RegexConfigService } from "@/service/regex/regex-config.port.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import type { EventOrchestrator } from "@/service/events/event-orchestrator.port.js";
import type { CreateAgentRunnerDeps } from "../create-agent-runner.js";
import type { ChatAgentSession } from "../impl/chat-agent-session.js";
import type { AgentTurnRuntimePort } from "./run-agent-turn.js";

/** 工厂入参：对话轨 / 事件轨共用；差异经 includeCompactionOrchestrator 显式表达。 */
export interface AssembleAgentRunnerDepsInput {
  readonly session: ChatAgentSession;
  /** AgentTurnRuntimePort 或 EventActionDeps 的 runtime 切片（modelRequests、eventBus 等）。 */
  readonly runtime: Pick<
    AgentTurnRuntimePort,
    | "messages"
    | "modelRequests"
    | "messageCheckpoint"
    | "eventBus"
    | "sessionKkv"
    | "worktree"
  > & {
    readonly regexConfig?: RegexConfigService;
    readonly savedModelRepo?: SavedModelRepository;
    /** 事件轨 savedModels 别名。 */
    readonly savedModels?: SavedModelRepository;
    readonly compactionConditionEvaluator?: CompactionConditionEvaluator;
    readonly eventOrchestrator?: EventOrchestrator;
  };
  readonly registry: ToolRegistry<BuiltinToolContext>;
  readonly toolCtx: BuiltinToolContext;
  /** false → 省略 compactionConditions / eventOrchestrator（事件轨）。 */
  readonly includeCompactionOrchestrator: boolean;
}

/** 装配 createAgentRunner 依赖；listAllSessionMessages 由 toolCtx.sessionId + runtime.messages 推导。 */
export function assembleAgentRunnerDeps(
  input: AssembleAgentRunnerDepsInput,
): CreateAgentRunnerDeps {
  const savedModels =
    input.runtime.savedModelRepo ?? input.runtime.savedModels;

  const base: CreateAgentRunnerDeps = {
    session: input.session,
    modelRequests: input.runtime.modelRequests,
    savedModels: savedModels as SavedModelRepository,
    registry: input.registry,
    toolCtx: input.toolCtx,
    messageCheckpoint: input.runtime.messageCheckpoint,
    regexConfig: input.runtime.regexConfig,
    eventBus: input.runtime.eventBus,
    sessionKkv: input.runtime.sessionKkv,
    worktree: input.runtime.worktree,
    listAllSessionMessages: () =>
      input.runtime.messages.listBySession(input.toolCtx.sessionId),
  };

  if (!input.includeCompactionOrchestrator) {
    return base;
  }

  return {
    ...base,
    compactionConditions: input.runtime.compactionConditionEvaluator,
    eventOrchestrator: input.runtime.eventOrchestrator,
  };
}
