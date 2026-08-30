/**
 * 聊天记录查询：关键词匹配纯函数 + LIKE 转义 + 查询入参类型。
 *
 * @module domain/chat/content/message-content-match
 */

import type { ChatMessage } from "../model/message.js";

/**
 * 转义 SQLite LIKE 通配符（`\` `%` `_`），每个特殊字符前加反斜杠。
 * 配合 SQL 侧 `LIKE ... ESCAPE '\'` 使用，避免用户输入的通配符被当成 LIKE 元字符。
 */
export function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 聊天记录查询入参。keyword 为空/undefined 时不做关键词过滤。 */
export interface MessageSearchQuery {
  /** 为空/undefined 时不做关键词过滤。 */
  readonly keyword?: string;
  /** 返回条数上限。 */
  readonly limit: number;
  /** 翻页：只返回 seq < beforeSeq 的消息。 */
  readonly beforeSeq?: number;
  /** 区间下界（闭区间，含 hidden 消息）：为空/undefined 时不设下界。 */
  readonly fromSeq?: number;
  /** 区间上界（闭区间，含 hidden 消息）：为空/undefined 时不设上界。 */
  readonly toSeq?: number;
}

/**
 * 判断单条消息是否命中关键词（大小写不敏感的 includes 匹配）。
 *
 * 只对 `role === 'user' || role === 'assistant'` 的消息做匹配（其余角色直接返回 false）；
 * 遍历 `content.blocks`，只看 `type === 'text'` 的块取 `block.text`，忽略 tool_use /
 * tool_result / thinking / redacted_thinking。匹配时两端 toLowerCase 后做 includes。
 *
 * keyword 为空串时调用方应自行决定是否精筛（本函数不特殊处理）。
 */
export function messageMatchesKeyword(
  message: ChatMessage,
  keyword: string
): boolean {
  if (message.role !== "user" && message.role !== "assistant") {
    return false;
  }
  const needle = keyword.toLowerCase();
  for (const block of message.content.blocks) {
    if (block.type !== "text") {
      continue;
    }
    if (block.text.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}
