/**
 * Chat meta bar token labels (aligns with CLI `prompt render --tokens`).
 *
 * stream-metrics-native ④：本文件两条「拿不到模型 / 主路径抛异常」的早退路径原本
 * 走 `registry.heuristic.countText`（`ceil(字符数 / 3.35)`）。该折算是**英文**口径，
 * 对中文正文系统性低估 82%~84%，而这两处恰恰是最需要保守估计的场景，故已改走
 * Node 驱动的 cl100k 真分词器（`counterKind` 仍是 `heuristic`、`estimated: true`
 * ——**近似**这件事不变、UI 文案不变，变的是读数本身）。
 *
 * @module services/chat-prompt-tokens
 */
import { resolveSavedModelId } from "@novel-master/core/agent";
import type { ChatMessage } from "@novel-master/core/chat";
import { messageBodyText } from "@novel-master/core/prompt";

import {
  countPromptLlmInputHeuristicOnly,
  formatTokenSourceLabel,
  resolvePromptTokensWithBackfill,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
  type TokenCounter,
  type TokenCounterRegistry,
} from "@novel-master/core/provider";
import { countTextWithDefaultEncoding } from "@novel-master/tokenizer-driver-node";
import type { PromptChatTokenStatsResponse } from "../../../shared/ipc-types.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { formatTokenCount } from "@novel-master/core/common";
import {
  buildSessionPromptInput,
  type SessionPromptScope,
} from "./session-prompt-input.service.js";

/**
 * 兜底口径的 token 数：真 cl100k 计数优先，编码表建不起来才退回字符折算。
 *
 * 为什么不直接用 `runtime.tokenCounters.heuristic.countText`：那个 port 的实现就是
 * `ceil(chars / 3.35)`，在中文下低估八成。桌面端主进程本来就在加载 Node 驱动
 * （`runtime/connection.ts` 会 `registerTokenizerNodeDriver`），**复用驱动里那张
 * 进程级单例编码表本身不产生额外建表成本**。
 *
 * ⚠️ 但「复用单例」**不等于「第一次也是免费的」**（stream-metrics-native `agile-3`）：
 * `getNodeEncodingForModel` 的缓存键是 `model:<tiktokenModel>`、兜底档
 * `getNodeEncodingByName` 的键是 `enc:cl100k_base`——**两个命名空间互不命中**，所以
 * 兜底档**第一次**被走到时仍要现建一整张 cl100k WASM 表。`runtime/create-desktop-runtime.ts`
 * 已在**启动路径跑完之后用 `setTimeout` 空闲预热**过一次（`try/catch` 静默、不阻塞启动），
 * 这覆盖了大部分场景；但**首次兜底若抢在预热之前发生，仍会有一次约 250ms 的主进程同步
 * 建表**（实测 185~248ms，期间事件循环阻塞、IPC 排队）。
 */
function countFallbackTokens(
  runtime: DesktopNovelMasterRuntime,
  serialized: string,
): number {
  const real = countTextWithDefaultEncoding(serialized);
  if (real != null) {
    return real;
  }
  return runtime.tokenCounters.heuristic.countText(serialized);
}

/**
 * 把 {@link countFallbackTokens} 包成一个 `TokenCounter` 适配器。
 *
 * 用途：core 的 `countPromptLlmInputHeuristicOnly`（异常兜底路径）只认
 * `registry.heuristic` 这个**同步 port**，而 core 本身不该依赖任何分词器实现。
 * 与其在这里重写一遍 core 的序列化 + 家族解析，不如把「registry 里的 heuristic
 * 计数器」换成一个真分词器实现的适配器——读数口径变真，其余行为（counterKind
 * 仍为 `heuristic`、`estimated: true`）完全不变。
 */
