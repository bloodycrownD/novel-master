/**
 * Desktop agent run — thin wrapper over core {@link runAgentTurn}.
 *
 * @module services/agent-run
 */
import {
  AGENT_RUN_RESOLVE_KEYS,
  AgentTurnError,
  isAppError,
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
 * resolve 链失败转码（错误通道迁移五期跨片收口）：core 的 resolve 系已改沿
 * `Result.err 返回已知失败（不再 throw），本包装同时接住两条通道——
 * 返回值通道（`{ok:false} 解包 + key 判定转 AgentTurnError）与既有异常
 * 通道（catch 里同款判定），转码结果对 desktop 消费方保持旧的 throw 契约。
 */
function mapResolveError<T>(fn: () => Promise<unknown>): Promise<T> {
  const transcode = (error: unknown): never => {
    if (isAppError(error) && AGENT_RUN_RESOLVE_KEYS.has(error.key)) {
      throw new AgentTurnError(error.message);
    }
    throw error;
  };
  return fn()
    .then((value) => {
      // Result 形状按运行时判定（core 侧签名 Result 化后部分 resolver 仍走 throw）
      if (value != null && typeof value === "object" && "ok" in value && ((value as { ok: unknown }).ok === true || (value as { ok: unknown }).ok === false)) {
        const result = value as Result<unknown, AppError>;
        if (!result.ok) return transcode(result.error);
        return result.value as T;
      }
      return value as T;
    })
    .catch((error: unknown) => transcode(error));
}

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
