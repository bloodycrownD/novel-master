/**
 * View-time LLM history transform: orphan `tool_result` → plain text (compaction-safe).
 *
 * Pairing is based on **visible** history only. Hidden assistant `tool_use` does not count;
 * the block is flattened to the same `[tool_result id=…]` text used by token counting.
 *
 * 本模块还处理反向情况：孤立的 `tool_use`（没有对应 `tool_result`）——
 * 通常发生在上一轮 agent run 在工具执行阶段崩溃后，assistant 消息已落库但
 * tool_result 未追加。发给 API 前必须把这类悬挂的 tool_use 移除，否则
 * OpenAI 格式 API 会报 "insufficient tool messages following tool_calls"。
 *
 * @module service/prompt/normalize-orphan-tool-results-for-llm
 */

import { messageBodyTextFromBlocks } from "@/domain/chat/content/message-body-text.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";

function isToolResultPairedInVisible(
  toolUseId: string,
  visibleMessages: readonly ChatMessage[]
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

/** 收集 visible 消息里所有 tool_result 引用的 toolUseId */
function collectToolResultIds(
  visibleMessages: readonly ChatMessage[]
): Set<string> {
  const ids = new Set<string>();
  for (const msg of visibleMessages) {
    for (const block of msg.content.blocks) {
      if (block.type === "tool_result") {
        ids.add(block.toolUseId);
      }
    }
  }
  return ids;
}

/**
 * Returns messages with unpaired `tool_result` blocks replaced by `text` blocks.
 * Does not mutate DB rows — same pattern as regex channel transforms.
 */
export function normalizeOrphanToolResultsForLlm(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  // 第一遍：处理孤立的 tool_result（没有对应 tool_use 的）
  const orphanResultFixed = messages.map((msg) => {
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

  // 第二遍：处理孤立的 tool_use（没有对应 tool_result 的）——
  // 直接从 blocks 中移除悬挂的 tool_use，避免 API 400。
  const pairedResultIds = collectToolResultIds(orphanResultFixed);
  return orphanResultFixed.map((msg) => {
    let changed = false;
    const blocks: ContentBlock[] = [];

    for (const block of msg.content.blocks) {
      if (block.type === "tool_use" && !pairedResultIds.has(block.id)) {
        changed = true;
        // 跳过这个 block（悬挂的 tool_use）
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
