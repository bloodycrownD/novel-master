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
  type CountPromptLlmInputParams,
} from "./count-prompt-llm-input.js";
import { estimateTokensCjkAware } from "./estimate-tokens-cjk-aware.js";
import { promptWholeCache } from "./prompt-whole-cache.js";
import { readSessionApiPromptTokenEntry } from "./session-api-prompt-token-store.js";
import { tokenChunkCache } from "./token-chunk-cache.js";
import { serializePromptLlmInput } from "./serialize-prompt-input.js";
import { serializeToolsForTokenCount } from "./serialize-tools-for-token-count.js";

/** 占用结果来源。 */
export type PromptTokenSource = "api" | "local";

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
   * 估算优先（2026-09-29 切模型慢复验加）：本地分支不做真分词器计数，直接
   * heuristic 折算（`counterKind:"heuristic"`、`estimated:true`，不进任何
   * 缓存）。api 命中分支不受影响（仍精确）。
   *
   * 消费方：压缩评估（无统计时估算+0.85 保守系数，**绝不**为阈值判定阻塞
   * run——glm 原生整串大上下文单次 ~5.8s）；UI 标签的首帧（后台再跑精确
   * 全量计数升级显示并暖 L1）。缺省 false = 完整口径（家族计数器 + 缓存）。
   */
  readonly preferEstimate?: boolean;
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

  // 估算优先：无统计可用时不做真分词器计数——序列化 + 廉价估算即回（不进
  // L1/L2、不推代际、不落 KKV：瞬态估读没有缓存价值）。取
  // `max(registry heuristic, CJK 感知保守下限)`：heuristic 的 /3.35 是英文
  // 口径、中文低估八成，CJK 下限把偏差压回有界（消费方语义见
  // ResolveCurrentPromptTokensOptions.preferEstimate）。
  if (options?.preferEstimate === true) {
    const serialized =
      (await serializePromptLlmInput(params.layout, params.ctx)) +
      serializeToolsForTokenCount(params.tools);
    const tokenCount = Math.max(
      params.registry.heuristic.countText(serialized),
      estimateTokensCjkAware(serialized)
    );
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

  // 本地分支回落模型自身家族的计数器（fa 路由语义；强制 cl100k 估算档曾于
  // 2026-09-29 试行、真机复验后撤回——见模块头「统计优先」说明）。估读的
  // estimated / counterKind 透传驱动结果（fallback 档如实报 heuristic）。
  const local = await countPromptLlmInput(params);
  tokenChunkCache.advanceGeneration(sessionId, {
    persist: { sessionKkv },
    realRefresh: true,
  });
  promptWholeCache.persistPendingWrites(sessionKkv, sessionId);
  return {
    tokenCount: local.tokenCount,
    source: "local",
    estimated: local.estimated,
    counterKind: local.counterKind,
  };
}
