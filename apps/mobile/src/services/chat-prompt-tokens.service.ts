/**
 * Estimates full prompt token usage for chat meta bar (aligns with CLI `prompt render --tokens`).
 */
import {
  countPromptLlmInput,
  messageBodyText,
  parseApplicationModelId,
  resolveApplicationModelId,
  serializePromptLlmInput,
} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {formatPromptTokenUsageLabel} from '../utils/format-token-count';
import {buildSessionPromptInput, type SessionPromptScope} from './session-prompt-input.service';

/** Token label for chat header (e.g. `88% • 327/128K`). */
export async function loadChatPromptTokenLabel(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  const {definition, blocks, ctx} = await buildSessionPromptInput(runtime, scope);

  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? '';
  const applicationModelId = resolveApplicationModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });

  if (!applicationModelId) {
    const serialized = serializePromptLlmInput(blocks, ctx);
    const count = runtime.tokenCounters.heuristic.countText(serialized);
    return formatPromptTokenUsageLabel(count, undefined, {estimated: true});
  }

  const result = await countPromptLlmInput({
    blocks,
    ctx,
    applicationModelId,
    registry: runtime.tokenCounters,
  });

  const contextWindow =
    await runtime.providerModels.getContextWindow(applicationModelId);

  return formatPromptTokenUsageLabel(result.tokenCount, contextWindow ?? undefined, {
    estimated: result.estimated,
  });
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
  let applicationModelId: string | undefined;
  try {
    const {definition} = await buildSessionPromptInput(runtime, scope);
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

  return formatPromptTokenUsageLabel(count, contextWindow, {estimated: true});
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

