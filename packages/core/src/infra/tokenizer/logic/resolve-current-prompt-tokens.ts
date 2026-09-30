/**
 * 当前 prompt 占用统一读口：有会话 API 占用（进程内热层或 session KKV）则
 * 用（基线 + 采样后追加消息的增量估算），否则本地 count。
 *
 * 口径一致性（治本点）：API 值落 session KKV 后，重启也读得到同一份
 * `promptTokens`——不再出现「重启前报 API、重启后跌本地估算」的跳变。
 * KKV 命中时仍返回 `source:"api"`，并附 `atMs`（「上次请求」标签与时效
 * 判定用）。
 *
 * **统计优先（2026-09-29，用户拍板「像 metric 一样有哪个用哪个」；当晚
 * 真机复验二次修正）**：
 * - API 命中分支：`读值 = 基线 + 增量估算`（与实时速率条同款语义，RULE
 *   「实时 token 指标语义」条）。基线是上次请求的精确 `promptTokens`，
 *   增量是采样锚点（`anchorSeq`）之后追加的消息折算——不为「刷新一下读数」
 *   付费计数。消息**追加不再失效**该值（增量可覆盖）；删除/隐藏/改写类
 *   路径仍失效。
 * - 本地分支：回落**模型自身家族**的计数器（glm→原生 DJL、gpt→tiktoken
 *   分块），与 fa 的路由语义一致——曾试过对 WEB/SP 家族强制 cl100k 估算
 *   （首次估算计数 + 块表 KKV 读写链在真机上引入新卡顿，且 glm 档消失），
 *   真机复验后撤回：run 内评估与刷新靠每 step usage 回锚走 api 档零计数，
 *   本地计数只剩「无统计可用」的低频场景（首开/回滚/置位后），L1 整串
 *   缓存挡重复。
 *
 * @module infra/tokenizer/logic/resolve-current-prompt-tokens
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { formatChatMessageForCliPreview } from "@/domain/chat/content/message-body-text.js";
import {
  countPromptLlmInput,
  resolveVendorModelIdFromSaved,
  type CountPromptLlmInputParams,
} from "./count-prompt-llm-input.js";
import { estimateTokensCjkAware } from "./estimate-tokens-cjk-aware.js";
import { promptWholeCache } from "./prompt-whole-cache.js";
import type { PromptWholeCacheEntry } from "./prompt-whole-cache.js";
import {
  buildChatTokenEstimateMemoKey,
  lookupChatTokenEstimateMemo,
  lookupWorkplaceEstimateByFingerprint,
  rememberChatTokenEstimateMemo,
  rememberWorkplaceEstimateByFingerprint,
} from "./chat-token-estimate-memo.js";
import { resolveTokenizerDriver } from "../../nmtp/logic/registry.js";
import { resolveTokenizerFamily } from "./resolve-tokenizer-family.js";
import { readSessionApiPromptTokenEntry } from "./session-api-prompt-token-store.js";
import {
  buildCounterScope,
  chunkHash16,
  tokenChunkCache,
} from "./token-chunk-cache.js";
import { serializePromptLlmInput } from "./serialize-prompt-input.js";
import { serializeToolsForTokenCount } from "./serialize-tools-for-token-count.js";
import { layoutHasWorkplace } from "@/domain/prompt/model/agent-prompt-layout.js";

/** 占用结果来源。 */
export type PromptTokenSource = "api" | "local";

/**
 * resolve 段中途弃权（cr-fix-spec-r3 r3-chip-1，2026-09-30 治本点）。
 *
 * 背景：chip 读口的 build 段已有分段 bail（app 层的
 * `ChatPromptBuildBailedError`），但**进得去停不下**——resolve 链整段无观察
 * 点，其中 glm 原生整串计数单次 ~5.8s，与发送链共享 JS 线程与单 SQLite 连接。
 * 读口在 run 起步后无从兑现弃权。
 *
 * 为什么定义在 core 而不是让读口自己判：读口（mobile/desktop 的
 * chat-prompt-tokens service）在 `@novel-master/core` 之上，core 引不到 app 层的
 * 错误类；反向则让「弃权」这件事在内部分支里散成 return/null 两种形态，后者
 * 要放宽 `ResolvedPromptTokens` 返回类型并给 `token-ratio.trigger.ts` 单独加
 * 分支，改动面更大更脏。
 */
