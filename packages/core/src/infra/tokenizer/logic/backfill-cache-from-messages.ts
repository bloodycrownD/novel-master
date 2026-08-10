/**
 * cache miss 时从历史 assistant message 回填进程内 promptTokens 缓存。
 *
 * @module infra/tokenizer/logic/backfill-cache-from-messages
 */

import type { ChatMessage } from "../../../domain/chat/model/message.js";
import { sessionApiPromptTokenCache } from "./session-api-prompt-token-cache.js";

/**
 * 自后向前扫描 messages，把最后一条「非 hidden 且带 promptTokens」的
 * assistant message 写进进程内 cache。命中返回 true，无候选返回 false。
 *
 * 注意 `!msg.hidden` 过滤——被压缩隐藏掉的 assistant message 不算「当前可见
 * prompt」的一部分，它的 usage 对不上当前上下文，不能拿来回填。
 */
export function backfillCacheFromMessages(
  sessionId: string,
  messages: readonly ChatMessage[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (
      !msg.hidden &&
      msg.role === "assistant" &&
      msg.usage?.promptTokens != null
    ) {
      sessionApiPromptTokenCache.set(sessionId, {
        promptTokens: msg.usage.promptTokens,
        // 刻意用 msg.createdAtMs（该 usage 的产生时刻），与 run-time 路径写入的
        // Date.now()（写入时刻）语义不同——回填的是「历史值什么时候发生」、
        // run-time 是「这个值什么时候被进程记下」，不要混。
        updatedAt: msg.createdAtMs,
      });
      return true;
    }
  }
  return false;
}
