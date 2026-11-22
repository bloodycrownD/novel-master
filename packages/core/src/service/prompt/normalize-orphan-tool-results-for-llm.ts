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

import { MessageBodyText } from "@/domain/chat/content/message-body-text.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessageData } from "@/domain/chat/model/message.js";

/** 孤儿 tool_result / tool_use 归一化集合（compaction-safe view-time transform）。 */
export const OrphanToolResults = {
    /**
   * Returns messages with unpaired `tool_result` blocks replaced by `text` blocks.
   * Does not mutate DB rows — same pattern as regex channel transforms.
   *
   * nm-style: keep-local — 导出函数；唯一生产调用方在 service/agent/impl/agent-runner.ts（本片目录外），片内无内联落点。
   */
    normalizeForLlm(messages: readonly ChatMessageData[]): ChatMessageData[] {
        // 第一遍：处理孤立的 tool_result（没有对应 tool_use 的）
        const orphanResultFixed = messages.map((msg) => {
            let changed = false;
            const blocks: ContentBlock[] = [];

            for (const block of msg.content.blocks) {
                if (block.type === "tool_result" && !messages.some((other) => other.content.blocks.some((candidate) => candidate.type === "tool_use" && candidate.id === block.toolUseId))) {
                    changed = true;
                    const text = MessageBodyText.fromBlocks([block]);
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
        const pairedResultIds = new Set<string>();
        for (const msg of orphanResultFixed) {
            for (const block of msg.content.blocks) {
                if (block.type === "tool_result") {
                    pairedResultIds.add(block.toolUseId);
                }
            }
        }
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
    },
} as const;