export class PromptTokenResolveBailedError extends Error {
  constructor() {
    super("prompt token resolve bailed (run in flight)");
    this.name = "PromptTokenResolveBailedError";
  }
}

/** {@link resolveCurrentPromptTokens} 返回值。 */
export interface ResolvedPromptTokens {
  readonly tokenCount: number;
  readonly source: PromptTokenSource;
  /**
   * `source==="api"` → 必须 `estimated:false`、`counterKind:"api"`。
   * `source==="local"` → 透传本地 count 的 estimated / counterKind。
   */
  readonly estimated: boolean;
  readonly counterKind: string;
  /**
   * `source==="api"` 时的采样时刻（epoch 毫秒；旧格式值无该字段时为 0）。
   * `source==="local"` 时省略。
   */
  readonly atMs?: number;
}

/** {@link resolveCurrentPromptTokens} 的可选依赖。 */
export interface ResolveCurrentPromptTokensOptions {
  /**
   * 会话 KKV：读口用它做跨重启的 API 值恢复。缺省时退化为纯进程内读
   * （与落库前行为一致，旧调用方无需改动）。
   */
  readonly sessionKkv?: SessionKkvService | null;
  /**
   * 估算优先（2026-09-29 切模型慢复验加）：本地分支不做真分词器计数——
   * **先查 L1 整串缓存**（命中零成本直读现成读数，含跨重启种子；cr-fix-spec
   * r2 s2/G-1），miss 才序列化 + heuristic/CJK 折算（`counterKind:"heuristic"`、
   * `estimated:true`，不进任何缓存）。api 命中分支不受影响（仍精确）。
   *
   * 消费方：压缩评估（无统计时估算+0.85 保守系数，**绝不**为阈值判定阻塞
   * run——glm 原生整串大上下文单次 ~5.8s）；UI 标签的首帧（后台再跑精确
   * 全量计数升级显示并暖 L1，L1 暖后首帧即精确、无降级闪烁）。缺省
   * false = 完整口径（家族计数器 + 缓存）。
   */
  readonly preferEstimate?: boolean;
  /**
   * 中途弃权判定（r3-chip-1）：真值即抛 {@link PromptTokenResolveBailedError}。
   *
   * 缺省 `undefined` = 永不弃权，对既有调用方（含唯一不透传的
   * `token-ratio.trigger.ts`）零影响。读口（mobile/desktop chat-prompt-tokens
   * service）把「run 在途」判据透传进来后，resolve 链的每处整串级重活之前
   * 都有观察点，不再出现「进得去停不下」。
   *
   * 检查点两处（均为「重活之前」而非「重活之后」）：
   * 1. preferEstimate 早退段**序列化之前**——序列化 + `lookupWholeCacheEntry`
   *    内的二次序列化都是整串级的；
   * 2. L1/L2 seed 之后、`countPromptLlmInput` 之前——原生家族计数器整串计数
   *    （glm ~5.8s）之前。
   *
   * api 命中分支不设检查点：它只做一次 KKV 读 + 小增量估算，无整串级重活。
   */
  readonly shouldBail?: () => boolean;
}

/**
 * 弃权检查点的执行器：未传 `shouldBail` 时是一个恒假的空判定（调用点写
 * `bail()` 即可，缺省路径零分支成本可言）。
 */
function makeBailCheck(
  shouldBail: (() => boolean) | undefined
): () => void {
  return () => {
    if (shouldBail?.() === true) {
      throw new PromptTokenResolveBailedError();
    }
  };
}

