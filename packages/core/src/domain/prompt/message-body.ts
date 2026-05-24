/**
 * Chat message body text for prompt chat blocks.
 *
 * @module domain/prompt/message-body
 */

import type { ChatMessage } from "../chat/model/message.js";

/**
 * Plain-text body for a chat message (matches CLI `message list` fallback).
 */
export function messageBodyText(m: ChatMessage): string {
  if (m.content.content != null) {
    return m.content.content;
  }
  return JSON.stringify(m.content);
}
