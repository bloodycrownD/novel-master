/**
 * 从消息构建用量账本行。
 *
 * @module domain/usage/logic/build-usage-record
 */

import type { ChatMessageData } from "@/domain/chat/model/message.js";
import type { UsageRecordInsert } from "../model/usage-record.js";

/**
 * 把一条刚落库的消息映射为账本行；不满足入账条件时返回 null。
 *
 * 入账条件（与旧统计口径 USAGE_NOT_NULL_SQL 同源，保证数字口径不漂移）：
 * ① `role === "assistant"`——usage 只由 agent 回合的 assistant 消息携带；
 * ② prompt / completion 至少一侧非空——无 token 真值的请求（三方网关不给
 * usage、非流式无上报）不入账本，旧口径下这些行同样不计任何求和与次数。
 *
 * 其余统计列（total / cache / 耗时 / 协议 / 服务商 / 模型）原样快照，缺省记
 * NULL——口径由读侧 SQL 决定，账本侧不做二次加工。
 */
export function buildUsageRecordFromMessage(
  message: ChatMessageData
): UsageRecordInsert | null {
  if (message.role !== "assistant") {
    return null;
  }
  const usage = message.usage;
  if (usage == null) {
    return null;
  }
  if (usage.promptTokens == null && usage.completionTokens == null) {
    return null;
  }
  return {
    sessionId: message.sessionId,
    messageSeq: message.seq,
    provider: message.provider ?? null,
    providerId: message.providerId ?? null,
    modelName: message.modelName ?? null,
    promptTokens: usage.promptTokens ?? null,
    completionTokens: usage.completionTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    cacheReadTokens: usage.cacheReadTokens ?? null,
    cacheCreationTokens: usage.cacheCreationTokens ?? null,
    firstTokenMs: usage.firstTokenMs ?? null,
    durationMs: usage.durationMs ?? null,
    createdAtMs: message.createdAtMs,
  };
}
