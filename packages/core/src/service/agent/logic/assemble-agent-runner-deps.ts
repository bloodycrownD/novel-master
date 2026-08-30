/**
 * createAgentRunner 依赖单点装配；对话轨 / 事件轨差异经 includeCompactionOrchestrator 表达。
 *
 * @module service/agent/logic/assemble-agent-runner-deps
 */

import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { RegexConfigService } from "@/service/regex/regex-config.port.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
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
    | "messageTranscriptEffects"
    | "modelRequests"
    | "messageCheckpoint"
    | "eventBus"
    | "sessionKkv"
    | "streamRegistry"
    | "skills"
    | "preferences"
  > & {
    readonly workplace: AgentTurnRuntimePort["workplace"];
    readonly regexConfig?: RegexConfigService;
    readonly savedModelRepo?: SavedModelRepository;
    /** 事件轨 savedModels 别名。 */
    readonly savedModels?: SavedModelRepository;
    readonly providerRepo?: Pick<ProviderRepository, "findById">;
    readonly providers?: Pick<ProviderRepository, "findById">;
    readonly compactionConditionEvaluator?: CompactionConditionEvaluator;
  };
  readonly registry: ToolRegistry<BuiltinToolContext>;
  readonly toolCtx: BuiltinToolContext;
  /** false → 省略 compactionConditions / eventOrchestrator（事件轨）。 */
  readonly includeCompactionOrchestrator: boolean;
}

/** 装配 createAgentRunner 依赖；listAllSessionMessages 由 toolCtx.sessionId + runtime.messages 推导。 */
export function assembleAgentRunnerDeps(
  input: AssembleAgentRunnerDepsInput
): CreateAgentRunnerDeps {
  const savedModels = input.runtime.savedModelRepo ?? input.runtime.savedModels;
  const providers = input.runtime.providerRepo ?? input.runtime.providers;

  const base: CreateAgentRunnerDeps = {
    session: input.session,
    modelRequests: input.runtime.modelRequests,
    savedModels: savedModels as SavedModelRepository,
    providers,
    registry: input.registry,
    toolCtx: input.toolCtx,
    // skillAttach hydrate 用的技能服务工厂（透传 runtime.skills）。
    skills: input.runtime.skills,
    messageCheckpoint: input.runtime.messageCheckpoint,
    regexConfig: input.runtime.regexConfig,
    eventBus: input.runtime.eventBus,
    sessionKkv: input.runtime.sessionKkv,
    streamRegistry: input.runtime.streamRegistry,
    workplace: input.runtime.workplace,
    listAllSessionMessages: () =>
      input.runtime.messages.listBySession(input.toolCtx.sessionId),
    // 思考上下文偏好窄切片透传（可选；未注入时 runner 等同默认开）。
    preferences: input.runtime.preferences,
  };

  if (!input.includeCompactionOrchestrator) {
    return base;
  }

  // 对话轨：注入压缩执行所需的 messages + messageTranscriptEffects，
  // 以及压缩条件评估器。agent-runner 检测到 compactionConditions 命中时
  // 直调 runCompaction，不再经 eventOrchestrator。
  return {
    ...base,
    compactionConditions: input.runtime.compactionConditionEvaluator,
    messages: input.runtime.messages,
    messageTranscriptEffects: input.runtime.messageTranscriptEffects,
  };
}
