/**
 * 消息 content blocks 里的 tool_use 块计数（单源）。
 *
 * 消费方：repository 写路径（`chat_message.tool_use_count` 列写入时维护）、
 * usage-stats 会话详情读侧的存量行兜底、db-maintenance 的存量回填任务。
 * 口径：只数块类型，不区分消息角色/可见性（角色过滤由调用方 SQL 负责，
 * 与 `getSessionUsageDetail` 的会话累计口径一致——含 hidden 行）。
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
