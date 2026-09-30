/**
 * chip token 读数的进程内记忆（2026-09-30「切会话重算」治本点）。
 *
 * 背景：统计优先口径之后，mobile 的 chip 读数主要走「估算档」（api 锚失效的
 * 首帧）——估算分支的重活是 serialize + hash + count 对整份提示词（含
 * workplace 全文）的线性扫，真机实测 ~2s/次；而这条路径**一层缓存都没有**
 * （L1 只收精确档，估读「瞬态不缓存」的假设被切会话来回打脸：同会话第二次
 * 进入照样全价 2s）。持久化缓存（L1/L2/token_chunks）服务的是精确计数路径，
 * 手机上基本不走——这就是用户「持久化白做了」体感的真身。
 *
 * 记忆的键是**廉价内容指纹**：workplace 指纹（assemble 产出，path|status|mtime
 * join）+ 消息尾戳（数量/末 seq/blocks 折算长度和）+ tools 折算长度 + 模型 id。
 * 同键 ⇒ 序列化产物必然同值 ⇒ 读数直接复用，serialize/hash/count 三趟全免。
 *
 * 为什么条目**也存精确档结果**（不只估算）：估算首帧之后的后台精确升级
 * （preferEstimate=false 分支）完成时把精确读数写进同一键——下一次估算帧
 * 记忆命中直接拿到精确档，语义与「preferEstimate 先查 L1」一致（不给
 * 「锁死估算档」留回归口）。键带模型 id：精确读数按模型分档（家族词表不同），
 * 换模型即 miss；估算读数本身模型无关，但跟键走没有坏处（标签本就按模型展示）。
 *
 * 只进程内、不持久化：瞬态估读跨重启没有价值（重启后 api 锚/KKV 种子接管），
 * 也避免给 KKV 加一张会随内容漂移的表。每会话只留最新一条，内存有界。
 *
 * @module infra/tokenizer/logic/chat-token-estimate-memo
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";

/** 记忆条目：与 `ResolvedPromptTokens` 的 local 分支同构（source 恒 local）。 */
export interface ChatTokenEstimateMemoEntry {
  readonly tokenCount: number;
  readonly estimated: boolean;
  readonly counterKind: string;
}

/** 每会话一条（最新键覆盖旧键）：消息一变键就变，旧条目自然被挤掉。 */
const memo = new Map<string, {key: string; entry: ChatTokenEstimateMemoEntry}>();

/**
 * workplace 段估读按指纹的独立缓存（2026-09-30 增量分解）：同一份前缀正文
 * 的 CJK 估读只算一次，跨会话共享（键只有指纹，不含会话/模型——CJK 估读
 * 本就模型无关）。这是「内容变了也只算增量」的最后一层：消息追加后，
 * workplace 段零成本、只现算消息/system/tools 段。
 */
const workplaceEstimateByFp = new Map<string, number>();

/** 指纹估读命中；miss 返回 null（调用方现算并回填）。 */
export function lookupWorkplaceEstimateByFingerprint(
  fingerprint: string
): number | null {
  return workplaceEstimateByFp.get(fingerprint) ?? null;
}

/** 回填指纹估读（覆盖式）。容量上界：指纹随文件 mtime 演进，旧条目不再被
 * 查询——按 64 条 LRU 式截断（超限删最旧插入序），防长会话漂移累积。 */
export function rememberWorkplaceEstimateByFingerprint(
  fingerprint: string,
  estimate: number
): void {
  if (!workplaceEstimateByFp.has(fingerprint) && workplaceEstimateByFp.size >= 64) {
    const oldest = workplaceEstimateByFp.keys().next().value;
    if (oldest != null) {
      workplaceEstimateByFp.delete(oldest);
    }
  }
  workplaceEstimateByFp.set(fingerprint, estimate);
}

/** 命中条件 = 会话在册且键逐字符相同；否则 null（调用方按 miss 走全价路径）。 */
export function lookupChatTokenEstimateMemo(
  sessionId: string,
  key: string
): ChatTokenEstimateMemoEntry | null {
  const hit = memo.get(sessionId);
  if (hit != null && hit.key === key) {
    return hit.entry;
  }
  return null;
}

/** 覆盖式记忆（估算与精确两分支共用同一键空间，见模块头「也存精确档」）。 */
export function rememberChatTokenEstimateMemo(
  sessionId: string,
  key: string,
  entry: ChatTokenEstimateMemoEntry
): void {
  memo.set(sessionId, {key, entry});
}

/** 仅测试用：清全部或指定会话。 */
export function clearChatTokenEstimateMemo(sessionId?: string): void {
  if (sessionId == null) {
    memo.clear();
    workplaceEstimateByFp.clear();
  } else {
    memo.delete(sessionId);
  }
}

/**
 * 消息尾戳：数量 + 末条 seq + blocks 折算长度和。
 *
 * 长度和用 `JSON.stringify(blocks).length`（一次小序列化，消息体远小于
 * workplace 前缀）；「同长度异内容」的编辑是病理边界——估读标签短暂陈旧，
 * 下一次消息事件自愈，可接受（与旧指纹 memo 同款取舍，见模块头）。
 */
export function stampMessagesForEstimateMemo(
  messages: readonly ChatMessage[]
): string {
  let lenSum = 0;
  let lastSeq = 0;
  for (const m of messages) {
    lenSum += JSON.stringify(m.content).length;
    if (m.seq > lastSeq) {
      lastSeq = m.seq;
    }
  }
  return `${messages.length}:${lastSeq}:${lenSum}`;
}

/** tools 折算长度（tools 集随 agent 定义变，长度异即 miss；消息体同款取舍）。 */
export function stampToolsForEstimateMemo(
  tools: unknown
): string {
  if (tools == null) {
    return "0";
  }
  try {
    return String(JSON.stringify(tools).length);
  } catch {
    return "unserializable";
  }
}

/**
 * 组装记忆键。`workplaceFingerprint` 缺省（调用方没走 assemble / 旧路径）时
 * 返回 null——没有前缀指纹就没有「内容没变」的判定依据，不缓存（与无此
 * 记忆前的行为一致），宁可贵也不给陈旧读数开口子。
 */
export function buildChatTokenEstimateMemoKey(params: {
  readonly savedModelId: string | undefined;
  readonly workplaceFingerprint: string | undefined;
  readonly messages: readonly ChatMessage[] | undefined;
  readonly tools: unknown;
}): string | null {
  const fp = params.workplaceFingerprint;
  if (fp == null) {
    return null;
  }
  const msgStamp =
    params.messages == null
      ? "0::0"
      : stampMessagesForEstimateMemo(params.messages);
  return [
    params.savedModelId ?? "none",
    fp,
    msgStamp,
    stampToolsForEstimateMemo(params.tools),
  ].join("|");
}
