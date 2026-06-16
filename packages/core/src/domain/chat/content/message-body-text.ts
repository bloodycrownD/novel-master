/**
 * Plain-text extraction from content blocks for prompts and provider fallbacks.
 *
 * @module domain/chat/content/message-body-text
 */

import { formatToolResultContentForDisplay } from "@/domain/tool/logic/format-tool-output.js";
import type { ContentBlock } from "../model/content-block.js";
import type { ChatMessage } from "../model/message.js";
import type { MessageContent } from "../model/content-block.js";

function blockBodyText(block: ContentBlock): string | null {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      return "[image]";
    case "tool_use": {
      const head = `[tool_use name=${block.name} id=${block.id}]`;
      const inputJson = JSON.stringify(block.input, null, 2);
      return inputJson === "{}" ? head : `${head}\n${inputJson}`;
    }
    case "tool_result": {
      const head = `[tool_result id=${block.toolUseId}]`;
      const body = formatToolResultContentForDisplay(block.content);
      return body === "" ? head : `${head}\n\n${body}`;
    }
    case "thinking":
    case "redacted_thinking":
      // Omitted from LLM prompt body by design.
      return null;
    default:
      return null;
  }
}

/** Extract readable plain text from content blocks (skips thinking blocks). */
export function messageBodyTextFromBlocks(
  blocks: readonly ContentBlock[],
): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const text = blockBodyText(block);
    if (text != null && text !== "") {
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

/** Extract readable plain text from {@link MessageContent} (skips thinking blocks). */
export function messageBodyTextFromContent(content: MessageContent): string {
  return messageBodyTextFromBlocks(content.blocks);
}

/** Plain-text body for a chat message (matches prompt chat block input). */
export function messageBodyText(m: ChatMessage): string {
  return messageBodyTextFromContent(m.content);
}

/** Role-prefixed segments for CLI / real-prompt preview (tool_result → `tool` role). */
export function formatChatMessageForCliPreview(
  message: ChatMessage,
): ReadonlyArray<{ readonly role: string; readonly body: string }> {
  const toolResults = message.content.blocks.filter(
    (b) => b.type === "tool_result",
  );
  const other = message.content.blocks.filter(
    (b) =>
      b.type !== "tool_result" &&
      b.type !== "thinking" &&
      b.type !== "redacted_thinking",
  );

  const segments: Array<{ role: string; body: string }> = [];

  if (toolResults.length > 0) {
    const bodies: string[] = [];
    for (const tr of toolResults) {
      if (tr.type !== "tool_result") {
        continue;
      }
      const body = formatToolResultContentForDisplay(tr.content);
      if (body !== "") {
        bodies.push(body);
      }
    }
    if (bodies.length > 0) {
      segments.push({ role: "tool", body: bodies.join("\n\n") });
    }
  }

  if (other.length > 0) {
    const body = messageBodyTextFromBlocks(other);
    if (body !== "") {
      segments.push({ role: message.role, body });
    }
  }

  return segments;
}
