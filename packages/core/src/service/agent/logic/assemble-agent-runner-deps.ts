/**
 * AgentServiceFactory.createRunner 依赖单点装配；对话轨 / 事件轨差异经 includeCompactionOrchestrator 表达。
 *
 * @module service/agent/logic/assemble-agent-runner-deps
 */

import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import { assert } from "@/common/assert.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/compaction-factory.js";
import type { CreateAgentRunnerDeps } from "../agent-service-factory.js";
import type { ChatAgentSession } from "../impl/chat-agent-session.js";
import type { AgentTurnRuntimePort } from "./run-agent-turn.js";

/** 工厂入参：对话轨 / 事件轨共用；差异经 includeCompactionOrchestrator 显式表达。 */
export interface AssembleAgentRunnerDepsInput {
  readonly session: ChatAgentSession;
  /** AgentTurnRuntimePort 或 EventActionDeps 的 runtime 切片（modelRequests、eventBus 等）。 */
  readonly runtime: Pick<
    AgentTurnRuntimePort,
    "messages" | "modelRequests" | "messageCheckpoint" | "eventBus" | "sessionKkv" | "streamRegistry" | "skills" | "preferences"
  > & {
    readonly workplace: AgentTurnRuntimePort["workplace"];
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

/** AgentServiceFactory.createRunner 依赖装配集合。 */
export const AgentRunnerDepsAssembler = {
  /** 装配 AgentServiceFactory.createRunner 依赖；listVisibleSessionMessages 由 toolCtx.sessionId + runtime.messages 推导。 */
  assemble(input: AssembleAgentRunnerDepsInput): CreateAgentRunnerDeps {
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
      eventBus: input.runtime.eventBus,
      sessionKkv: input.runtime.sessionKkv,
      streamRegistry: input.runtime.streamRegistry,
      workplace: input.runtime.workplace,
      // tool_use 查找源（Gemini functionResponse 的函数名解析）收窄为可见-only：
      // 出站历史经 normalizeOrphanToolResultsForLlm（按可见历史配对）后，残留
      // tool_result 的 tool_use 必在可见集内——hidden 行给不出任何解析力，却要
      // 逐条解压（全量读 212ms vs 可见读 14ms，每步一发）。详见 agent-runner
      // 该依赖的使用点注释。
      // 读口改 Outcome 后在此转回数组：已知失败抛出交 runner 收口；未注入 hooks，
      // 中断分支不可达，命中即不变量破坏（断言而非取消语义）。
      listVisibleSessionMessages: async () => {
        const read = await input.runtime.messages.listBySession(input.toolCtx.sessionId, { includeHidden: false });
        if (read.kind === "failed") throw read.error;
        assert(read.kind === "completed", "listVisibleSessionMessages 未注入 hooks，listBySession 不应产生中断");
        return read.value;
      },
      // 思考上下文偏好窄切片透传（可选；未注入时 runner 等同默认开）。
      preferences: input.runtime.preferences,
    };

    if (!input.includeCompactionOrchestrator) {
      return base;
    }

    // 对话轨：注入压缩执行所需的 messages 以及压缩条件评估器。
    // agent-runner 检测到 compactionConditions 命中时直调 runCompaction，
    // 不再经 eventOrchestrator。
    return {
      ...base,
      compactionConditions: input.runtime.compactionConditionEvaluator,
      messages: input.runtime.messages,
    };
  },
} as const;
