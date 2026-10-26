/**
 * Turn-boundary rollback anchor: assistant with settled tools → paired tool_result row.
 *
 * @module domain/message-checkpoint/logic/resolve-rollback-anchor
 */

import type { ChatMessageData } from "@/domain/chat/model/message.js";
import type { ToolUseBlock } from "@/domain/chat/model/content-block.js";

/**
 * Maps the user-clicked message to the effective truncate/checkpoint anchor.
 * Assistant tool turns with paired results anchor at tool_result (turn end).
 */
export function resolveRollbackAnchorMessage(messages: readonly ChatMessageData[], anchorMessageId: string): ChatMessageData | undefined {
  const anchor = messages.find((m) => m.id === anchorMessageId);
  if (anchor == null) {
    return undefined;
  }
  if (anchor.role === "assistant") {
    const required = new Set((anchor.content.blocks ?? []).filter((b): b is ToolUseBlock => b.type === "tool_use").map((b) => b.id));
    if (required.size === 0) {
      return anchor;
    }
    // First user message after assistant whose tool_result ids cover all tool_use ids.
    for (const message of messages) {
      if (message.seq <= anchor.seq || message.role !== "user") {
        continue;
      }
      const resultIds = new Set<string>();
      for (const block of message.content.blocks ?? []) {
        if (block.type === "tool_result") {
          resultIds.add(block.toolUseId);
        }
      }
      if ([...required].every((id) => resultIds.has(id))) {
        return message;
      }
    }
  }
  return anchor;
}
