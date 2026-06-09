/**
 * Turn-boundary rollback anchor: assistant with settled tools → paired tool_result row.
 *
 * @module domain/message-checkpoint/logic/resolve-rollback-anchor
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { ToolUseBlock } from "@/domain/chat/model/content-block.js";

function toolUseIdsFromMessage(message: ChatMessage): readonly string[] {
  return (message.content.blocks ?? [])
    .filter((b): b is ToolUseBlock => b.type === "tool_use")
    .map((b) => b.id);
}

function messageHasToolUse(message: ChatMessage): boolean {
  return toolUseIdsFromMessage(message).length > 0;
}

/** First user message after assistant whose tool_result ids cover all assistant tool_use ids. */
function resolveToolResultsMessageId(
  messages: readonly ChatMessage[],
  assistantMessage: ChatMessage,
): string | undefined {
  const required = new Set(toolUseIdsFromMessage(assistantMessage));
  if (required.size === 0) {
    return undefined;
  }
  for (const message of messages) {
    if (message.seq <= assistantMessage.seq || message.role !== "user") {
      continue;
    }
    const resultIds = new Set<string>();
    for (const block of message.content.blocks ?? []) {
      if (block.type === "tool_result") {
        resultIds.add(block.toolUseId);
      }
    }
    if ([...required].every((id) => resultIds.has(id))) {
      return message.id;
    }
  }
  return undefined;
}

/**
 * Maps the user-clicked message to the effective truncate/checkpoint anchor.
 * Assistant tool turns with paired results anchor at tool_result (turn end).
 */
export function resolveRollbackAnchorMessage(
  messages: readonly ChatMessage[],
  anchorMessageId: string,
): ChatMessage | undefined {
  const anchor = messages.find((m) => m.id === anchorMessageId);
  if (anchor == null) {
    return undefined;
  }
  if (anchor.role === "assistant" && messageHasToolUse(anchor)) {
    const resultsId = resolveToolResultsMessageId(messages, anchor);
    if (resultsId != null) {
      const resultsMessage = messages.find((m) => m.id === resultsId);
      if (resultsMessage != null) {
        return resultsMessage;
      }
    }
  }
  return anchor;
}
