/**
 * View-time LLM history transform: orphan `tool_result` → plain text (compaction-safe).
 *
 * Pairing is based on **visible** history only. Hidden assistant `tool_use` does not count;
 * the block is flattened to the same `[tool_result id=…]` text used by token counting.
 *
 * @module service/prompt/normalize-orphan-tool-results-for-llm
 */

import { messageBodyTextFromBlocks } from "@/domain/chat/content/message-body-text.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";

function isToolResultPairedInVisible(
  toolUseId: string,
  visibleMessages: readonly ChatMessage[],
): boolean {
  for (const msg of visibleMessages) {
    for (const block of msg.content.blocks) {
      if (block.type === "tool_use" && block.id === toolUseId) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns messages with unpaired `tool_result` blocks replaced by `text` blocks.
 * Does not mutate DB rows — same pattern as regex channel transforms.
 */
export function normalizeOrphanToolResultsForLlm(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  return messages.map((msg) => {
    let changed = false;
    const blocks: ContentBlock[] = [];

    for (const block of msg.content.blocks) {
      if (
        block.type === "tool_result" &&
        !isToolResultPairedInVisible(block.toolUseId, messages)
      ) {
        changed = true;
        const text = messageBodyTextFromBlocks([block]);
        blocks.push({
          type: "text",
          text: text !== "" ? text : "[tool_result]",
        });
        continue;
      }
      blocks.push(block);
    }

    if (!changed) {
      return msg;
    }
    return { ...msg, content: { blocks } };
  });
}
