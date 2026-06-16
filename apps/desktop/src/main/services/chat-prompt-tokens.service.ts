/**
 * Chat meta bar token labels (aligns with CLI `prompt render --tokens`).
 *
 * @module services/chat-prompt-tokens
 */
import { resolveApplicationModelId } from "@novel-master/core/agent";

import { messageBodyText } from "@novel-master/core/prompt";

import { countPromptLlmInput, resolveTokenCounterModeForModel, serializePromptLlmInput } from "@novel-master/core/provider";
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
  const applicationModelId = resolveApplicationModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });

  if (!applicationModelId) {
    const serialized = await serializePromptLlmInput(layout, ctx);
    const count = runtime.tokenCounters.heuristic.countText(serialized);
    return buildTokenStats(count, true, "heuristic", undefined);
  }

  const tokenizerOverride = await resolveTokenCounterModeForModel(
    runtime.providerModels,
    applicationModelId,
  );

  const result = await countPromptLlmInput({
    layout,
    ctx,
    applicationModelId,
    registry: runtime.tokenCounters,
    tokenizerOverride,
  });

  const contextWindow =
    await runtime.providerModels.getContextWindow(applicationModelId);

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
  const all = await runtime.messages.listBySession(scope.sessionId);
  const visible = all.filter((m) => !m.hidden);
  const serialized = visible
    .map((m) => `${m.role}: ${messageBodyText(m)}`)
    .join("\n\n");
  const count = runtime.tokenCounters.heuristic.countText(serialized);

  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? "";
  let applicationModelId: string | undefined;
  try {
    const { definition } = await buildSessionPromptInput(runtime, scope);
    applicationModelId = resolveApplicationModelId({
      agentModelId: definition.model,
      workspaceModelId: workspaceModelId || undefined,
    });
  } catch {
    applicationModelId = workspaceModelId || undefined;
  }

  let contextWindow: number | undefined;
  if (applicationModelId) {
    try {
      const cw =
        await runtime.providerModels.getContextWindow(applicationModelId);
      contextWindow = cw ?? undefined;
    } catch {
      contextWindow = undefined;
    }
  }

  return buildTokenStats(count, true, "heuristic", contextWindow);
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
