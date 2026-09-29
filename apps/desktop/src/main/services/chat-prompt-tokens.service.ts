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
  formatContextUsageLabel,
  formatTokenSourceBadge,
  resolvePromptTokensWithBackfill,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
  type TokenCounter,
  type TokenCounterRegistry,
} from "@novel-master/core/provider";
import { countTextWithDefaultEncoding } from "@novel-master/tokenizer-driver-node";
import type { PromptChatTokenStatsResponse } from "../../../shared/ipc-types.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
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
 * 历史上的 `model:` / `enc:` 双命名空间已随 registry 收敛废除
 * （fallback-caliber-align A 线）——`getNodeEncodingForModel` 现在把模型名解析
 * 成编码名后进 registry 的 `enc:cl100k_base` 单键空间，所以**精确档（gpt-4 等
 * cl100k 家族）、兜底档与启动预热共享同一张表**。`runtime/create-desktop-runtime.ts`
 * 已在**启动路径跑完之后用 `setTimeout` 空闲预热**过一次（`try/catch` 静默、不阻塞启动），
 * 这覆盖了大部分场景；但**首次兜底若抢在预热之前发生，仍会有一次约 250ms 的主进程同步
 * 建表**（实测 185~248ms，期间事件循环阻塞、IPC 排队）——只是这笔开销从此被精确档
 * 一并复用，不再是双命名空间时代的「各建各的」。
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

/**
 * 统计响应装配：main 在产出时把完整 label 拼好（core 的
 * {@link formatTokenSourceBadge} + {@link formatContextUsageLabel} 单源），
 * renderer 纯渲染 `stats.label`，不再本地拼装（X1：renderer 不能 import core）。
 */
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
  const badge = formatTokenSourceBadge(source, counterKind, estimated);
  const label = formatContextUsageLabel(tokenCount, contextWindow, badge);
  return {
    tokenCount,
    contextWindow,
    pct,
    estimated,
    counterKind,
    source,
    label,
  };
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

/**
 * 后台精确计数暖机在途标记（按 sessionId）：首帧估算档后安排一次完整
 * resolve（家族真分词器 + L1 整串缓存写入），结果丢弃、只为暖缓存——
 * renderer 下一次触发（消息/step 事件）即命中 L1 拿到精确标签。
 */
const preciseWarmInflight = new Set<string>();

/**
 * 真正执行底层计算的一跳（原 `loadChatPromptTokenStats` 函数体）。
 *
 * 对外入口 {@link loadChatPromptTokenStats} 已套防抖；本函数只被防抖执行链
 * 调用，同一 sessionId 串行、绝不并发重入。
 *
 * 两阶段（统计优先口径，2026-09-29）：首帧 `preferEstimate`——api 命中仍
 * 精确返回；miss 时廉价估算即回（不调真分词器，切模型/回滚后的首帧不干等
 * 家族计数），估算档则后台暖一次精确 L1。
 */
async function loadChatPromptTokenStatsNow(
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
      { sessionKkv: runtime.sessionKkv, preferEstimate: true },
    );
    if (
      result.source === "local" &&
      result.estimated &&
      !preciseWarmInflight.has(scope.sessionId)
    ) {
      preciseWarmInflight.add(scope.sessionId);
      void resolvePromptTokensWithBackfill(
        scope.sessionId,
        rawMessages,
        params,
        { sessionKkv: runtime.sessionKkv },
      )
        .catch(() => undefined)
        .finally(() => preciseWarmInflight.delete(scope.sessionId));
    }
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
 * token 读口防抖窗口（message-token-cache Step 4 / T-TC6）：300ms trailing。
 *
 * renderer 侧 SessionDetailDrawer 有 5 个触发源（会话切换、消息收尾、编辑、
 * 置位/压缩等）会在短时间内连发 IPC；本层在 service 侧把它们合并成一次底层
 * 计算，renderer 零改动。窗口内的新触发会重置计时（最后一次触发后 300ms 才
 * 执行——trailing 语义，保证最终一致性：最后一次触发必产生一次计算，绝不吞）。
 */
const CHAT_PROMPT_TOKEN_DEBOUNCE_MS = 300;

/**
 * 每个 sessionId 一个防抖槽：
 * - `deferred`：trailing 计时挂起中，窗口内所有 caller 共享「这一次执行」；
 * - `running`：正在执行的底层计算链（同 key 串行——到期执行若遇上一轮仍在
 *   途，先挂到上一轮之后，绝不并发重入）；
 * - `scope`：记录最后一次触发的 scope，trailing 到期按最新触发执行。
 */
