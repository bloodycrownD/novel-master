/**
 * Text-only extraction for OpenAI/Gemini adapters (non-text blocks error).
 *
 * @module infra/llm-protocol/logic/text-only-content
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessageData } from "@/domain/chat/model/message.js";

/** Join text blocks; reject image/tool/thinking in outbound requests. */
export function blocksToTextOnly(blocks: readonly ContentBlock[]): Result<string, AppError> {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push(block.text);
      continue;
    }
    return Result.err(new AppError("PROVIDER_UNSUPPORTED_CONTENT", { detail: `Provider does not support ${block.type} content blocks; use Anthropic or send text only` }));
  }
  return Result.ok(parts.join("\n\n"));
}

/** True when every block in history is `text` (legacy `nm model request` shortcut). */
export function isTextOnlyHistory(messages: readonly ChatMessageData[]): boolean {
  for (const msg of messages) {
    for (const block of msg.content.blocks) {
      if (block.type !== "text") {
        return false;
      }
    }
  }
  return true;
}

/** Flatten chat history to a single user string (text blocks only). */
export function chatMessagesToTextOnly(
  messages: readonly ChatMessageData[]
): Result<string, AppError> {
  const parts: string[] = [];
  for (const msg of messages) {
    const body = blocksToTextOnly(msg.content.blocks);
    if (!body.ok) return body;
    if (body.value !== "") {
      parts.push(`${msg.role}: ${body.value}`);
    }
  }
  return Result.ok(parts.join("\n\n"));
}
