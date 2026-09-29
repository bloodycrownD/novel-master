/**
 * 当前 prompt 占用统一读口：有会话 API 占用（进程内热层或 session KKV）则
 * 用（基线 + 采样后追加消息的增量估算），否则本地 count。
 *
 * 口径一致性（治本点）：API 值落 session KKV 后，重启也读得到同一份
 * `promptTokens`——不再出现「重启前报 API、重启后跌本地估算」的跳变。
 * KKV 命中时仍返回 `source:"api"`，并附 `atMs`（「上次请求」标签与时效
 * 判定用）。
 *
 * **统计优先（2026-09-29，用户拍板「像 metric 一样有哪个用哪个」）**：
 * - API 命中分支：`读值 = 基线 + 增量估算`（与实时速率条同款语义，RULE
 *   「实时 token 指标语义」条）。基线是上次请求的精确 `promptTokens`，
 *   增量是采样锚点（`anchorSeq`）之后追加的消息按 heuristic 折算——不
 *   再为「刷新一下读数」付费计数。
 * - 本地分支：WEB/SP 家族（glm/qwen2/gemma/claude…）的真分词器计数在
 *   真机上是原生整串过桥（glm 大上下文单次 ~5.8s），自动读路径**绝不
 *   同步付费**——强制 `tokenizerOverride:"tiktoken"` 走 cl100k 分块估算
 *   （JS 侧、L1/L2 缓存照常生效），结果标 `estimated:true`（标签 `gpt ≈`
 *   档）。tiktoken 家族（gpt 系，JS 分块本就快）与 heuristic 档保持原样。
 *   家族真分词器的精确计数只留给 CLI 直调驱动的显式路径。
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
import { promptWholeCache } from "./prompt-whole-cache.js";
import { readSessionApiPromptTokenEntry } from "./session-api-prompt-token-store.js";
import { tokenChunkCache } from "./token-chunk-cache.js";
import { resolveTokenizerFamily } from "./resolve-tokenizer-family.js";

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
}

/**
 * API 命中时的增量估算：锚点之后追加的可见消息按 heuristic 折算 token。
 *
 * 口径说明：
 * - 序列化用 `formatChatMessageForCliPreview`（`role: body` 段、`\n\n` 连接），
 *   与驱动整串序列化的消息段同构——增量本来就是估算，不追求逐 token 对齐。
 * - heuristic 是 `ceil(字符/3.35)` 的英文口径、对中文低估八成，但增量本体
 *   小（run 内一步的 assistant + tool_results，或一条新 user 消息），绝对
 *   误差几百 token 量级、相对基线可忽略；下一次请求的 usage 到达即被真值
 *   覆盖（agent-runner 每 step 回锚）。
 * - 回滚把尾部物理删除后 seq 复用，锚点可能短暂指向「已不存在的高 seq」→
 *   过滤结果为空、delta=0，基线原样使用，下一次 usage 自愈。
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
  return params.registry.heuristic.countText(text);
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
  if (sessionKkv != null) {
    await tokenChunkCache.seedFromKkv(sessionKkv, sessionId);
    // L1 整串条目同样跨重启续命：native 档（WEB/SP 过桥）只有 L1 可挡
    // 「重进会话重复原生整串计数」，重启后靠这份种子直接命中。
    await promptWholeCache.seedFromKkv(sessionKkv, sessionId);
  }

  // 统计优先：WEB/SP 家族的本地真分词器计数是原生整串过桥（glm 大上下文
  // 单次 ~5.8s），自动读路径不付这个钱——强制 tiktoken 走 cl100k 分块估算。
  // 家族判定与驱动同源（vendorModelId → resolveTokenizerFamily，override
  // 语义一致）；tiktoken（JS 分块本就快、精确）与 heuristic（本就廉价）不强制。
  // 强制档的 L1/L2 键含 override 段，与原生档天然隔离、互不污染。
  const vendorModelId = await resolveVendorModelIdFromSaved(
    params.savedModelId,
    params.savedModels
  );
  const family = resolveTokenizerFamily(
    vendorModelId,
    params.tokenizerOverride ?? "auto"
  );
  const forceEstimate = family !== "tiktoken" && family !== "heuristic";
  const local = await countPromptLlmInput(
    forceEstimate ? { ...params, tokenizerOverride: "tiktoken" } : params
  );
  tokenChunkCache.advanceGeneration(sessionId, {
    persist: { sessionKkv },
    realRefresh: true,
  });
  promptWholeCache.persistPendingWrites(sessionKkv, sessionId);
  return {
    tokenCount: local.tokenCount,
    source: "local",
    // 强制估算档如实标 estimated（cl100k 对非 OpenAI 家族只是近似，标签落
    // `gpt ≈` 档、压缩阈值据此乘保守系数）；未强制时透传驱动结果。
    estimated: forceEstimate ? true : local.estimated,
    counterKind: local.counterKind,
  };
}
