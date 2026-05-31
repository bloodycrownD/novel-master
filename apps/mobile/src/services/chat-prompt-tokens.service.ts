/**
 * Estimates full prompt token usage for chat meta bar (aligns with CLI `prompt render --tokens`).
 */
import {
  messageBodyText,
  mergeSamplingWithDefaults,
  maxOutputTokensFromSampling,
  parseApplicationModelId,
  resolveApplicationModelId,
  serializePromptLlmInput,
} from '@novel-master/core';
import type {LlmProtocolKind} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {formatPromptTokenUsageLabel} from '../utils/format-token-count';
import {buildSessionPromptInput, type SessionPromptScope} from './session-prompt-input.service';

async function resolveMaxOutputTokens(
  runtime: MobileNovelMasterRuntime,
  applicationModelId: string | undefined,
): Promise<number | undefined> {
  if (!applicationModelId) {
    return undefined;
  }
  try {
    const {providerId} = parseApplicationModelId(applicationModelId);
    const provider = await runtime.providers.get(providerId);
    const protocol: LlmProtocolKind = provider.protocol;
    const profile =
      await runtime.modelSamplingProfiles.getProfile(applicationModelId);
    const stored =
      profile?.enabled && profile.params != null ? profile.params : undefined;
    const effective = mergeSamplingWithDefaults(protocol, stored);
    return maxOutputTokensFromSampling(effective);
  } catch {
    return undefined;
  }
}

/** Token label for chat header (e.g. `88% • 327/4096`). */
export async function loadChatPromptTokenLabel(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  const {definition, input} = await buildSessionPromptInput(runtime, scope);
  const serialized = serializePromptLlmInput(input);

  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? '';
  const applicationModelId = resolveApplicationModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });

  let counter = runtime.tokenCounters.heuristic;
  if (applicationModelId) {
    try {
      const {providerId, vendorModelId} =
        parseApplicationModelId(applicationModelId);
      const saved = await runtime.providerModels.savedList(providerId);
      if (saved.some(m => m.vendorModelId === vendorModelId)) {
        counter =
          await runtime.tokenCounters.forApplicationModel(applicationModelId);
      }
    } catch {
      // keep heuristic
    }
  }

  const count = counter.countText(serialized);
  const maxTokens = await resolveMaxOutputTokens(runtime, applicationModelId);
  return formatPromptTokenUsageLabel(count, maxTokens);
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
  const maxTokens = await resolveMaxOutputTokens(runtime, applicationModelId);
  return formatPromptTokenUsageLabel(count, maxTokens);
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
