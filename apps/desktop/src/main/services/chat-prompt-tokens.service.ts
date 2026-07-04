/**
 * Chat meta bar token labels (aligns with CLI `prompt render --tokens`).
 *
 * @module services/chat-prompt-tokens
 */
import { resolveApplicationModelId } from "@novel-master/core/agent";

import {
  countPromptLlmInput,
  countPromptLlmInputHeuristicOnly,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
} from "@novel-master/core/provider";
import type { PromptChatTokenStatsResponse } from "../../../shared/ipc-types.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { formatTokenCount } from "../utils/format-token-count.js";
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
      ? `${prefix}${current} tokens (est.) · ${stats.counterKind}`
      : `${current} tokens · ${stats.counterKind}`;
  }
  const pct = stats.pct ?? 0;
  return `${prefix}${pct}% • ${current}/${formatTokenCount(stats.contextWindow)} · ${stats.counterKind}`;
}

export async function loadChatPromptTokenStats(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse> {
  const { definition, layout, ctx } = await buildSessionPromptInput(
    runtime,
    scope,
  );

  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? "";
  const savedModelId = resolveApplicationModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });

  if (!savedModelId) {
    const serialized = await serializePromptLlmInput(layout, ctx);
    const count = runtime.tokenCounters.heuristic.countText(serialized);
    return buildTokenStats(count, true, "heuristic", undefined);
  }

  const tokenizerOverride = await resolveTokenCounterModeForModel(
    runtime.providerModels,
    savedModelId,
  );

  const result = await countPromptLlmInput({
    layout,
    ctx,
    savedModelId,
    registry: runtime.tokenCounters,
    tokenizerOverride,
    savedModels: runtime.savedModelRepo,
  });

  const contextWindow =
    await runtime.providerModels.getContextWindow(savedModelId);

  return buildTokenStats(
    result.tokenCount,
    result.estimated,
    result.counterKind,
    contextWindow ?? undefined,
  );
}

async function loadChatPromptTokenStatsFallback(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse> {
  const { definition, layout, ctx } = await buildSessionPromptInput(
    runtime,
    scope,
  );

  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? "";
  const savedModelId = resolveApplicationModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });

  if (!savedModelId) {
    const serialized = await serializePromptLlmInput(layout, ctx);
    const count = runtime.tokenCounters.heuristic.countText(serialized);
    return buildTokenStats(count, true, "heuristic", undefined);
  }

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

  return buildTokenStats(
    result.tokenCount,
    result.estimated,
    result.counterKind,
    contextWindow,
  );
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
