/**
 * Desktop agent run — thin wrapper over core {@link runAgentTurn}.
 *
 * @module services/agent-run
 */
import {
  AgentTurnError,
  mapResolveError,
  resolveApplicationModelIdForRun,
  resolveCurrentAgentDefinition as resolveCoreAgentDefinition,
  resolveCurrentAgentId as resolveCoreAgentId,
  runAgentTurn as coreRunAgentTurn,
  type AgentDefinition,
  type AgentRunResult,
  type AgentTurnScope,
} from "@novel-master/core/agent";
import type { AnnotateDraft, MessageAttachment } from "@novel-master/core/chat";

import type { AppError } from "@novel-master/core/agent";
import type { Result } from "@novel-master/core/errors";
import { createLogger } from "@novel-master/core/log";
import { isDesktopLlmDebug } from "../log/llm-debug-flag.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

const log = createLogger("desktop.agent-run");

export type AgentRunScope = AgentTurnScope;

export { AgentTurnError as AgentRunError };

/**
 * resolve 链失败转码（错误通道迁移五期跨片收口）：core 的 resolve 系沿
 * `Result.err` 回传已知失败（不再 throw），转码统一走 core 的 `mapResolveError`——
 * resolve key 转 `AgentTurnError`，其余原样抛，对 desktop 消费方保持旧的 throw 契约。
 */
export async function resolveCurrentAgentId(runtime: DesktopNovelMasterRuntime): Promise<string | undefined> {
  // 错误通道迁移五期：core resolveCurrentAgentId 沿 Result 回传；infra 失败
  // (非 resolve key) 原样上抛，成功解包取值。
  return mapResolveError(() => resolveCoreAgentId(runtime));
}

export async function resolveCurrentAgentDefinition(runtime: DesktopNovelMasterRuntime): Promise<{ agentId: string; definition: AgentDefinition }> {
  return mapResolveError(() => resolveCoreAgentDefinition(runtime));
}

export async function resolveDesktopSavedModelId(runtime: DesktopNovelMasterRuntime, definition: AgentDefinition, sessionId: string): Promise<{ savedModelId: string; workspaceModelId: string }> {
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

export async function runAgentTurn(runtime: DesktopNovelMasterRuntime, scope: AgentRunScope, userContent: string, options?: RunAgentTurnOptions): Promise<Result<AgentRunResult, AppError>> {
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
