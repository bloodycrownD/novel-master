/**
 * Plain-text extraction from content blocks for prompts and provider fallbacks.
 *
 * @module domain/chat/content/message-body-text
 */

import type { ContentBlock } from "../model/content-block.js";
import type { ChatMessage } from "../model/message.js";
import type { MessageContent } from "../model/content-block.js";

function blockBodyText(block: ContentBlock): string | null {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      return "[image]";
    case "tool_use":
      return `[tool_use name=${block.name} id=${block.id}]`;
    case "tool_result": {
      const head = `[tool_result id=${block.toolUseId}]`;
      return block.content !== "" ? `${head}\n${block.content}` : head;
    }
    case "thinking":
      // Omitted from LLM prompt body by design.
      return null;
    default:
      return null;
  }
}

/** Extract readable plain text from {@link MessageContent} (skips thinking blocks). */
export function messageBodyTextFromContent(content: MessageContent): string {
  const parts: string[] = [];
  for (const block of content.blocks) {
    const text = blockBodyText(block);
    if (text != null && text !== "") {
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

/** Plain-text body for a chat message (matches prompt chat block input). */
export function messageBodyText(m: ChatMessage): string {
  return messageBodyTextFromContent(m.content);
}
