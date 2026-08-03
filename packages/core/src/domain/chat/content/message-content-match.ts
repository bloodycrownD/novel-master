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
  /** 精准（literal）或正则（regex）。 */
  readonly mode: "literal" | "regex";
  /** 大小写敏感开关（regex 模式下 false 时加 `i` flag）。 */
  readonly caseSensitive: boolean;
  /** `created_at_ms` 下界（含），undefined 时不限。 */
  readonly fromMs?: number;
  /** `created_at_ms` 上界（含），undefined 时不限。 */
  readonly toMs?: number;
  /** 返回条数上限。 */
  readonly limit: number;
  /** 翻页：只返回 seq < beforeSeq 的消息。 */
  readonly beforeSeq?: number;
}

/**
 * 判断单条消息是否命中关键词。
 *
 * 只对 `role === 'user' || role === 'assistant'` 的消息做匹配（其余角色直接返回 false）；
 * 遍历 `content.blocks`，只看 `type === 'text'` 的块取 `block.text`，忽略 tool_use /
 * tool_result / thinking / redacted_thinking。
 *
 * - 精准模式：`text.includes(keyword)`，caseSensitive=false 时两端 toLowerCase 后比较。
 * - 正则模式：`new RegExp(keyword, caseSensitive ? '' : 'i').test(text)`，非法正则返回 false。
 *
 * keyword 是纯 pattern（不含 `/` 分隔符），不支持行内 flag（如 `(?i)`），大小写只由
 * caseSensitive 开关控制。keyword 为空串时调用方应自行决定是否精筛（本函数不特殊处理）。
 */
export function messageMatchesKeyword(
  message: ChatMessage,
  keyword: string,
  opts: { mode: "literal" | "regex"; caseSensitive: boolean },
): boolean {
  if (message.role !== "user" && message.role !== "assistant") {
    return false;
  }
  const { mode, caseSensitive } = opts;
  for (const block of message.content.blocks) {
    if (block.type !== "text") {
      continue;
    }
    const text = block.text;
    if (mode === "literal") {
      if (caseSensitive) {
        if (text.includes(keyword)) {
          return true;
        }
      } else if (text.toLowerCase().includes(keyword.toLowerCase())) {
        return true;
      }
    } else {
      // 正则模式：非法正则按不命中处理（不抛异常）。
      try {
        if (new RegExp(keyword, caseSensitive ? "" : "i").test(text)) {
          return true;
        }
      } catch {
        return false;
      }
    }
  }
  return false;
}
