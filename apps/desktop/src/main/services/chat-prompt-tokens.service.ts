/**
 * Chat meta bar token labels (aligns with CLI `prompt render --tokens`).
 *
 * stream-metrics-native ④：本文件两条「拿不到模型 / 主路径抛异常」的早退路径原本
 * 走 `registry.heuristic.countText`（`ceil(字符数 / 3.35)`）。该折算是**英文**口径，
 * 对中文正文系统性低估 82%~84%，而这两处恰恰是最需要保守估计的场景，故已改走
 * Node 驱动的 cl100k 真分词器（`counterKind` 仍是 `heuristic`、`estimated: true`
 * ——**近似**这件事不变、UI 文案不变，变的是读数本身）。
 *
 * r3-dt-align（对齐 mobile 四层防护）：本文件的整串级重活（build 装配、resolve
 * 计数）与发送链共享 main 进程的单事件循环与单 SQLite 连接，mobile 真机实锤过
 * 它把 POST 派发从 +1.2s 拖到 +19.6s。desktop 侧四层落点：
 * ① 判活源 {@link isDesktopSessionRunInFlight}（core abortRegistry，单向 import）；
 * ② run 在途抑制（读口/后台暖机/压缩暖机三处入口）+ **null 哨兵**返回契约；
 * ③ build 分段弃权（{@link buildSessionPromptInput} 的 shouldBail）与 resolve 段
 *   弃权（core 抛 {@link PromptTokenResolveBailedError}）——两类都由
 *   {@link isChipBailError} 收口，**绝不进 fallback**；
 * ④ run 终态后补推一次读口（走防抖入口，与抽屉自发那次合并，见文件末尾注册处）。
 *
 * r3-cache-3：第二相投递改为「直接推暖机手里已有的精确档」，不再「补读一次现值」
 * ——补读走的是完整链，等于把 {@link buildSessionPromptInput} 整个重跑一遍，正是
 * 本文件要消灭的重活。仅「暖机期间模型已变」才补读（见
 * {@link pushPreciseStatsIfReady}）。
 *
 * @module services/chat-prompt-tokens
 */
import { app } from "electron";
import { resolveSavedModelId } from "@novel-master/core/agent";
import type { ChatMessage } from "@novel-master/core/chat";
import { messageBodyText } from "@novel-master/core/prompt";

import {
  countPromptLlmInputHeuristicOnly,
  formatContextUsageLabel,
  formatTokenSourceBadge,
  PromptTokenResolveBailedError,
  resolvePromptTokensWithBackfill,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
  type CountPromptLlmInputParams,
  type TokenCounter,
  type TokenCounterRegistry,
} from "@novel-master/core/provider";
import { countTextWithDefaultEncoding } from "@novel-master/tokenizer-driver-node";
import type { PromptChatTokenStatsResponse } from "../../../shared/ipc-types.js";
import { notifyPromptChatTokenUpdatedToRenderer } from "../ipc/forward-prompt-chat-token-updated.js";
import {
  isDesktopSessionRunInFlight,
  setRunFinishedTokenStatsRefresh,
} from "../ipc/handlers/agent.js";
import { getDesktopRuntimeOrThrow } from "../runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import {
  buildSessionPromptInput,
  ChatPromptBuildBailedError,
  type SessionPromptScope,
} from "./session-prompt-input.service.js";

/**
 * chip 读口中途弃权的两类哨兵错误统一判定：build 段（ChatPromptBuildBailedError，
 * desktop 侧本地抛）与 resolve 段（PromptTokenResolveBailedError，core 在整串级
 * 重活之前抛）。两处调用点（build / resolve）都必须用本判定收成 **null 哨兵**——
 * 漏任何一处，弃权错误都会逃逸进 {@link loadChatPromptTokenStatsResilient} 的
 * 兜底分支，而兜底是「完整 build + 启发式计数」的重活，正是要消灭的那一趟。
 * 与 mobile 的 isChipBailError 同款口径。
 */
