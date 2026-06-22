/**
 * Plain-text extraction from content blocks for prompts and provider fallbacks.
 *
 * @module domain/chat/content/message-body-text
 */

import { formatToolResultContentForDisplay } from "@/domain/tool/logic/format-tool-output.js";
import type { ContentBlock } from "../model/content-block.js";
import type { ChatMessage } from "../model/message.js";
import type { MessageContent } from "../model/content-block.js";

/** 剥离模型泄漏的孤立闭合思考标签（GLM / 代理网关常见）。 */
function stripOrphanThinkingCloseTags(text: string): string {
  return text
    .replace(
      /<\/(?:thought|thinking|think|redacted_thinking)\b[^>]*>/gi,
      "",
    )
    .trim();
}

function blockBodyText(block: ContentBlock): string | null {
  switch (block.type) {
    case "text": {
      const cleaned = stripOrphanThinkingCloseTags(block.text);
      return cleaned === "" ? null : cleaned;
    }
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

/** Role-prefixed segments for CLI / real-prompt preview (tool_result → `tool`; tool_use → `tool_call`). */
export function formatChatMessageForCliPreview(
  message: ChatMessage,
): ReadonlyArray<{ readonly role: string; readonly body: string }> {
  const segments: Array<{ role: string; body: string }> = [];

  const toolResultBodies: string[] = [];
  for (const block of message.content.blocks) {
    if (block.type !== "tool_result") {
      continue;
    }
    const body = formatToolResultContentForDisplay(block.content);
    if (body !== "") {
      toolResultBodies.push(body);
    }
  }
  if (toolResultBodies.length > 0) {
    segments.push({ role: "tool", body: toolResultBodies.join("\n\n") });
  }

  let textBuffer: string[] = [];
  const flushText = () => {
    if (textBuffer.length === 0) {
      return;
    }
    const body = textBuffer.join("\n\n");
    if (body !== "") {
      segments.push({ role: message.role, body });
    }
    textBuffer = [];
  };

  for (const block of message.content.blocks) {
    if (
      block.type === "tool_result" ||
      block.type === "thinking" ||
      block.type === "redacted_thinking"
    ) {
      continue;
    }
    if (block.type === "tool_use") {
      flushText();
      const body = blockBodyText(block);
      if (body != null && body !== "") {
        segments.push({ role: "tool_call", body });
      }
      continue;
    }
    const text = blockBodyText(block);
    if (text != null && text !== "") {
      textBuffer.push(text);
    }
  }
  flushText();

  return segments;
}
