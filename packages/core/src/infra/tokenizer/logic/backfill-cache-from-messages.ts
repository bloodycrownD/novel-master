/**
 * cache miss 时的回填逻辑。
 *
 * 原来实现是从消息里取旧 promptTokens 回填 cache，但置位/压缩后上下文范围变了
 * （动态区/持久区/工作区等系统 prompt 不在消息里），旧值不再准确。
 * 现在直接返回 false，让调用方走本地 tokenizer 重新计算完整 prompt。
 *
 * @module infra/tokenizer/logic/backfill-cache-from-messages
 */

import type { ChatMessage } from "../../../domain/chat/model/message.js";

/**
 * 已废弃：不再从消息回填 cache。返回 false 让调用方走本地计算。
 *
 * 保留函数签名避免调用方编译断裂，后续可在清理时移除。
 */
export function backfillCacheFromMessages(
  _sessionId: string,
  _messages: readonly ChatMessage[],
): boolean {
  return false;
}
