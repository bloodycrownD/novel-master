/**
 * Text-only extraction for OpenAI/Gemini adapters (non-text blocks error).
 *
 * @module infra/llm-protocol/text-only-content
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";

/** Join text blocks; reject image/tool/thinking in outbound requests. */
export function blocksToTextOnly(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push(block.text);
      continue;
    }
    throw new ProviderError(
      "UNSUPPORTED_CONTENT",
      `Provider does not support ${block.type} content blocks; use Anthropic or send text only`,
    );
  }
  return parts.join("\n\n");
}

/** Flatten chat history to a single user string (text blocks only). */
export function chatMessagesToTextOnly(messages: readonly ChatMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const body = blocksToTextOnly(msg.content.blocks);
    if (body !== "") {
      parts.push(`${msg.role}: ${body}`);
    }
  }
  return parts.join("\n\n");
}
