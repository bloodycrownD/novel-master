/**
 * Chat meta bar token labels (aligns with CLI `prompt render --tokens`).
 *
 * @module services/chat-prompt-tokens
 *
 * Boundary: per-model counter mode comes from
 * {@link resolveTokenCounterModeForModel} → `resolveCurrentPromptTokens`（API 优先，否则本地）。
 * {@link loadChatPromptTokenLabelResilient} falls back to visible-message heuristic
 * (`counterKind: "heuristic"`) when {@link buildSessionPromptInput} throws.
 *
 * stream-metrics-native ④：两处「拿不到模型 / 构建失败」的早退路径原本走
 * `runtime.tokenCounters.heuristic.countText`（`ceil(字符数 / 3.35)`）。该折算
 * 是**英文**口径，对中文正文系统性低估 82%~84%，而这两处恰恰是最需要保守
 * 估计的场景，故已改走 RN 驱动的 cl100k 真分词器（`counterKind` 仍是
 * `heuristic`、`estimated: true`——**近似**这件事不变，变的是读数本身）。
 */
import {resolveSavedModelId} from '@novel-master/core/agent';

import {messageBodyText} from '@novel-master/core/prompt';

import {
  resolvePromptTokensWithBackfill,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
} from '@novel-master/core/provider';
import {
  chatTokenLabelMemo,
  computeChatTokenLabelStamp,
} from '@novel-master/core/provider';
import {countTextWithDefaultEncoding} from '@novel-master/tokenizer-driver-rn/encoding';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
// badge/label 走 common 入口取真身实现（token-source-label 单源；本套件的
// jest 会整体 mock `@novel-master/core/provider`，经 common 直取可让 T-TL4
// 对拍 core 真实现而非 mock 行为）。
import {
  formatContextUsageLabel,
  formatTokenSourceBadge,
} from '@novel-master/core/common';
import {
  buildSessionPromptInput,
  type SessionPromptScope,
} from './session-prompt-input.service';

/**
 * 兜底口径的 token 数：真 cl100k 计数优先，编码表建不起来才退回字符折算。
 *
 * 为什么不直接用 `runtime.tokenCounters.heuristic.countText`：那个 port 是
 * **同步**计数器且口径就是 `ceil(chars / 3.35)`，在中文下低估八成。RN 侧已经
 * 有可用的真分词器（且会话切换时已被 `primeStreamTokenModelHint` 空闲预热过
 * cl100k 兜底表），用它没有额外成本。
 */
function countFallbackTokens(
  runtime: MobileNovelMasterRuntime,
  serialized: string,
): number {
  const real = countTextWithDefaultEncoding(serialized);
  if (real != null) {
    return real;
  }
  return runtime.tokenCounters.heuristic.countText(serialized);
}

/**
 * 占用标签（源记号 + =/≈ 连接符 + pct + 占比）由 core 的
 * `formatTokenSourceBadge` + `formatContextUsageLabel` 统一给出，
 * 本文件不再自备一份映射（与 desktop main 的 buildTokenStats 同源同形）。
 */
function formatChatTokenLabel(
  result: {
    tokenCount: number;
    estimated: boolean;
    counterKind: string;
    source?: 'api' | 'local';
  },
  contextWindow: number | undefined,
): string {
  const badge = formatTokenSourceBadge(
    result.source,
    result.counterKind,
    result.estimated,
  );
  return formatContextUsageLabel(result.tokenCount, contextWindow, badge);
}

/** Token label for chat header (e.g. `gemma = 24k / 128k (19%)` 或 `远程 = 24k / 128k (19%)`). */
export async function loadChatPromptTokenLabel(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  // ---- memo 快路径（chat-token-label-memo）----
  // 计数链已全缓存（L1），但重组装（拉消息+规则快照+file_cache 解压+序列化）
  // 在大会话上仍是数百 ms；重进会话无变更时用 stamp 指纹直接返回上次标签，
  // 组装/序列化/哈希全跳。盲区与拍板见 memo 模块头注释。
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(
    scope.sessionId,
  );
  const stamp = await computeChatTokenLabelStamp(
    scope.sessionId,
    {
      sessions: runtime.sessions,
      messages: runtime.messages,
      sessionKkv: runtime.sessionKkv,
    },
    sessionConfig.modelId,
  );
  const memoized = chatTokenLabelMemo.get(scope.sessionId, stamp);
  if (memoized != null) {
    return memoized;
  }

  const {definition, layout, ctx, rawMessages} = await buildSessionPromptInput(
    runtime,
    scope,
  );

  // core 移除 workspace 回退后，savedModelId 解析优先级为 agent pin → session modelId。
  const savedModelId = resolveSavedModelId({
    agentModelId: definition.model,
    sessionModelId: sessionConfig.modelId,
  });

  let label: string;
  if (!savedModelId) {
    // 此处恒不拼 tools（UI 读口拿不到定义，`session-prompt-input` 不产 tools）：
    // 口径差是已登记收窄（见 ③ spec `:46`），不要以为拼了就是全量。
    // 压缩评估路径由 agent-runner 传 tools，那是真口径（取舍说明见
    // `serializeToolsForTokenCount` 头注释）。
    const serialized = await serializePromptLlmInput(layout, ctx);
    // 无模型可用 → 只能按默认编码估算。仍然走真分词器（cl100k）而不是字符折算：
    // 「预估」标签与 counterKind 语义不变，变的是读数——cl100k 已在会话切换
    // 时被 primeStreamTokenModelHint 空闲预热，这里不会再白付一次构造。
    const count = countFallbackTokens(runtime, serialized);
    label = formatChatTokenLabel(
      {tokenCount: count, estimated: true, counterKind: 'heuristic', source: 'local'},
      undefined,
    );
  } else {
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

    label = formatChatTokenLabel(result, contextWindow ?? undefined);
  }

  chatTokenLabelMemo.set(scope.sessionId, stamp, label);
  return label;
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
  const count = countFallbackTokens(runtime, serialized);

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
