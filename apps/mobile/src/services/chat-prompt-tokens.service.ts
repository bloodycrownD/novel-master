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
import { resolveApplicationModelId } from "@novel-master/core/agent";

import { messageBodyText } from "@novel-master/core/prompt";

import {
  resolveCurrentPromptTokens,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
} from "@novel-master/core/provider";
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {formatPromptTokenUsageLabel} from '../utils/format-token-count';
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
  const {definition, layout, ctx} = await buildSessionPromptInput(runtime, scope);

  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? '';
  const savedModelId = resolveApplicationModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
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

  const result = await resolveCurrentPromptTokens(scope.sessionId, {
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
    savedModelId = resolveApplicationModelId({
      agentModelId: definition.model,
      workspaceModelId: workspaceModelId || undefined,
    });
  } catch {
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