function isChipBailError(error: unknown): boolean {
  return (
    error instanceof ChatPromptBuildBailedError ||
    error instanceof PromptTokenResolveBailedError
  );
}

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
//
// `shouldBail`（r3-dt-align 第 2/3 层）：读口两条路径（首帧、后台暖机）传「run 在途」
// 判据进来，让 build 的分段检查点与 resolve 的整串级检查点都有观察点；fallback 与
// 压缩暖机不传（前者只在真异常后跑、后者入口已查判活，见各自注释）。
async function computeChatPromptTokenStats(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
  countFn: (args: CountArgs) => Promise<CountResult>,
  shouldBail?: () => boolean,
): Promise<PromptChatTokenStatsResponse> {
  const { definition, layout, ctx, rawMessages } = await buildSessionPromptInput(
    runtime,
    scope,
    undefined,
    shouldBail != null ? { shouldBail } : undefined,
  );

  // 弃权检查点（build/resolve 关键边界，r3-dt-align 第 2 层）：build 的分段 bail 只
  // 管得到 build 段内部，最后一段 bail 到 resolve 派发之间还夹着
  // getSessionAgentConfig、resolveSavedModelId、resolveTokenCounterModeForModel 三次
  // IO——run 起步的窗口正落在这里。命中即由上层 catch 收成 null 哨兵（保留旧标签），
  // 绝不放行到 resolve。
  if (shouldBail?.() === true) {
    throw new ChatPromptBuildBailedError();
  }

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
 * **读口**后台精确计数暖机在途标记（按 sessionId）：首帧估算档后安排一次完整
 * resolve（家族真分词器 + L1 整串缓存写入）。
 *
 * 暖机不再只是「暖缓存等 renderer 下次来问」——跑完即经
 * {@link pushPreciseStatsIfReady} 把精确读数**推**给 renderer。原因：手动
 * 压缩/置位/回滚这类一次性动作之后没有「下一次触发」，只暖 L1 的话 chip
 * 就停在估算档 `gpt ≈`（用户实报「手动压缩后分词器变成 gpt 兜底」）。
 *
 * ⚠️ 这里只管**读口**自己排的那一轮（{@link loadChatPromptTokenStatsNow}），
 * **与压缩暖机 {@link compactionWarmInflight} 是两个独立 Set**——见
 * {@link compactionWarmInflight} 头注释里「为什么不能共用」。
 */
const readWarmInflight = new Set<string>();

/**
 * **压缩暖机**在途标记（按 sessionId）：由
 * {@link warmChatPromptTokenStatsAfterCompaction} 一条路径独占 add/finally delete。
 *
 * ⚠️ **必须与 {@link readWarmInflight} 分开，不能共用一个 Set**（cr-fix-spec-r3
 * r3-cache-1）：两者各自的**时序承诺**根本不同。
 *
 * - 读口暖机是 void 出去的（`loadChatPromptTokenStatsNow` 里 fire-and-forget），
 *   在途只意味着「别重复排一轮，白烧一次分词」——所以同 Set 去重完全安全。
 * - 压缩暖机由 IPC `await`，去重挡下就等于**直接放弃预热**：压缩 IPC 立刻返回，
 *   而 L1 还没写热，renderer 压缩完成后的首帧照样落到 `gpt ≈`——正是
 *   r3-cache-1 要消灭的那个「IPC 返回前已暖好」不变式的破坏。
 *
 * 两者还天然会同时在途（读口防抖 300ms trailing 常与用户点压缩重叠）。共用一个
 * Set 时，压缩暖机会被读口那一轮无声挡下，压缩路径**没有任何可 await 的句柄**去
 * 「等读口在途轮落定」（读口是 void 的），于是不变式随机破。拆开之后压缩路径
 * 自己完整跑一轮并 await，**该不变式恒成立**——代价只是多烧一次分词。
 */
const compactionWarmInflight = new Set<string>();

/**
 * 一次「完整口径」resolve 所需的 params 组装（tokenizerOverride / registry /
 * savedModels 三件套）。
 *
 * 抽成单点是因为**两条暖机路径必须同款**：读口首帧后的后台暖机
 * （{@link loadChatPromptTokenStatsNow} 内）与压缩后的显式暖机
 * （{@link warmChatPromptTokenStatsAfterCompaction}）一旦口径漂移（比如一份
 * 漏传 `tokenizerOverride`），L1 写入的 scope 键就对不上，暖过的缓存没人命中，
 * 跳变会「偶发复现」——这类 bug 极难从现象反推。宁可多一个函数也不复制参数。
 */
async function buildResolveParams(
  runtime: DesktopNovelMasterRuntime,
  args: CountArgs,
): Promise<CountPromptLlmInputParams> {
  const { layout, ctx, savedModelId } = args;
  const tokenizerOverride = await resolveTokenCounterModeForModel(
    runtime.providerModels,
    savedModelId,
  );
  return {
    layout,
    ctx,
    savedModelId,
    registry: runtime.tokenCounters,
    tokenizerOverride,
    savedModels: runtime.savedModelRepo,
  };
}

/**
 * 一次暖机跑完后、手里那份精确读数的**投递材料**（r3-cache-3）。
 *
 * 为什么单独定型：第二相投递改为「直接推暖机手里已有的结果」（不再补读），
 * 于是投递函数必须由调用方把结果**递进来**；而 `savedModelId` 是「暖机期间
 * 模型是否已变」的唯一比对基准，也得一并带过来。
 */
type PrecisePushMaterial = {
  /** 暖机当时 resolve 用的 savedModelId（= 当轮 `params.savedModelId`）。 */
  readonly savedModelId: string;
  readonly tokenCount: number;
  readonly estimated: boolean;
  readonly counterKind: string;
  readonly source: 'api' | 'local';
};

/**
 * 判断「暖机算完之后，会话模型还是不是暖机时那一个」。
 *
 * 判据（cr-fix-spec-r3 r3-cache-3）：比对暖机用的 savedModelId 与**当下**解析
 * 出来的 savedModelId（解析链与 {@link computeChatPromptTokenStats} 同款：agent
 * pin → session.modelId）。取值只读两处——会话 agent 配置行 + registry 里的
 * 那一条 agent 定义，**不碰 build**（build 才是「秒级重活」本身：拉全部可见
 * 消息、assemble workplace、hydrate skill 全文、渲染整串提示词）。
 *
 * 比对不上（读失败、agent 不存在、无可用模型）一律返回 false：宁可信「变了」
 * 去补读一次，也不让旧模型的精确标签闪进 UI。
 */
async function isPreciseWarmStillCurrent(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
  warmSavedModelId: string,
): Promise<boolean> {
  try {
    const sessionConfig = await runtime.sessions.getSessionAgentConfig(
      scope.sessionId,
    );
    const definition = await runtime.agentRegistry.get(sessionConfig.agentId);
    return (
      resolveSavedModelId({
        agentModelId: definition.model,
        sessionModelId: sessionConfig.modelId,
      }) === warmSavedModelId
    );
  } catch {
    return false;
  }
}

/**
 * 两阶段第二相的投递：把暖机**手里已有的**精确档直接推给 renderer
 * （cr-fix-spec-r3 r3-cache-3）。
 *
 * 此前这里是「再补读一次现值」——而补读走的是 {@link loadChatPromptTokenStatsNow}
 * 那条完整链，等于把 build（拉全部可见消息 + assemble workplace + hydrate skill
 * 全文 + 渲染整串提示词）**整个重跑一遍**，正是这条链路要消灭的重活：暖机刚
 * 花钱数出来的精确读数，转头又被一次同输入的 build 抵消掉。
 *
 * 现在：
 * 1. **直接推** warm 手里那份结果（`buildSessionPromptInput` 调用 0 次）；
 * 2. 仅当「warm 期间模型已变」（{@link isPreciseWarmStillCurrent}）才补读一次
 *    现值——补读固定 `armPreciseWarm:false`（**绝不再排一轮暖机**，否则
 *    「每次读内容都在变」的会话会让推送与补读互相喂养、后台无休止计数）；
 * 3. **直接推的结果也过 `estimated === false` 闸**：warm 手里那份按构造就是精确
 *    档，但闸不能省——将来若有人把估算档也递进来，少了这道闸就会用
 *    `gpt ≈` 盖掉 chip 上已有的 `gpt =`。
 */
async function pushPreciseStatsIfReady(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
  warm: PrecisePushMaterial,
): Promise<void> {
  if (warm.estimated) {
    return;
  }
  if (!(await isPreciseWarmStillCurrent(runtime, scope, warm.savedModelId))) {
    // 暖机期间切了模型：手里的精确读数属于旧模型，直接推会让旧标签闪进 UI。
    // 按当下模型补读一次；拿到 null（run 在途被抑制/中途弃权）就如实不推。
    const stats = await loadChatPromptTokenStatsNow(runtime, scope, {
      armPreciseWarm: false,
    });
    if (stats == null || stats.estimated) {
      return;
    }
    notifyPromptChatTokenUpdatedToRenderer({
      sessionId: scope.sessionId,
      stats,
    });
    return;
  }
  // 模型没变 ⇒ 手里这份就是当下的精确读数，直接装配推送。
  // contextWindow 是轻查询（模型元信息一行），与主路径里那次同款。
  const contextWindow =
    await runtime.providerModels.getContextWindow(warm.savedModelId);
  notifyPromptChatTokenUpdatedToRenderer({
    sessionId: scope.sessionId,
    stats: buildTokenStats(
      warm.tokenCount,
      warm.estimated,
      warm.counterKind,
      contextWindow ?? undefined,
      warm.source,
    ),
  });
}

/**
 * 真正执行底层计算的一跳（原 `loadChatPromptTokenStats` 函数体）。
 *
 * 对外入口 {@link loadChatPromptTokenStats} 已套防抖；本函数只被防抖执行链
 * 与第二相投递（{@link pushPreciseStatsIfReady}）调用。
 *
 * 两阶段（统计优先口径，2026-09-29）：首帧 `preferEstimate`——api 命中仍
 * 精确返回；miss 时廉价估算即回（不调真分词器，切模型/回滚后的首帧不干等
 * 家族计数），估算档则后台暖一次精确 L1 并在完成后推送（见上）。
 *
 * `options.armPreciseWarm=false`：只读现值、不排暖机（r3-cache-3 之后，这只出现在
 * 「暖机期间模型已变」的补读分支上——正常情况下第二相直接推暖机手里那份结果，
 * 根本不会再走本函数）。
 *
 * **run 在途抑制（r3-dt-align 第 2 层，返回 null）**：判活点在**这里**而不是
 * 公开入口 `loadChatPromptTokenStats`，是刻意的——`onCoreRunFinished` 里那次
 * 「结束后补推」是在 core 的终态事件回调中**同步**发起的，那一刻 core 的
 * `abortRegistry` 还没反注册（finally 在 runner.run 返回之后才跑），若把判活
 * 放在公开入口，补推会把自己判成在途、当场掐掉，chip 就永远停在旧读数。
 * 防抖的 300ms trailing 天然跨过这个窗口：判活执行时 run 早已收尾。
 */
async function loadChatPromptTokenStatsNow(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
  options?: { readonly armPreciseWarm?: boolean },
): Promise<PromptChatTokenStatsResponse | null> {
  const armPreciseWarm = options?.armPreciseWarm ?? true;
  // 一次成型、整条链共用：build 分段检查点、build/resolve 边界、resolve 内部
  // 整串级检查点、后台暖机的排程判断，全看这一条判据（与 mobile 同款口径）。
  const shouldBail = (): boolean =>
    isDesktopSessionRunInFlight(runtime, scope.sessionId);
  if (shouldBail()) {
    // 在途即跳过本轮：进得去也停不下才是真问题（mobile 实锤过 build 把
    // POST 派发从 +1.2s 拖到 +19.6s），所以这里连输入装配都不起步。
    return null;
  }
  return computeChatPromptTokenStats(
    runtime,
    scope,
    async (args) => {
      const { savedModelId } = args;
      const params = await buildResolveParams(runtime, args);
      // 直接 resolve（历史上的 cache miss 回填步骤已废弃：置位/压缩后旧值不准，
      // 统一走本地 tokenizer 重算）。compaction trigger 不走这里，行为不变。
      // 传 sessionKkv：命中上次 completed run 落库的 API 占用（含跨重启），
      // 与压缩评估同一读口、同一口径。
      const result = await resolvePromptTokensWithBackfill(
        scope.sessionId,
        args.rawMessages,
        params,
        { sessionKkv: runtime.sessionKkv, preferEstimate: true, shouldBail },
      );
      if (
        armPreciseWarm &&
        result.source === "local" &&
        result.estimated &&
        !readWarmInflight.has(scope.sessionId) &&
        // run 在途不排暖机：后台暖机是整串级重活（家族真分词器 + L1 写入），
        // 与发送链抢同一条 SQLite 连接。run 结束后那次补推（agent.ts 终态钩子）
        // 会把这一轮补上，彼时无竞争。
        !shouldBail()
      ) {
        readWarmInflight.add(scope.sessionId);
        void resolvePromptTokensWithBackfill(
          scope.sessionId,
          args.rawMessages,
          params,
          { sessionKkv: runtime.sessionKkv, shouldBail },
        )
          .then(async (precise) => {
            // 暖机没拿到比估算更好的档（该家族只有近似档 / 编码表建不起来）
            // → 没有更准的读数可推，chip 停在 `gpt ≈` 才是如实。
            if (precise.estimated) {
              return;
            }
            // r3-cache-3：直接推这份精确档（不补读、不重跑 build）；
            // 只有「暖机期间模型已变」才在 push 内部补读一次。
            await pushPreciseStatsIfReady(runtime, scope, {
              savedModelId,
              tokenCount: precise.tokenCount,
              estimated: precise.estimated,
              counterKind: precise.counterKind,
              source: precise.source,
            });
          })
          .catch((error: unknown) => {
            if (isChipBailError(error)) {
              // 中途弃权（run 起步）：静默收场，不留失败痕迹。
              return;
            }
            // 暖机/推送失败只丢「这次升级」，不影响正确性；但完全静默会让
            // chip 永停估算档且无从排查（cr-fix-spec-r2 full/I-1）——开发期
            // 留痕与首帧失败同款。
            if (!app.isPackaged) {
              console.warn("[chat] prompt token precise warm-up failed", error);
            }
          })
          .finally(() => readWarmInflight.delete(scope.sessionId));
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
    },
    shouldBail,
  );
}

/**
 * 手动压缩成功后的**显式精确暖机**：在压缩 IPC 返回之前把 L1 整串缓存跑热。
 *
 * 为什么要专门走这一趟（desktop 结构与 mobile 不同，mobile 是「冻结 + 预热 +
 * 暖后补刷」，这里一次预热就够）：手动压缩会作废 API 基线，renderer 压缩完成
 * 后立刻触发的刷新首帧必然是 `preferEstimate` 档——而压缩后内容指纹全变，L1
 * 必然 miss，于是首帧落到廉价估算 `gpt ≈`，再由读口自己的后台暖机在 ~1~2s 后
 * 推精确档覆盖。用户实报的就是这个跳变（`glm =` → `gpt ≈` → `glm =`）。
 *
 * 关键在**时序**：这里由 IPC 侧 `await`，所以等压缩 IPC 返回时 L1 已经写好，
 * renderer 那次刷新的首帧经 core 读口的 L1 预查直接命中精确档，跳变整段消失。
 * 若改成 fire-and-forget，首帧与后台暖机仍是竞态，跳变照旧。
 *
 * 语义约束：
 * - 与 {@link loadChatPromptTokenStatsNow} 的后台暖机**分属两个 inflight Set**
 *   （{@link compactionWarmInflight} / {@link readWarmInflight}，cr-fix-spec-r3
 *   r3-cache-1）：本路径**只查自己的 {@link compactionWarmInflight}**，不查读口
 *   在途。读口暖机是 void 出去的、没有可 await 的句柄，若与它共用去重，读口
 *   在途时本函数会直接 `return` → 预热根本没跑 → 压缩 IPC 立刻返回而 L1 仍冷
 *   → renderer 首帧照样回落 `gpt ≈`。「IPC 返回前已暖好」这条不变式就此随机破。
 *   去重只保留**同路径同 key**的去重（连点两次压缩时省一次分词）。
 * - 只在拿到**非估算**结果时才 {@link pushPreciseStatsIfReady}（且推的是这一轮
 *   手里那份，不重跑 build，r3-cache-3）；否则如实停在估算档（没有更准的读数
 *   可给）。
 * - 永不 reject：暖机失败只丢这次升级，压缩结果照常返回（调用方在 IPC 里
 *   `await` 它，必须不会把压缩的成功态变成失败态）。
 * - **run 在途即跳过本轮**（r3-dt-align 第 2 层，判活源与读口同款）：本路径是
 *   完整口径 resolve（整串级重活），与发送链抢同一条 SQLite 连接。手动压缩 IPC
 *   自 2026-10-05 起有 run 在途门禁（handlers/compaction.ts 拦截返回
 *   AGENT_RUN_IN_FLIGHT，压缩本体不会执行）；本防御保留用于门禁的注册时序残窗与
 *   未来新增的直连调用方（run 在途时只是「升级变慢」，不破「IPC 返回前已暖好」
 *   的不变式——压缩本身已完成，chip 晚一拍到精确档而已）。
 *   与 mobile 一致：这里只查判活，不把 shouldBail 透传进 resolve（压缩的语义
 *   就是「一定要暖」，中途半途而废反而不如不暖）。
 */
export async function warmChatPromptTokenStatsAfterCompaction(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<void> {
  // 同路径同 key 的去重先判（连点两次压缩时省一次分词），再判 run 在途。
  // 顺序有讲究：已经在途时本函数无论如何都不跑，判活就是多余的一次 runtime
  // 触碰——而「重复调用一次 runtime 都不碰」正是 T-CW2 钉的形态。
  if (compactionWarmInflight.has(scope.sessionId)) {
    return;
  }
  if (isDesktopSessionRunInFlight(runtime, scope.sessionId)) {
    return;
  }
  compactionWarmInflight.add(scope.sessionId);
  try {
    // 完整口径（**不带** `preferEstimate`）：家族真分词器计数 + L1 整串写入，
    // 这正是要让首帧能命中的那份数据。
    //
    // r3-cache-3：顺手把这一轮的精确结果与 savedModelId 留下来，投递时直接推
    // （不重跑 build）；只有「暖机期间模型已变」才在 push 内部补读一次。
    //
    // ⚠️ 用**盒子对象**而不是裸 `let`：赋值发生在 countFn 闭包里，TS 的控制流
    // 分析看不见跨闭包的赋值，裸 `let` 在 await 之后会被窄化成初始值 `null`，
    // 判空走完之后 `preciseMaterial` 变成 `never`（`.estimated` 直接报
    // TS2339）。盒子对象的属性读取不受这条窄化影响。
    const preciseBox: { material: PrecisePushMaterial | null } = {
      material: null,
    };
    await computeChatPromptTokenStats(runtime, scope, async (args) => {
      const savedModelId = args.savedModelId;
      const params = await buildResolveParams(runtime, args);
      const precise = await resolvePromptTokensWithBackfill(
        scope.sessionId,
        args.rawMessages,
        params,
        { sessionKkv: runtime.sessionKkv },
      );
      preciseBox.material = {
        savedModelId,
        tokenCount: precise.tokenCount,
        estimated: precise.estimated,
        counterKind: precise.counterKind,
        source: precise.source,
      };
      const contextWindow =
        await runtime.providerModels.getContextWindow(savedModelId);
      return {
        tokenCount: precise.tokenCount,
        estimated: precise.estimated,
        counterKind: precise.counterKind,
        contextWindow: contextWindow ?? undefined,
        source: precise.source,
      };
    });
    const preciseMaterial = preciseBox.material;
    if (preciseMaterial == null || preciseMaterial.estimated) {
      return;
    }
    await pushPreciseStatsIfReady(runtime, scope, preciseMaterial);
  } catch (error) {
    // 失败静默：压缩已经成功了，暖机只是「让首帧不跳」的锦上添花。
    // 但开发期留痕——完全静默会让「压缩后仍是估算档」无从排查。
    if (!app.isPackaged) {
      console.warn("[chat] prompt token compaction warm failed", error);
    }
  } finally {
    compactionWarmInflight.delete(scope.sessionId);
  }
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
    promise: Promise<PromptChatTokenStatsResponse | null>;
    resolve: (value: Promise<PromptChatTokenStatsResponse | null>) => void;
  } | null;
  running: Promise<PromptChatTokenStatsResponse | null> | null;
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
 *
 * 返回类型是 `PromptChatTokenStatsResponse | null`（r3-dt-align 第 2 层的返回
 * 契约）：**null = 本轮被抑制或中途弃权，caller 必须按「保留旧标签」收场**
 * （不清空、不显示占位），语义与 mobile 的空串哨兵一一对应。
 */
export function loadChatPromptTokenStats(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse | null> {
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
    let resolve!: (value: Promise<PromptChatTokenStatsResponse | null>) => void;
    const promise = new Promise<PromptChatTokenStatsResponse | null>((res) => {
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
 * 测试钩子：占住**读口**暖机在途标记（`readWarmInflight`），返回释放函数。
 *
 * 为什么需要它（cr-fix-spec-r3 r3-cache-1）：真实时序里「读口那一轮后台暖机
 * 还在途」是个**竞态窗口**——读口防抖 300ms trailing、暖机又是 void 出去的，
 * 窗口宽度不可控且极窄，靠自然撞出来的用例是概率性的、等于没有牙齿。
 * 而本条要钉的性质恰恰是「**读口在途时压缩暖机照样完整跑一轮**」，所以直接
 * 把该 Set 置位来构造前提。
 *
 * ⚠️ 钩子只动 `readWarmInflight`：**若有人把两个 Set 合并回一个**（即本条要
 * 消灭的写法），压缩暖机会被这个占位挡下而静默 return，用例立刻红。
 *
 * 用例必须 `finally` 释放：占位期间读口自己排的暖机也会被去重挡下，泄漏到
 * 其它用例会让它们的首帧永远停在估算档。
 */
export function holdReadWarmInflightForTests(sessionId: string): () => void {
  readWarmInflight.add(sessionId);
  return () => {
    readWarmInflight.delete(sessionId);
  };
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

/**
 * IPC 读口入口：主路径失败时的降级读数。
 *
 * **两类中途弃权错误（build 段 / resolve 段）绝不进本函数**（r3-dt-align 第 2
 * 层）：兜底是「完整 build + 启发式计数」，恰恰是 run 在途时最不该跑的那趟重活
 * ——弃权错误一旦漏到这里，不仅没省下任何算力，还白跑一次全量装配。所以先判哨兵
 * 错误直接回 null（保留旧标签），只有真异常才降级。与 mobile 侧同款防陷阱注释。
 */
export async function loadChatPromptTokenStatsResilient(
  runtime: DesktopNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<PromptChatTokenStatsResponse | null> {
  try {
    return await loadChatPromptTokenStats(runtime, scope);
  } catch (error) {
    if (isChipBailError(error)) {
      return null;
    }
    return loadChatPromptTokenStatsFallback(runtime, scope);
  }
}

/**
 * run 终态后的读口补跑（r3-dt-align 第 4 层，注册进 agent.ts 的终态钩子）。
 *
 * 走的是**防抖入口** `loadChatPromptTokenStats` 而不是
 * `warmChatPromptTokenStatsAfterCompaction`，两条理由：
 * ① 前者自带首帧估算 + 后台暖 + 精确档推送，语义就是「补跑一拍」；
 * ② 后者会占 `compactionWarmInflight`（r3-cache-1 刚拆出来的那个 Set），
 *    语义串味——那是「压缩后必须已暖好」的承诺，被 run 结束事件占用会让下一次
 *    手动压缩的预热被无声挡下。而防抖入口与 SessionDetailDrawer 在 FINISHED
 *    时自发的那次读口 IPC 共享同一防抖槽，会合并成一次底层计算。
 *
 * 失败只丢这一拍：绝不让 chip 补刷的异常变成终态事件的噪声（agent.ts 侧还有
 * 一层 try/catch 兜底）。
 */
setRunFinishedTokenStatsRefresh((payload) => {
  let pending: Promise<PromptChatTokenStatsResponse | null>;
  try {
    const runtime = getDesktopRuntimeOrThrow();
    pending = loadChatPromptTokenStats(runtime, {
      projectId: payload.projectId,
      sessionId: payload.sessionId,
    });
  } catch {
    // runtime 尚未 bootstrap（极早期窗口）时没有读口可补，如实跳过。
    return;
  }
  void pending.catch((error: unknown) => {
    if (isChipBailError(error)) {
      return;
    }
    if (!app.isPackaged) {
      console.warn("[chat] prompt token post-run refresh failed", error);
    }
  });
});

// 此前的 deprecated 链（loadChatPromptTokenLabelResilient + formatChatTokenStatsLabel）
// 已随 token-source-label 收敛删除：label 现由 buildTokenStats 产出并随 stats 下发
// （PromptChatTokenStatsResponse.label），零生产消费方，无需迁移。
