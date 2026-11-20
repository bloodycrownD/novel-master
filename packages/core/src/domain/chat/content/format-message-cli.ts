/**
 * Human-readable CLI formatting for message content blocks.
 *
 * @module domain/chat/content/format-message-cli
 */

import { Text } from "@/common/text.js";
import type { MessageContent } from "../model/content-block.js";

export const MessageCliFormat = {
  /**
   * Multi-line human-readable summary for `nm message list`.
   *
   * nm-style: keep-public — apps/cli 经 `@novel-master/core/chat` 调用，撤导出须同步 barrel/allowlist（Wave 5）。
   */
  format(content: MessageContent): string {
    const lines = content.blocks.map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "image":
          return block.source.kind === "url" ? `[image url=${block.source.url}]` : `[image base64 mediaType=${block.source.mediaType}]`;
        case "tool_use":
          return `[tool_use] ${block.name} (${block.id})`;
        case "tool_result":
          return `[tool_result] ${block.toolUseId}: ${Text.truncate(block.content, 120)}`;
        case "thinking":
          return `[thinking] ${Text.truncate(block.text, 80)}`;
        case "redacted_thinking":
          return "[thinking redacted]";
      }
    });
    return lines.join("\n");
  },
} as const;
