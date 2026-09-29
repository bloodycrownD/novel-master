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

/**
 * 单发标签（完整口径：api 优先、miss 走家族计数器）。两阶段 UI 刷新用
 * {@link loadChatPromptTokenLabelResilient}；本函数留给单测与一次性取数场景。
 */
export async function loadChatPromptTokenLabel(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  return (await loadChatTokenLabelWithFlag(runtime, scope, false)).label;
}

/**
 * 估算首帧是否值得后台升级：只有「resolve 走了本地估算档」才升级（api 命中
 * 已精确、无模型/构建失败路径没有更好的档位可升）。
 */
async function loadChatTokenLabelWithFlag(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
  preferEstimate: boolean,
): Promise<{label: string; upgradeWorthy: boolean}> {
  const {definition, layout, ctx, rawMessages} = await buildSessionPromptInput(
    runtime,
    scope,
  );
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(
    scope.sessionId,
  );
  const savedModelId = resolveSavedModelId({
    agentModelId: definition.model,
    sessionModelId: sessionConfig.modelId,
  });
  if (!savedModelId) {
    const serialized = await serializePromptLlmInput(layout, ctx);
    const count = countFallbackTokens(runtime, serialized);
    return {
      label: formatChatTokenLabel(
        {tokenCount: count, estimated: true, counterKind: 'heuristic', source: 'local'},
        undefined,
      ),
      upgradeWorthy: false,
    };
  }
  const tokenizerOverride = await resolveTokenCounterModeForModel(
    runtime.providerModels,
    savedModelId,
  );
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
    {
      sessionKkv: runtime.sessionKkv,
      ...(preferEstimate ? {preferEstimate: true} : {}),
    },
  );
  const contextWindow = await runtime.providerModels.getContextWindow(savedModelId);
  return {
    label: formatChatTokenLabel(result, contextWindow ?? undefined),
    upgradeWorthy: result.source === 'local' && result.estimated,
  };
}

/** 后台精确升级在途标记（按 sessionId）：避免事件风暴下堆叠重复整串计数。 */
const preciseUpgradeInflight = new Set<string>();

/**
 * 两阶段标签（统计优先口径的 UI 面，2026-09-29 切模型慢复验定稿）：
 * 首帧 `preferEstimate` 即回（api 命中=精确；miss=CJK 感知廉价估算，`gpt ≈`）；
 * 首帧是估算档时后台跑一次完整 resolve（家族真分词器 + L1 整串缓存暖机），
 * 完成后经 `onPreciseUpgrade` 回调升级标签（`glm =` 等）。之后 api 真值到达
 * （下一次请求）自然接管。
 */
export async function loadChatPromptTokenLabelResilient(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
  onPreciseUpgrade?: (label: string) => void,
): Promise<string> {
  let first: {label: string; upgradeWorthy: boolean};
  try {
    first = await loadChatTokenLabelWithFlag(runtime, scope, true);
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[chat] prompt token count failed, using message fallback',
        error,
      );
    }
    return loadChatPromptTokenLabelFallback(runtime, scope);
  }
  if (first.upgradeWorthy && onPreciseUpgrade != null) {
    const sessionId = scope.sessionId;
    if (!preciseUpgradeInflight.has(sessionId)) {
      preciseUpgradeInflight.add(sessionId);
      void (async () => {
        try {
          const precise = await loadChatTokenLabelWithFlag(runtime, scope, false);
          if (precise.label !== first.label) {
            onPreciseUpgrade(precise.label);
          }
        } catch {
          // 升级失败保持首帧估算标签；下次刷新/api 真值自愈。
        } finally {
          preciseUpgradeInflight.delete(sessionId);
        }
      })();
    }
  }
  return first.label;
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
