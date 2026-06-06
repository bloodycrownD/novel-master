/**
 * Chat meta bar token labels (aligns with CLI `prompt render --tokens`).
 *
 * @module services/chat-prompt-tokens
 */
import {
  countPromptLlmInput,
  messageBodyText,
  resolveApplicationModelId,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
} from "@novel-master/core";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { formatPromptTokenUsageLabel } from "../utils/format-token-count.js";
import {
  buildSessionPromptInput,
  type SessionPromptScope,
} from "./session-prompt-input.service.js";

function formatChatTokenLabel(
  result: { tokenCount: number; estimated: boolean; counterKind: string },
  contextWindow: number | undefined,
): string {
  const base = formatPromptTokenUsageLabel(result.tokenCount, contextWindow, {
    estimated: result.estimated,
  });
  return `${base} · ${result.counterKind}`;
}

export async function loadChatPromptTokenLabel(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  const { definition, blocks, ctx } = await buildSessionPromptInput(
    runtime,
    scope,
  );

  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? "";
  const applicationModelId = resolveApplicationModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });

  if (!applicationModelId) {
    const serialized = serializePromptLlmInput(blocks, ctx);
    const count = runtime.tokenCounters.heuristic.countText(serialized);
    return formatChatTokenLabel(
      { tokenCount: count, estimated: true, counterKind: "heuristic" },
      undefined,
    );
  }

  const tokenizerOverride = await resolveTokenCounterModeForModel(
    runtime.providerModels,
    applicationModelId,
  );

  const result = await countPromptLlmInput({
    blocks,
    ctx,
    applicationModelId,
    registry: runtime.tokenCounters,
    tokenizerOverride,
  });

  const contextWindow =
    await runtime.providerModels.getContextWindow(applicationModelId);

  return formatChatTokenLabel(result, contextWindow ?? undefined);
}

async function loadChatPromptTokenLabelFallback(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
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

  return formatChatTokenLabel(
    { tokenCount: count, estimated: true, counterKind: "heuristic" },
    contextWindow,
  );
}

export async function loadChatPromptTokenLabelResilient(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  try {
    return await loadChatPromptTokenLabel(runtime, scope);
  } catch {
    return loadChatPromptTokenLabelFallback(runtime, scope);
  }
}
