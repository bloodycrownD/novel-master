/**
 * Chat meta bar token labels (aligns with CLI `prompt render --tokens`).
 *
 * @module services/chat-prompt-tokens
 */
import { resolveSavedModelId } from "@novel-master/core/agent";

import {
  countPromptLlmInputHeuristicOnly,
  formatCounterKindLabel,
  resolvePromptTokensWithBackfill,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
} from "@novel-master/core/provider";
import type { PromptChatTokenStatsResponse } from "../../../shared/ipc-types.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { formatTokenCount } from "@novel-master/core/common";
import {
  buildSessionPromptInput,
  type SessionPromptScope,
} from "./session-prompt-input.service.js";

function buildTokenStats(
  tokenCount: number,
  estimated: boolean,
  counterKind: string,
  contextWindow: number | undefined,
): PromptChatTokenStatsResponse {
  const pct =
    contextWindow != null && contextWindow > 0
      ? Math.min(999, Math.round((tokenCount / contextWindow) * 100))
      : undefined;
  return {
    tokenCount,
    contextWindow,
    pct,
    estimated,
    counterKind,
  };
}

export function formatChatTokenStatsLabel(
  stats: PromptChatTokenStatsResponse,
): string {
  const prefix = stats.estimated ? "~" : "";
  const current = formatTokenCount(stats.tokenCount);
  if (stats.contextWindow == null || stats.contextWindow <= 0) {
    return stats.estimated
      ? `${prefix}${current} tokens (est.) · ${formatCounterKindLabel(stats.counterKind)}`
      : `${current} tokens · ${formatCounterKindLabel(stats.counterKind)}`;
  }
  const pct = stats.pct ?? 0;
  return `${prefix}${pct}% • ${current}/${formatTokenCount(stats.contextWindow)} · ${formatCounterKindLabel(stats.counterKind)}`;
}

// 共用的会话输入快照：避免主路径和 fallback 各自重复读取 sessionConfig。
type SessionPromptInput = Awaited<ReturnType<typeof buildSessionPromptInput>>;
// 传给计数分叉的参数：计数必需的三项 + rawMessages（cache miss 时回填用）。
type CountArgs = Pick<SessionPromptInput, "layout" | "ctx" | "rawMessages"> & {
  savedModelId: string;
};
type CountResult = {
  tokenCount: number;
  estimated: boolean;
  counterKind: string;
  contextWindow: number | undefined;
};

// 主路径与 fallback 的公共骨架：负责构造输入、读取 sessionConfig、解析 savedModelId，
// 以及 savedModelId 缺失时的 heuristic 早退。只有真正调用 token counter 的部分通过 countFn 分叉。
async function computeChatPromptTokenStats(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
  countFn: (args: CountArgs) => Promise<CountResult>,
): Promise<PromptChatTokenStatsResponse> {
  const { definition, layout, ctx, rawMessages } = await buildSessionPromptInput(
    runtime,
    scope,
  );

  // workspace 层已移除：模型解析链为 agent pin → session.modelId。
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(
    scope.sessionId,
  );
  const savedModelId = resolveSavedModelId({
    agentModelId: definition.model,
    sessionModelId: sessionConfig.modelId,
  });

  if (!savedModelId) {
    const serialized = await serializePromptLlmInput(layout, ctx);
    const count = runtime.tokenCounters.heuristic.countText(serialized);
    return buildTokenStats(count, true, "heuristic", undefined);
  }

  const { tokenCount, estimated, counterKind, contextWindow } =
    await countFn({ layout, ctx, savedModelId, rawMessages });
  return buildTokenStats(tokenCount, estimated, counterKind, contextWindow);
}

export async function loadChatPromptTokenStats(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse> {
  return computeChatPromptTokenStats(runtime, scope, async (args) => {
    const { layout, ctx, savedModelId, rawMessages } = args;
    const tokenizerOverride = await resolveTokenCounterModeForModel(
      runtime.providerModels,
      savedModelId,
    );
    const params = {
      layout,
      ctx,
      savedModelId,
      registry: runtime.tokenCounters,
      tokenizerOverride,
      savedModels: runtime.savedModelRepo,
    };
    // 直接 resolve（历史上的 cache miss 回填步骤已废弃：置位/压缩后旧值不准，
    // 统一走本地 tokenizer 重算）。compaction trigger 不走这里，行为不变。
    const result = await resolvePromptTokensWithBackfill(
      scope.sessionId,
      rawMessages,
      params,
    );
    const contextWindow =
      await runtime.providerModels.getContextWindow(savedModelId);
    return {
      tokenCount: result.tokenCount,
      estimated: result.estimated,
      counterKind: result.counterKind,
      contextWindow: contextWindow ?? undefined,
    };
  });
}

async function loadChatPromptTokenStatsFallback(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse> {
  return computeChatPromptTokenStats(runtime, scope, async (args) => {
    const { layout, ctx, savedModelId } = args;
    const result = await countPromptLlmInputHeuristicOnly({
      layout,
      ctx,
      savedModelId,
      registry: runtime.tokenCounters,
      savedModels: runtime.savedModelRepo,
    });

    let contextWindow: number | undefined;
    try {
      const cw =
        await runtime.providerModels.getContextWindow(savedModelId);
      contextWindow = cw ?? undefined;
    } catch {
      contextWindow = undefined;
    }

    return {
      tokenCount: result.tokenCount,
      estimated: result.estimated,
      counterKind: result.counterKind,
      contextWindow,
    };
  });
}

export async function loadChatPromptTokenStatsResilient(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse> {
  try {
    return await loadChatPromptTokenStats(runtime, scope);
  } catch {
    return loadChatPromptTokenStatsFallback(runtime, scope);
  }
}

/** @deprecated Use loadChatPromptTokenStatsResilient — kept for label-only callers. */
export async function loadChatPromptTokenLabelResilient(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  const stats = await loadChatPromptTokenStatsResilient(runtime, scope);
  return formatChatTokenStatsLabel(stats);
}
