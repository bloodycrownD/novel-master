/**
 * Desktop agent run adapter — 平台薄壳：把 desktop 的日志钩子挂到 core
 * {@link coreRunAgentTurn} 上，返回值通道（`Result`）与 core 对齐。
 *
 * @module services/agent-run
 */
import {
  mapResolveError,
  resolveApplicationModelIdForRun,
  resolveCurrentAgentDefinition as resolveCoreAgentDefinition,
  runAgentTurn as coreRunAgentTurn,
  type AgentDefinition,
  type AgentRunResult,
  type AgentTurnScope,
} from "@novel-master/core/agent";
import type { AnnotateDraft, MessageAttachment } from "@novel-master/core/chat";

import type { AppError } from "@novel-master/core/errors";
import type { Result } from "@novel-master/core/errors";
import { createLogger } from "@novel-master/core/log";
import { isDesktopLlmDebug } from "../log/llm-debug-flag.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

const log = createLogger("desktop.agent-run");

export type AgentRunScope = AgentTurnScope;

/**
 * resolve 链失败转码（错误通道迁移五期跨片收口）：core 的 resolve 系沿
 * `Result.err` 回传已知失败（不再 throw），转码统一走 core 的 `mapResolveError`——
 * 失败原样抛 `AppError`（自带 key / messageKey），对 desktop 消费方保持旧的
 * throw 契约。
 *
 * `resolveCurrentAgentId` 的转码面为空（core 该函数只可能回传 infra 读失败，
 * 不会产 resolve key），属薄壳，已删；调用点直接用 core 的 `Result` 通道。
 *
 * 本文件这两个 resolve 壳**不是**历史残留（十七期第2轮签名审计 R2 组6 反证）：
 * desktop 有两个 core 之外的消费点（`ipc/handlers/agent.ts` 的 resolveCurrent
 * 回包与 run 前置闸），两处都消费 throw 契约——前置闸连返回值都不接，唯一可观测
 * 行为就是抛错；单测也钉死了 `rejects`（`test/agent-run-saved-model-session.test.ts`）。
 * mobile 没有这两个壳是因为它的同名读口直调 core 并就地处理 `Result`，没有这层
 * throw 边界。名字里的 `OrThrow` 就是这层语义（与 `getDesktopRuntimeOrThrow` 同款），
 * 防止后来者把它当裸值 getter 用。
 */
export async function resolveCurrentAgentDefinitionOrThrow(runtime: DesktopNovelMasterRuntime): Promise<{ agentId: string; definition: AgentDefinition }> {
  return mapResolveError(() => resolveCoreAgentDefinition(runtime));
}

/** {@link resolveCurrentAgentDefinitionOrThrow} 的模型侧同款：失败原样抛 `AppError`，其余不变。 */
export async function resolveDesktopSavedModelIdOrThrow(runtime: DesktopNovelMasterRuntime, definition: AgentDefinition, sessionId: string): Promise<{ savedModelId: string; workspaceModelId: string }> {
  return mapResolveError(() => resolveApplicationModelIdForRun(runtime, definition, sessionId));
}

type RunAgentTurnOptions = {
  readonly stream?: boolean;
  readonly allowResumeWithoutInput?: boolean;
  readonly attachments?: readonly MessageAttachment[];
  readonly annotateDrafts?: readonly AnnotateDraft[];
  readonly signal?: AbortSignal;
  readonly onUserMessageAppended?: () => void | Promise<void>;
};

export async function runAgentTurnAdapter(runtime: DesktopNovelMasterRuntime, scope: AgentRunScope, userContent: string, options?: RunAgentTurnOptions): Promise<Result<AgentRunResult, AppError>> {
  return coreRunAgentTurn(runtime, scope, userContent, {
    ...options,
    onAfterResolveModel: async (ctx) => {
      if (!isDesktopLlmDebug()) {
        return;
      }
      // 错误通道迁移七期：getSavedById 沿 Result 回传已知失败，读不到按缺省
      // unknown 收——恢复四期前 `saved?.providerId ?? "unknown"` 的口径，debug
      // 日志钩子不允许杀死整轮 run（core 对本回调的抛错无 catch，会直接判负）。
      const saved = await runtime.providerModels.getSavedById(ctx.savedModelId);
      const providerId = saved.ok ? saved.value?.providerId ?? "unknown" : "unknown";
      const vendorModelId = saved.ok ? saved.value?.vendorModelId ?? ctx.savedModelId : ctx.savedModelId;
      try {
        const provider = await runtime.providers.get(providerId);
        // 已知失败与未知异常同一出口（warn 后返回，不杀 run）。
        if (!provider.ok) {
          log.warn("agent-run provider lookup failed", { providerId, savedModelId: ctx.savedModelId, error: provider.error });
          return;
        }
        log.info("agent-run start", {
          sessionId: ctx.scope.sessionId,
          projectId: ctx.scope.projectId,
          providerId,
          protocol: provider.value.protocol,
          baseUrl: provider.value.baseUrl,
          vendorModelId,
          savedModelId: ctx.savedModelId,
          stream: ctx.stream,
        });
      } catch (lookupError) {
        log.warn("agent-run provider lookup failed", { providerId, savedModelId: ctx.savedModelId, error: lookupError });
      }
    },
    onRunFailed: (ctx) => {
      log.error("agent-run failed", {
        stage: ctx.stage,
        sessionId: ctx.scope.sessionId,
        projectId: ctx.scope.projectId,
        savedModelId: ctx.savedModelId,
        stream: ctx.stream,
        error: ctx.error,
      });
    },
  });
}