/**
 * API 命中时的增量估算：锚点之后追加的可见消息折算 token。
 *
 * 口径说明：
 * - 序列化用 `formatChatMessageForCliPreview`（`role: body` 段、`\n\n` 连接），
 *   与驱动整串序列化的消息段同构——增量本来就是估算，不追求逐 token 对齐。
 *   传入的 ctx.messages 是 prepare 之后的消息（附件已 wrap 进文本块），
 *   大附件的正文天然计入增量。
 * - heuristic 是 `ceil(字符/3.35)` 的英文口径、对中文低估八成，取
 *   `max(heuristic, CJK 感知保守下限)`——中文增量不被低估过半（阈值方向
 *   安全）、英文小幅高估无害；增量本体小（run 内一步的 assistant +
 *   tool_results，或一条新 user 消息），下一次请求的 usage 到达即被真值
 *   覆盖（agent-runner 每 step 回锚）。
 * - 回滚把尾部物理删除后 seq 复用，锚点可能短暂指向「已不存在的高 seq」→
 *   过滤结果为空、delta=0，基线原样使用，下一次 usage 自愈（回滚路径本身
 *   会失效该条目，此为双保险）。
 */
function estimateAnchoredDelta(
  anchorSeq: number | undefined,
  params: CountPromptLlmInputParams
): number {
  if (anchorSeq == null) {
    return 0;
  }
  const messages: readonly ChatMessage[] | undefined = params.ctx?.messages;
  if (messages == null || messages.length === 0) {
    return 0;
  }
  const tail = messages.filter((m) => m.seq > anchorSeq && !m.hidden);
  if (tail.length === 0) {
    return 0;
  }
  const text = tail
    .map((m) =>
      formatChatMessageForCliPreview(m)
        .map((segment) => `${segment.role}: ${segment.body}`)
        .join("\n\n")
    )
    .join("\n\n");
  if (text.length === 0) {
    return 0;
  }
  return Math.max(
    params.registry.heuristic.countText(text),
    estimateTokensCjkAware(text)
  );
}

/**
 * preferEstimate 分支的 L1 整串缓存预查：键构造与驱动层完全同款
 * （scope = vendorModelId/override/family/driverName；指纹 = 整串+tools 串
 * 前 16 hex），命中即可零成本返回现成读数。进程内 miss 且带 session KKV
 * 时先种再查一次（跨重启续命——后台暖机/上一轮精确计数落过盘）；种子
 * 失败/无行由 seedFromKkv 自身静默，这里按 miss 走估算。
 *
 * 驱动未注册（触发器测试等无驱动场景）返回 null——没有 L1 可查，也不该
 * 在估算档里抛错。
 */
