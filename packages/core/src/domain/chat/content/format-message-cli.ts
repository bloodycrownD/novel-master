/**
 * Human-readable CLI formatting for message content blocks.
 *
 * @module domain/chat/content/format-message-cli
 */

import type { ContentBlock } from "../model/content-block.js";
import type { MessageContent } from "../model/content-block.js";

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function formatBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      if (block.source.kind === "url") {
        return `[image url=${block.source.url}]`;
      }
      return `[image base64 mediaType=${block.source.mediaType}]`;
    case "tool_use":
      return `[tool_use] ${block.name} (${block.id})`;
    case "tool_result":
      return `[tool_result] ${block.toolUseId}: ${truncate(block.content, 120)}`;
    case "thinking":
      return `[thinking] ${truncate(block.text, 80)}`;
    default:
      return "";
  }
}

/** Multi-line human-readable summary for `nm message list`. */
export function formatMessageForCli(content: MessageContent): string {
  return content.blocks.map(formatBlock).join("\n");
}
