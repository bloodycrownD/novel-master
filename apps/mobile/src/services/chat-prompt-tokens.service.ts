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
import {resolveSavedModelId} from '@novel-master/core/agent';

import {messageBodyText} from '@novel-master/core/prompt';

import {
  resolvePromptTokensWithBackfill,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
  serializeToolsForTokenCount,
} from '@novel-master/core/provider';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {formatPromptTokenUsageLabel} from '@novel-master/core/common';
import {
  buildSessionPromptInput,
  type SessionPromptScope,
} from './session-prompt-input.service';

/**
 * 占用来源两态标签：`api` → 「上次请求」（值取自上次 completed run 的
 * `usage.prompt_tokens`），否则 → 「预估」（本地 tokenizer 估算）。
 *
 * 与分词器维度标签（`formatCounterKindLabel`，api/heuristic 都显示「自动」）
 * 有意分开：那个说的是「用哪个分词器」，这个说的是「值从哪来」。
 */
function formatTokenSourceLabel(source: 'api' | 'local' | undefined): string {
  return source === 'api' ? '上次请求' : '预估';
}

function formatChatTokenLabel(
  result: {
    tokenCount: number;
    estimated: boolean;
    counterKind: string;
    source?: 'api' | 'local';
  },
  contextWindow: number | undefined,
): string {
  const base = formatPromptTokenUsageLabel(result.tokenCount, contextWindow, {
    estimated: result.estimated,
  });
  return `${base} · ${formatTokenSourceLabel(result.source)}`;
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
    // UI 读口拿不到 tools 定义（`session-prompt-input` 不产 tools）：显式传
    // undefined，本地预估仍不含 tools 段；压缩评估路径由 agent-runner 传 tools
    // （取舍说明见 `serializeToolsForTokenCount` 头注释）。
    const serialized =
      (await serializePromptLlmInput(layout, ctx)) +
      serializeToolsForTokenCount(undefined);
    const count = runtime.tokenCounters.heuristic.countText(serialized);
    return formatChatTokenLabel(
      {tokenCount: count, estimated: true, counterKind: 'heuristic', source: 'local'},
      undefined,
    );
  }

  const tokenizerOverride = await resolveTokenCounterModeForModel(
    runtime.providerModels,
    savedModelId,
  );

  // 直接 resolve（历史上的 cache miss 回填步骤已废弃：置位/压缩后旧值不准，
  // 统一走本地 tokenizer 重算）。传 sessionKkv：命中上次 completed run 落库的
  // API 占用（含跨重启），与压缩评估同一读口、同一口径。
  const result = await resolvePromptTokensWithBackfill(
    scope.sessionId,
    rawMessages,
    {
      layout,
      ctx,
      savedModelId,
      registry: runtime.tokenCounters,
      tokenizerOverride,
      savedModels: {findById: id => runtime.providerModels.getSavedById(id)},
    },
    {sessionKkv: runtime.sessionKkv},
  );

  const contextWindow = await runtime.providerModels.getContextWindow(
    savedModelId,
  );

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
      const cw = await runtime.providerModels.getContextWindow(savedModelId);
      contextWindow = cw ?? undefined;
    } catch {
      contextWindow = undefined;
    }
  }

  return formatChatTokenLabel(
    {tokenCount: count, estimated: true, counterKind: 'heuristic', source: 'local'},
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
      console.warn(
        '[chat] prompt token count failed, using message fallback',
        error,
      );
    }
    return loadChatPromptTokenLabelFallback(runtime, scope);
  }
}
