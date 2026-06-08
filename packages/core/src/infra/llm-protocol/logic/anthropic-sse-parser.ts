/**
 * Incremental Anthropic Messages API SSE parser.
 *
 * Shared by {@link postSse} chunk delivery; abort partial uses {@link buildStreamPartialBlocks}.
 *
 * @module infra/llm-protocol/logic/anthropic-sse-parser
 */

import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { LlmStreamEvent } from "../ports/adapter.port.js";
import type { AnthropicToolNameWire } from "./anthropic-tool-names.js";
import { buildStreamPartialBlocks } from "./stream-partial-blocks.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ToolUseAccumulator = {
  id: string;
  name: string;
  inputJson: string;
};

export type AnthropicSseParserState = {
  buffer: string;
  textParts: string[];
  thinkingParts: string[];
  toolUses: ToolUseAccumulator[];
  currentToolIndex: number;
  streamRaw: unknown;
};

export function createAnthropicSseParserState(): AnthropicSseParserState {
  return {
    buffer: "",
    textParts: [],
    thinkingParts: [],
    toolUses: [],
    currentToolIndex: -1,
    streamRaw: undefined,
  };
}

function flushToolBlock(state: AnthropicSseParserState): void {
  state.currentToolIndex = -1;
}

function processAnthropicSseLine(
  state: AnthropicSseParserState,
  line: string,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  if (!line.startsWith("data: ")) {
    return;
  }
  const payload = line.slice(6).trim();
  if (payload === "" || payload === "[DONE]") {
    return;
  }
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = event.type;
  if (type === "message_start" || type === "message_delta") {
    state.streamRaw = event;
  }
  if (type === "content_block_start") {
    const block = event.content_block;
    if (isRecord(block) && block.type === "tool_use") {
      state.toolUses.push({
        id: typeof block.id === "string" ? block.id : "",
        name: typeof block.name === "string" ? block.name : "",
        inputJson: "",
      });
      state.currentToolIndex = state.toolUses.length - 1;
    }
  } else if (type === "content_block_delta") {
    const delta = event.delta;
    if (!isRecord(delta)) {
      return;
    }
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      state.textParts.push(delta.text);
      onStream?.({ type: "text-delta", text: delta.text });
    } else if (
      delta.type === "thinking_delta" &&
      typeof delta.thinking === "string"
    ) {
      state.thinkingParts.push(delta.thinking);
      onStream?.({ type: "thinking-delta", text: delta.thinking });
    } else if (
      delta.type === "input_json_delta" &&
      typeof delta.partial_json === "string" &&
      state.currentToolIndex >= 0
    ) {
      state.toolUses[state.currentToolIndex]!.inputJson += delta.partial_json;
    }
  } else if (type === "content_block_stop") {
    flushToolBlock(state);
  }
}

/**
 * Feed one UTF-8 text chunk (may split mid-line); emits stream events via `onStream`.
 */
export function feedAnthropicSseChunk(
  state: AnthropicSseParserState,
  chunk: string,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    processAnthropicSseLine(state, line, onStream);
  }
}

function toolUsesToBlocks(
  toolUses: readonly ToolUseAccumulator[],
  onStream?: (event: LlmStreamEvent) => void,
  toolNames?: AnthropicToolNameWire,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const tu of toolUses) {
    let input: Record<string, unknown> = {};
    try {
      input = tu.inputJson ? (JSON.parse(tu.inputJson) as Record<string, unknown>) : {};
    } catch {
      input = {};
    }
    const name = toolNames?.fromWire(tu.name) ?? tu.name;
    blocks.push({
      type: "tool_use",
      id: tu.id,
      name,
      input,
    });
    onStream?.({
      type: "tool-use",
      id: tu.id,
      name,
      input,
    });
  }
  return blocks;
}

/** Finalize parser state into content blocks (normal stream end). */
export function finishAnthropicSse(
  state: AnthropicSseParserState,
  onStream?: (event: LlmStreamEvent) => void,
  toolNames?: AnthropicToolNameWire,
): {
  blocks: ContentBlock[];
  streamRaw: unknown;
} {
  if (state.buffer !== "") {
    feedAnthropicSseChunk(state, "\n", onStream);
  }

  const blocks: ContentBlock[] = [];
  const text = state.textParts.join("");
  if (text !== "") {
    blocks.push({ type: "text", text });
  }
  const thinking = state.thinkingParts.join("");
  if (thinking !== "") {
    blocks.push({ type: "thinking", text: thinking });
  }
  blocks.push(...toolUsesToBlocks(state.toolUses, onStream, toolNames));

  return { blocks, streamRaw: state.streamRaw };
}

/** Partial snapshot when the user aborted mid-stream. */
export function finishAnthropicSsePartial(
  state: AnthropicSseParserState,
  onStream?: (event: LlmStreamEvent) => void,
  toolNames?: AnthropicToolNameWire,
): {
  blocks: ContentBlock[];
  streamRaw: unknown;
} {
  if (state.buffer !== "") {
    feedAnthropicSseChunk(state, "\n", onStream);
  }

  const toolBlocks = toolUsesToBlocks(state.toolUses, onStream, toolNames);
  const toolUses = toolBlocks
    .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  const blocks = buildStreamPartialBlocks(
    {
      text: state.textParts.join(""),
      thinking: state.thinkingParts.join(""),
      toolUses,
    },
    onStream,
  );

  return {
    blocks,
    streamRaw: state.streamRaw ?? ({ streamed: true, aborted: true } as Record<string, unknown>),
  };
}