function realFallbackTokenCounter(
  runtime: DesktopNovelMasterRuntime,
): TokenCounter {
  return {
    // 仍然自称 heuristic：这层跑的 cl100k 对当前模型**未必**是其家族 tokenizer，
    // 上游据此继续按「估算」处理（压缩阈值会乘 0.85 安全系数）。
    kind: "heuristic",
    countText: (text: string) => countFallbackTokens(runtime, text),
    countMessages: (messages: readonly ChatMessage[]) =>
      // 拼成一整串再计数：按消息逐条计数会丢掉相邻消息之间的合并，拼接口径与
      // 序列化提示词时「合成一串再数」一致。
      countFallbackTokens(
        runtime,
        messages.map((m) => messageBodyText(m)).join("\n\n"),
      ),
  };
}

/**
 * 注入真分词器版 heuristic 计数器的 registry 视图（不改动 runtime 上的原对象）。
 *
 * ⚠️ **禁令：不得用对象展开（浅拷贝 `{ ...base }` 那种写法）去复制
 * `DefaultTokenCounterRegistry` 实例**——它的 `forSavedModel` / `forVendorModel` 是
 * **原型方法**，不是自有可枚举属性，**对象展开后运行期直接消失**；而 TypeScript 会
 * 因为 spread 的类型取自接口 `TokenCounterRegistry`（结构类型在类型层面看得到全部方法）
 * 而**编译期零告警**。所以这里必须**逐个显式转发**。
 *
 * ⚠️ **别把这层当过度防御删掉**：今天没炸，只因 core 的
 * `countPromptLlmInputHeuristicOnly` 恰好**只读 `registry.heuristic`**、没碰另外两个方法；
 * 一旦 core 那条兜底开始调 `forVendorModel(...)`，这里就会抛
 * `forVendorModel is not a function`——而这是 desktop 的**最后一道兜底**，抛错就没有下一层了。
 */
export function withRealFallbackCounter(
  runtime: DesktopNovelMasterRuntime,
): TokenCounterRegistry {
  const base = runtime.tokenCounters;
  return {
    // `getTokenizerOverride` 虽是自有属性（构造函数里赋值），但它是**外部函数值**：
    // 搬成新对象的自有属性后 `this` 会指向新对象而不是原实例，所以必须 `.bind(base)`。
    getTokenizerOverride: base.getTokenizerOverride?.bind(base),
    forSavedModel: (id, o) => base.forSavedModel(id, o),
    forVendorModel: (id, o) => base.forVendorModel(id, o),
    heuristic: realFallbackTokenCounter(runtime),
  };
}

/** 统计响应装配：`source` 原样带出，标签由 {@link formatChatTokenStatsLabel} 拼。 */
function buildTokenStats(
  tokenCount: number,
  estimated: boolean,
  counterKind: string,
  contextWindow: number | undefined,
  source: 'api' | 'local',
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
    source,
  };
}

/**
 * 组装 meta bar 的 token 标签。占用来源后缀由 core 的
 * {@link formatTokenSourceLabel} 统一给出（`api` → 「上次请求」，其余 → 「预估」），
 * 本文件不再自备一份映射。
 */
export function formatChatTokenStatsLabel(
  stats: PromptChatTokenStatsResponse,
): string {
  const prefix = stats.estimated ? "~" : "";
  const current = formatTokenCount(stats.tokenCount);
  const suffix = formatTokenSourceLabel(stats.source);
  if (stats.contextWindow == null || stats.contextWindow <= 0) {
    return stats.estimated
      ? `${prefix}${current} tokens (est.) · ${suffix}`
      : `${current} tokens · ${suffix}`;
  }
  const pct = stats.pct ?? 0;
  return `${prefix}${pct}% • ${current}/${formatTokenCount(stats.contextWindow)} · ${suffix}`;
}

// 共用的会话输入快照：避免主路径和 fallback 各自重复读取 sessionConfig。
type SessionPromptInput = Awaited<ReturnType<typeof buildSessionPromptInput>>;
// 传给计数分叉的参数：计数必需的三项 + rawMessages（cache miss 时回填用）。
type CountArgs = Pick<SessionPromptInput, "layout" | "ctx" | "rawMessages"> & {
  savedModelId: string;
};
type CountResult = {
  tokenCount: number;
  estimated: boolean;
  counterKind: string;
  contextWindow: number | undefined;
  source: 'api' | 'local';
};