async function lookupWholeCacheEntry(
  sessionId: string,
  params: CountPromptLlmInputParams,
  serialized: string,
  sessionKkv: SessionKkvService | null
): Promise<PromptWholeCacheEntry | null> {
  // 预查是纯优化：任何一步失败（驱动解析异常 / registry 抛错 / KKV 种子
  // 失败）都静默按 miss 走估算——估算路径是首帧与压缩评估的关键路径，
  // 不能被 L1 预查带崩。
  try {
    let driverName: string;
    try {
      driverName = resolveTokenizerDriver().name;
    } catch {
      return null;
    }
    const override =
      params.tokenizerOverride ??
      (await params.registry.getTokenizerOverride?.()) ??
      "auto";
    const vendorModelId = await resolveVendorModelIdFromSaved(
      params.savedModelId,
      params.savedModels
    );
    const family = resolveTokenizerFamily(vendorModelId, override);
    const scope = buildCounterScope({
      vendorModelId,
      tokenizerOverride: override,
      tokenizerFamily: family,
      driverName,
    });
    const contentHash = chunkHash16(serialized);
    const hit = promptWholeCache.lookup("", scope, contentHash);
    if (hit != null) {
      return hit;
    }
    if (sessionKkv != null) {
      await promptWholeCache.seedFromKkv(sessionKkv, sessionId);
      return promptWholeCache.lookup("", scope, contentHash) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 展示与压缩共用的唯一读口。签名必带 `sessionId`。
 *
 * 命中判定：热层（进程内 Map）→ session KKV。两条路径上若值的
 * `savedModelId` 指纹与本次请求的 `params.savedModelId` 不符，一律当 miss
 * （换模型后旧口径的占用不再适用，且避免把上一个模型的精确值喂给新模型的
 * 阈值判定）；无指纹（旧格式值）按兼容处理照常采用。
 */
export async function resolveCurrentPromptTokens(
  sessionId: string,
  params: CountPromptLlmInputParams,
  options?: ResolveCurrentPromptTokensOptions
): Promise<ResolvedPromptTokens> {
  // r3-chip-1 弃权检查点执行器（api 命中分支不用：只一次 KKV 读 + 小增量
  // 估算，无整串级重活，不值得为它加判据）。
  const bail = makeBailCheck(options?.shouldBail);
  const entry = await readSessionApiPromptTokenEntry(
    options?.sessionKkv,
    sessionId
  );
  if (
    entry != null &&
    (entry.savedModelId == null || entry.savedModelId === params.savedModelId)
  ) {
    return {
      tokenCount: entry.promptTokens + estimateAnchoredDelta(entry.anchorSeq, params),
      source: "api",
      estimated: false,
      counterKind: "api",
      atMs: entry.atMs,
    };
  }

  // message-token-cache 分层挂接（主代理定稿）：驱动层只做内存层（L1 整串
  // 查/写 + L2 块查/写），**代际推进与 KKV 持久化挂本读口的本地计数分支**——
  // 驱动签名零改动，CLI / 测试直接调驱动时不推代、不落盘，行为与无缓存前
  // 的计数路径一致。
  //
  // - 调驱动前：有 session KKV 时先 `seedFromKkv`（进程重启后把上次落盘的
  //   块表载入为最旧可用代种子，跨重启续命 L2 命中）；
  // - 驱动返回后：`advanceGeneration` 收尾这一轮「本地计数周期」——代际轮换
  //   无条件执行（无 sessionKkv 的 CLI / 测试场景只推内存代、不 persist），
  //   KKV 落盘仅在 sessionKkv 装配且本轮为真实刷新时发生（realRefresh 恒
  //   true：读口的本地分支本身就是用户可见的真实刷新，不存在预热路径）。
  const sessionKkv = options?.sessionKkv ?? null;

  // 估算优先：无统计可用时不做真分词器计数——但**先查 L1 整串缓存**
  // （cr-fix-spec-r2 s2/G-1，2026-09-29）：L1 命中是零成本现成精确值，
  // 拒读它会让「后台暖机写的 L1 永远没人消费」、chip 在 api miss 期间锁死
  // 估算档（mobile 同病为「精确→估算→升级」降级闪烁）——与统计优先
  // 「有哪个用哪个」口径相悖。键构造与驱动层完全同款（scope = 模型/
  // override/家族/驱动名，指纹 = 整串+tools 串前 16 hex）；驱动未注册时
  // （触发器测试场景）跳过预查，直接估算。
  // miss 时序列化 + 廉价估算即回（不进 L1/L2、不推代际、不落 KKV：瞬态
  // 估读没有缓存价值）。取 `max(registry heuristic, CJK 感知保守下限)`：
  // heuristic 的 /3.35 是英文口径、中文低估八成，CJK 下限把偏差压回有界
  // （消费方语义见 ResolveCurrentPromptTokensOptions.preferEstimate）。
  if (options?.preferEstimate === true) {
    // 弃权检查点①：必须在**序列化之前**。下方 serializePromptLlmInput 与
    // lookupWholeCacheEntry 内部的 chunkHash16 各自把整串过一遍（真机上大
    // 会话就是秒级），检查点放在序列化之后等于「观察点在重活后面」。
    bail();
    // 估算读数记忆（2026-09-30 切会话重算治本）：同「workplace 指纹 + 消息
    // 尾戳 + tools + 模型」⇒ 序列化产物必然同值，serialize/hash/count 三趟
    // 整串线性扫（真机 ~2s）全免。条目也可能来自精确分支的回写（升级语义：
    // 命中即精确档，与下方 L1 预查同精神，不给「锁死估算档」留口）。
    const memoKey = buildChatTokenEstimateMemoKey({
      savedModelId: params.savedModelId,
      workplaceFingerprint: params.ctx?.workplaceFingerprint,
      messages: params.ctx?.messages,
      tools: params.tools,
    });
    if (memoKey != null) {
      const memoHit = lookupChatTokenEstimateMemo(sessionId, memoKey);
      if (memoHit != null) {
        return {
          tokenCount: memoHit.tokenCount,
          source: "local",
          estimated: memoHit.estimated,
          counterKind: memoHit.counterKind,
        };
      }
    }
    // 增量分解估算（2026-09-30「增量优化哪去了」的落地）：CJK 估算是逐字符
    // 计数、完全可加——workplace 段的估读按指纹缓存（同前缀跨刷新/跨会话零
    // 成本），只对消息/system/tools 段现算。内容变更后的估算从 O(整串三趟)
    // 降到 O(消息段)。
    //
    // 分解口径（哨兵替换法）：render-prompt 把 display **原样**嵌进 workplace
    // 合成消息（appendWorkplacePair*：`body = ctx.workplaceDisplay`，无转义），
    // 故用单字符哨兵替换 display 再序列化——成对合成消息（user 正文 +
    // assistant done 应答）与全部包装结构都留在「哨兵版」串里，估读
    // = cjk(哨兵串) − cjk(哨兵) + 指纹缓存值，与整串口径的差异只剩各段
    // ceil 的 ±1。门控对齐 render 侧：layout 无 workplace 块时 display 根本
    // 不进序列化产物（appendWorkplacePairIfPresent 早退），不分解。
    // 有指纹时也跳过下方 L1 预查——它要 serialize+hash 整串（真机 ~1.3s），
    // 恰是要消灭的成本；「同内容已有精确读数」由上方记忆精确条目覆盖。
    const fingerprint = params.ctx?.workplaceFingerprint;
    if (
      fingerprint != null &&
      params.ctx != null &&
      layoutHasWorkplace(params.layout) &&
      params.ctx.workplaceDisplay.length > 0
    ) {
      let wpEstimate = lookupWorkplaceEstimateByFingerprint(fingerprint);
      if (wpEstimate == null) {
        wpEstimate = estimateTokensCjkAware(params.ctx.workplaceDisplay);
        rememberWorkplaceEstimateByFingerprint(fingerprint, wpEstimate);
      }
      const WP_SENTINEL = "W";
      const sentinelSerialized =
        (await serializePromptLlmInput(params.layout, {
          ...params.ctx,
          workplaceDisplay: WP_SENTINEL,
        })) + serializeToolsForTokenCount(params.tools);
      const tokenCount =
        wpEstimate +
        estimateTokensCjkAware(sentinelSerialized) -
        estimateTokensCjkAware(WP_SENTINEL);
      rememberChatTokenEstimateMemo(sessionId, memoKey!, {
        tokenCount,
        estimated: true,
        counterKind: "heuristic",
      });
      return {
        tokenCount,
        source: "local",
        estimated: true,
        counterKind: "heuristic",
      };
    }
    const serialized =
      (await serializePromptLlmInput(params.layout, params.ctx)) +
      serializeToolsForTokenCount(params.tools);
    const cached = await lookupWholeCacheEntry(sessionId, params, serialized, sessionKkv);
    if (cached != null) {
      // 命中即原样返回（与驱动层 L1 命中同语义；条目可能是精确档或
      // heuristic 档——后者与下方估算等价，返回谁都不是降级）。
      return {
        tokenCount: cached.tokenCount,
        source: "local",
        estimated: cached.estimated,
        counterKind: cached.counterKind,
      };
    }
    // 单趟计数（2026-09-30）：原 `max(heuristic, CJK 感知)` 是两趟整串扫，
    // 数学上 CJK 感知恒 ≥ heuristic（CJK 部分 1.64 > 1/3.35，非 CJK 部分
    // 同为 /3.35，仅在纯非 CJK 文本上差一个 ceil 取整）——大串上第二趟纯
    // 浪费，直接用 CJK 感知单趟。
    const tokenCount = estimateTokensCjkAware(serialized);
    if (memoKey != null) {
      rememberChatTokenEstimateMemo(sessionId, memoKey, {
        tokenCount,
        estimated: true,
        counterKind: "heuristic",
      });
    }
    return {
      tokenCount,
      source: "local",
      estimated: true,
      counterKind: "heuristic",
    };
  }

  if (sessionKkv != null) {
    await tokenChunkCache.seedFromKkv(sessionKkv, sessionId);
    // L1 整串条目同样跨重启续命：native 档（WEB/SP 过桥）只有 L1 可挡
    // 「重进会话重复原生整串计数」，重启后靠这份种子直接命中。
    await promptWholeCache.seedFromKkv(sessionKkv, sessionId);
  }

  // 弃权检查点②：L1/L2 seed 之后、countPromptLlmInput 之前。家族原生计数器
  // 整串计数（glm ~5.8s）是 resolve 链最重的一步，必须让它成为「起跑前先看
  // 一眼」的形态——落在它之后就等于没有弃权点。
  bail();
  // 精确档记忆预查（2026-09-30 真机实锤补）：后台精确升级**每次进会话都会
  // 跑**，即便 L1 已有整串条目也要付 serialize+hash（真机 ~1.3s）。同键记忆
  // 里已有精确读数（上一轮升级/完整口径回写）时直接复用，重复进入的成本归
  // 零。命中但只有估读时照旧走真计数——升级本来就是来补精确值的。
  const preciseMemoKey = buildChatTokenEstimateMemoKey({
    savedModelId: params.savedModelId,
    workplaceFingerprint: params.ctx?.workplaceFingerprint,
    messages: params.ctx?.messages,
    tools: params.tools,
  });
  if (preciseMemoKey != null) {
    const preciseMemoHit = lookupChatTokenEstimateMemo(sessionId, preciseMemoKey);
    if (preciseMemoHit != null && preciseMemoHit.estimated === false) {
      return {
        tokenCount: preciseMemoHit.tokenCount,
        source: "local",
        estimated: false,
        counterKind: preciseMemoHit.counterKind,
      };
    }
  }
  // 本地分支回落模型自身家族的计数器（fa 路由语义；强制 cl100k 估算档曾于
  // 2026-09-29 试行、真机复验后撤回——见模块头「统计优先」说明）。估读的
  // estimated / counterKind 透传驱动结果（fallback 档如实报 heuristic）。
  const local = await countPromptLlmInput(params);
  tokenChunkCache.advanceGeneration(sessionId, {
    persist: { sessionKkv },
    realRefresh: true,
  });
  promptWholeCache.persistPendingWrites(sessionKkv, sessionId);
  // 精确读数回写记忆（升级语义，见 chat-token-estimate-memo 模块头）：后台
  // 精确升级完成后，下一次估算帧在同一内容键上直接命中精确档——不需要 L1
  // 预查兜底也不存在「锁死估算档」的回归口。失败/降级读数（heuristic 档）
  // 同样如实入册：同键复用与当场重算同值，不是缓存污染。
  if (preciseMemoKey != null) {
    rememberChatTokenEstimateMemo(sessionId, preciseMemoKey, {
      tokenCount: local.tokenCount,
      estimated: local.estimated,
      counterKind: local.counterKind,
    });
  }
  return {
    tokenCount: local.tokenCount,
    source: "local",
    estimated: local.estimated,
    counterKind: local.counterKind,
  };
}
