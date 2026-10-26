/**
 * Plain-text extraction from content blocks for prompts and provider fallbacks.
 *
 * @module domain/chat/content/message-body-text
 */

import { formatToolResultContentForDisplay } from "@/domain/tool/logic/format-tool-output.js";
import type { ContentBlock } from "../model/content-block.js";
import type { ChatMessageData } from "../model/message.js";

function blockBodyText(block: ContentBlock): string | null {
  switch (block.type) {
    case "text": {
      // 剥离模型泄漏的孤立闭合思考标签（GLM / 代理网关常见）。
      const text = block.text.replace(/<\/(?:thought|thinking|think|redacted_thinking)\b[^>]*>/gi, "").trim();
      return text === "" ? null : text;
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
  }
}

/** Extract readable plain text from content blocks (skips thinking blocks). */
export function messageBodyTextFromBlocks(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const text = blockBodyText(block);
    if (text != null) {
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

/** Role-prefixed segments for CLI / real-prompt preview (tool_result → `tool`; tool_use → `tool_call`). */
export function formatChatMessageForCliPreview(message: ChatMessageData, options?: { readonly includeThinking?: boolean }): ReadonlyArray<{ readonly role: string; readonly body: string }> {
  const segments: Array<{ role: string; body: string }> = [];
  const toolResultBodies: string[] = [];
  let textBuffer: string[] = [];
  const flushText = () => {
    if (textBuffer.length === 0) {
      return;
    }
    segments.push({ role: message.role, body: textBuffer.join("\n\n") });
    textBuffer = [];
  };

  for (const block of message.content.blocks) {
    if (block.type === "tool_result") {
      const body = formatToolResultContentForDisplay(block.content);
      if (body !== "") {
        toolResultBodies.push(body);
      }
      continue;
    }
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      // opt-in：仅预览（includeThinking）时产出 thinking 段，块序保持在消息内位置；
      // 默认 false 保持 CLI 文本与 token 计数 parity 现状。
      if (options?.includeThinking !== true) {
        continue;
      }
      flushText();
      segments.push({
        role: "thinking",
        body: block.type === "thinking" ? block.text : "[redacted thinking]",
      });
      continue;
    }
    if (block.type === "tool_use") {
      flushText();
      const body = blockBodyText(block);
      if (body != null) {
        segments.push({ role: "tool_call", body });
      }
      continue;
    }
    const text = blockBodyText(block);
    if (text != null) {
      textBuffer.push(text);
    }
  }
  flushText();

  if (toolResultBodies.length > 0) {
    segments.unshift({ role: "tool", body: toolResultBodies.join("\n\n") });
  }
  return segments;
}
