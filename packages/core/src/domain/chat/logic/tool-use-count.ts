/**
 * 消息 content blocks 里的 tool_use 块计数（单源）。
 *
 * 消费方：usage-stats 会话详情读侧的缓存 miss 现算、message.service
 * append 的失效判定（含 tool_use 才失效工具调用数缓存）。口径：只数块
 * 类型，不区分消息角色/可见性（角色过滤由调用方 SQL 负责，与
 * getSessionUsageDetail 的工具调用数口径一致——含 hidden 行）。
 *
 * 历史注记：曾配套 `chat_message.tool_use_count` 列方案（写入时维护 +
 * SUM 读），2026-09-29 同日撤回改会话 KKV 缓存（见 cr-fix-spec-r2）。
 *
 * @module domain/chat/logic/tool-use-count
 */

import type { MessageContent } from "../model/content-block.js";

/** 数 content blocks 里的 tool_use 块数（O(blocks)，无分配）。 */
export function countToolUseBlocks(content: MessageContent): number {
  let n = 0;
  for (const block of content.blocks) {
    if (block.type === "tool_use") {
      n += 1;
    }
  }
  return n;
}
