/**
 * Abort-time partial blocks for streaming LLM adapters.
 *
 * On user cancel we keep thinking without promoting it into visible text.
 * Empty text blocks are omitted (content_json requires non-empty text strings).
 *
 * @module infra/llm-protocol/logic/stream-partial-blocks
 */

import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { LlmStreamEvent } from "../ports/adapter.port.js";

export type StreamPartialToolUse = {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
};

export type StreamPartialInput = {
  readonly text: string;
  readonly thinking: string;
  readonly toolUses?: readonly StreamPartialToolUse[];
};

/**
 * Build NM blocks from stream accumulators when the request was aborted.
 * Returns `[]` when nothing was streamed.
 */
export function buildStreamPartialBlocks(
  input: StreamPartialInput,
  onStream?: (event: LlmStreamEvent) => void,
): ContentBlock[] {
  const text = input.text;
  const thinking = input.thinking;
  const blocks: ContentBlock[] = [];
  if (thinking.trim() !== "") {
    blocks.push({ type: "thinking", text: thinking });
  }
  if (text.length > 0) {
    blocks.push({ type: "text", text });
  }
  for (const tu of input.toolUses ?? []) {
    blocks.push({
      type: "tool_use",
      id: tu.id,
      name: tu.name,
      input: tu.input,
    });
    onStream?.({
      type: "tool-use",
      id: tu.id,
      name: tu.name,
      input: tu.input,
    });
  }
  return blocks;
}