// 主路径与 fallback 的公共骨架：负责构造输入、读取 sessionConfig、解析 savedModelId，
// 以及 savedModelId 缺失时的 heuristic 早退。只有真正调用 token counter 的部分通过 countFn 分叉。
async function computeChatPromptTokenStats(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
  countFn: (args: CountArgs) => Promise<CountResult>,
): Promise<PromptChatTokenStatsResponse> {
  const { definition, layout, ctx, rawMessages } = await buildSessionPromptInput(
    runtime,
    scope,
  );

  // workspace 层已移除：模型解析链为 agent pin → session.modelId。
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(
    scope.sessionId,
  );
  const savedModelId = resolveSavedModelId({
    agentModelId: definition.model,
    sessionModelId: sessionConfig.modelId,
  });

  if (!savedModelId) {
    // 此处恒不拼 tools（UI 读口拿不到定义，`session-prompt-input` 不产 tools）：
    // 口径差是已登记收窄（见 ③ spec `:46`），不要以为拼了就是全量。
    // 压缩评估路径由 agent-runner 传 tools，那是真口径（取舍说明见
    // `serializeToolsForTokenCount` 头注释）。
    const serialized = await serializePromptLlmInput(layout, ctx);
    // 无模型可用 → 只能按默认编码估算。仍然走真分词器（cl100k）而不是字符折算：
    // 「预估」标签与 counterKind 语义不变，变的是读数——折算对中文低估八成，而这
    // 正是最需要保守估计的一条路径。
    const count = countFallbackTokens(runtime, serialized);
    return buildTokenStats(count, true, "heuristic", undefined, "local");
  }

  const { tokenCount, estimated, counterKind, contextWindow, source } =
    await countFn({ layout, ctx, savedModelId, rawMessages });
  return buildTokenStats(
    tokenCount,
    estimated,
    counterKind,
    contextWindow,
    source,
  );
}

export async function loadChatPromptTokenStats(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse> {
  return computeChatPromptTokenStats(runtime, scope, async (args) => {
    const { layout, ctx, savedModelId, rawMessages } = args;
    const tokenizerOverride = await resolveTokenCounterModeForModel(
      runtime.providerModels,
      savedModelId,
    );
    const params = {
      layout,
      ctx,
      savedModelId,
      registry: runtime.tokenCounters,
      tokenizerOverride,
      savedModels: runtime.savedModelRepo,
    };
    // 直接 resolve（历史上的 cache miss 回填步骤已废弃：置位/压缩后旧值不准，
    // 统一走本地 tokenizer 重算）。compaction trigger 不走这里，行为不变。
    // 传 sessionKkv：命中上次 completed run 落库的 API 占用（含跨重启），
    // 与压缩评估同一读口、同一口径。
    const result = await resolvePromptTokensWithBackfill(
      scope.sessionId,
      rawMessages,
      params,
      { sessionKkv: runtime.sessionKkv },
    );
    const contextWindow =
      await runtime.providerModels.getContextWindow(savedModelId);
    return {
      tokenCount: result.tokenCount,
      estimated: result.estimated,
      counterKind: result.counterKind,
      contextWindow: contextWindow ?? undefined,
      source: result.source,
    };
  });
}

/**
 * 异常兜底：主路径（真 tokenizer / API 占用）抛异常时的降级读数。
 *
 * 仍然用 core 的 `countPromptLlmInputHeuristicOnly`（序列化 + 家族解析口径不重复
 * 造轮子），但传入的 registry 里的 `heuristic` 计数器已换成**真 cl100k 适配器**，
 * 所以这条路径的读数也不再是字符折算。
 */
async function loadChatPromptTokenStatsFallback(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse> {
  return computeChatPromptTokenStats(runtime, scope, async (args) => {
    const { layout, ctx, savedModelId } = args;
    const result = await countPromptLlmInputHeuristicOnly({
      layout,
      ctx,
      savedModelId,
      registry: withRealFallbackCounter(runtime),
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

    return {
      tokenCount: result.tokenCount,
      estimated: result.estimated,
      counterKind: result.counterKind,
      contextWindow,
      source: "local",
    };
  });
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