type ChatPromptTokenDebounceSlot = {
  timer: ReturnType<typeof setTimeout> | null;
  deferred: {
    promise: Promise<PromptChatTokenStatsResponse>;
    resolve: (value: Promise<PromptChatTokenStatsResponse>) => void;
  } | null;
  running: Promise<PromptChatTokenStatsResponse> | null;
  scope: SessionPromptScope;
};

const chatPromptTokenDebounceSlots = new Map<
  string,
  ChatPromptTokenDebounceSlot
>();

/** 测试观测：每 sessionId 的底层计算执行次数（T-TC6 断言「合并为 N 次」的口径）。 */
const chatPromptTokenDebounceExecCounts = new Map<string, number>();

function scheduleChatPromptTokenTrailing(
  runtime: DesktopNovelMasterRuntime,
  key: string,
  slot: ChatPromptTokenDebounceSlot,
): void {
  if (slot.timer != null) {
    clearTimeout(slot.timer);
  }
  slot.timer = setTimeout(() => {
    slot.timer = null;
    // 计时到期：取走窗口内 caller 共享的 deferred（可能为 null——那是「在途
    // 期间新触发」安排的追赶轮，无等待者也要执行，新数据才算到位）。
    const deferred = slot.deferred;
    slot.deferred = null;
    const previousRun = slot.running;
    const run = (
      previousRun ? previousRun.catch(() => undefined) : Promise.resolve()
    ).then(() => {
      chatPromptTokenDebounceExecCounts.set(
        key,
        (chatPromptTokenDebounceExecCounts.get(key) ?? 0) + 1,
      );
      return loadChatPromptTokenStatsNow(runtime, slot.scope);
    });
    slot.running = run;
    const settle = () => {
      if (slot.running === run) {
        slot.running = null;
      }
    };
    run.then(settle, settle);
    // 兜底 handler：无 caller 的追赶轮 rejection 不会变 unhandled；有 caller
    // 时多挂一个 handler 不影响失败向 caller 的原样传播（resilient 接住走 fallback）。
    run.catch(() => undefined);
    if (deferred != null) {
      // caller 的 promise 直接接到本轮执行上（resolve 扁平化；失败原样传播，
      // 由 resilient 包装接住走 fallback）。
      deferred.resolve(run);
    }
  }, CHAT_PROMPT_TOKEN_DEBOUNCE_MS);
}

/**
 * token 统计读口（IPC 并发语义保持）：按 sessionId 做 300ms trailing
 * debounce + 同参在途 Promise 合并。
 *
 * - 窗口内（计时挂起中）重复触发：重置计时，所有 caller 共享同一次底层计算；
 * - 底层计算在途时新触发：复用在途 Promise 返回，并安排 300ms 后的追赶轮
 *   （在途落地后串行执行），新触发的数据变化最终必被计算；
 * - 不同 sessionId 互不干扰（Map 按 key 隔离）。
 */
export function loadChatPromptTokenStats(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse> {
  const key = scope.sessionId;
  let slot = chatPromptTokenDebounceSlots.get(key);
  if (slot == null) {
    slot = { timer: null, deferred: null, running: null, scope };
    chatPromptTokenDebounceSlots.set(key, slot);
  }
  slot.scope = scope;
  if (slot.running != null) {
    // 在途复用：并发请求直接挂正在跑的这一轮；追赶轮保证新触发最终被计算。
    scheduleChatPromptTokenTrailing(runtime, key, slot);
    return slot.running;
  }
  if (slot.deferred == null) {
    let resolve!: (value: Promise<PromptChatTokenStatsResponse>) => void;
    const promise = new Promise<PromptChatTokenStatsResponse>((res) => {
      resolve = res;
    });
    slot.deferred = { promise, resolve };
  }
  scheduleChatPromptTokenTrailing(runtime, key, slot);
  return slot.deferred.promise;
}

/** 测试钩子：清空防抖槽与执行计数（用例间隔离，防跨用例串扰）。 */
export function resetChatPromptTokenDebounceForTests(): void {
  for (const slot of chatPromptTokenDebounceSlots.values()) {
    if (slot.timer != null) {
      clearTimeout(slot.timer);
    }
  }
  chatPromptTokenDebounceSlots.clear();
  chatPromptTokenDebounceExecCounts.clear();
}

/** 测试钩子：读取某 sessionId 的底层计算执行次数。 */
export function chatPromptTokenDebounceExecCountForTests(
  sessionId: string,
): number {
  return chatPromptTokenDebounceExecCounts.get(sessionId) ?? 0;
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

// 此前的 deprecated 链（loadChatPromptTokenLabelResilient + formatChatTokenStatsLabel）
// 已随 token-source-label 收敛删除：label 现由 buildTokenStats 产出并随 stats 下发
// （PromptChatTokenStatsResponse.label），零生产消费方，无需迁移。
