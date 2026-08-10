/**
 * Chat meta bar token labels (aligns with CLI `prompt render --tokens`).
 *
 * @module services/chat-prompt-tokens
 *
 * Boundary: per-model counter mode comes from
 * {@link resolveTokenCounterModeForModel} → `resolveCurrentPromptTokens`（API 优先，否则本地）。
 * {@link loadChatPromptTokenLabelResilient} falls back to visible-message heuristic
 * (`counterKind: "heuristic"`) when {@link buildSessionPromptInput} throws.
 */
import { resolveSavedModelId } from "@novel-master/core/agent";

import { messageBodyText } from "@novel-master/core/prompt";

import {
  resolvePromptTokensWithBackfill,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
} from "@novel-master/core/provider";
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {formatPromptTokenUsageLabel} from '@novel-master/core/common';
import {buildSessionPromptInput, type SessionPromptScope} from './session-prompt-input.service';

function formatChatTokenLabel(
  result: {tokenCount: number; estimated: boolean; counterKind: string},
  contextWindow: number | undefined,
): string {
  const base = formatPromptTokenUsageLabel(result.tokenCount, contextWindow, {
    estimated: result.estimated,
  });
  return `${base} · ${result.counterKind}`;
}

/** Token label for chat header (e.g. `88% • 327/128K · gemma` 或 `· api`). */
export async function loadChatPromptTokenLabel(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  const {definition, layout, ctx, rawMessages} = await buildSessionPromptInput(
    runtime,
    scope,
  );

  // core 移除 workspace 回退后，savedModelId 解析优先级为 agent pin → session modelId。
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
    return formatChatTokenLabel(
      {tokenCount: count, estimated: true, counterKind: 'heuristic'},
      undefined,
    );
  }

  const tokenizerOverride = await resolveTokenCounterModeForModel(
    runtime.providerModels,
    savedModelId,
  );

  // cache miss → 从 bundle 的 rawMessages 回填，命中就重 resolve 一次（这次
  // 会走 source=api）。compaction trigger 不走这里，行为不变。
  const result = await resolvePromptTokensWithBackfill(scope.sessionId, rawMessages, {
    layout,
    ctx,
    savedModelId,
    registry: runtime.tokenCounters,
    tokenizerOverride,
  });

  const contextWindow =
    await runtime.providerModels.getContextWindow(savedModelId);

  return formatChatTokenLabel(result, contextWindow ?? undefined);
}

/** Message-only heuristic when full prompt build fails (still useful in meta bar). */
async function loadChatPromptTokenLabelFallback(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  const all = await runtime.messages.listBySession(scope.sessionId);
  const visible = all.filter(m => !m.hidden);
  const serialized = visible
    .map(m => `${m.role}: ${messageBodyText(m)}`)
    .join('\n\n');
  const count = runtime.tokenCounters.heuristic.countText(serialized);

  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? '';
  let savedModelId: string | undefined;
  try {
    const {definition} = await buildSessionPromptInput(runtime, scope);
    const sessionConfig = await runtime.sessions.getSessionAgentConfig(
      scope.sessionId,
    );
    savedModelId = resolveSavedModelId({
      agentModelId: definition.model,
      sessionModelId: sessionConfig.modelId,
    });
  } catch {
    // 兜底显示用 workspace 当前模型（仅用于查 contextWindow，不参与 runtime 解析）。
    savedModelId = workspaceModelId || undefined;
  }

  let contextWindow: number | undefined;
  if (savedModelId) {
    try {
      const cw =
        await runtime.providerModels.getContextWindow(savedModelId);
      contextWindow = cw ?? undefined;
    } catch {
      contextWindow = undefined;
    }
  }

  return formatChatTokenLabel(
    {tokenCount: count, estimated: true, counterKind: 'heuristic'},
    contextWindow,
  );
}

/**
 * Full prompt token estimate; falls back to visible messages only on error.
 */
export async function loadChatPromptTokenLabelResilient(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  try {
    return await loadChatPromptTokenLabel(runtime, scope);
  } catch (error) {
    if (__DEV__) {
      console.warn('[chat] prompt token count failed, using message fallback', error);
    }
    return loadChatPromptTokenLabelFallback(runtime, scope);
  }
}
