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
import { feedSseLines } from "./sse-line-buffer.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ToolUseAccumulator = {
  id: string;
  name: string;
  inputJson: string;
};

type ActiveBlock =
  | { type: "text"; parts: string[] }
  | { type: "thinking"; text: string[]; signature: string[] }
  | { type: "redacted_thinking"; data: string; signature?: string }
  | { type: "tool_use"; index: number };

export type AnthropicSseParserState = {
  buffer: string;
  blocks: ContentBlock[];
  active: ActiveBlock | null;
  toolUses: ToolUseAccumulator[];
  streamRaw: unknown;
};

export function createAnthropicSseParserState(): AnthropicSseParserState {
  return {
    buffer: "",
    blocks: [],
    active: null,
    toolUses: [],
    streamRaw: undefined,
  };
}

function flushActiveBlock(
  state: AnthropicSseParserState,
  onStream?: (event: LlmStreamEvent) => void,
  toolNames?: AnthropicToolNameWire,
): void {
  const active = state.active;
  if (active == null) {
    return;
  }

  switch (active.type) {
    case "text": {
      const text = active.parts.join("");
      if (text !== "") {
        state.blocks.push({ type: "text", text });
      }
      break;
    }
    case "thinking": {
      const text = active.text.join("");
      const signature = active.signature.join("");
      if (text !== "" || signature !== "") {
        state.blocks.push({
          type: "thinking",
          text,
          ...(signature !== "" ? { thinkingSignature: signature } : {}),
        });
      }
      break;
    }
    case "redacted_thinking": {
      state.blocks.push({
        type: "redacted_thinking",
        data: active.data,
        ...(active.signature != null ? { thinkingSignature: active.signature } : {}),
      });
      break;
    }
    case "tool_use": {
      const tu = state.toolUses[active.index];
      if (tu != null) {
        let input: Record<string, unknown> = {};
        try {
          input = tu.inputJson
            ? (JSON.parse(tu.inputJson) as Record<string, unknown>)
            : {};
        } catch {
          input = {};
        }
        const name = toolNames?.fromWire(tu.name) ?? tu.name;
        state.blocks.push({
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
      break;
    }
  }

  state.active = null;
}

function ensureActiveText(state: AnthropicSseParserState): Extract<ActiveBlock, { type: "text" }> {
  if (state.active?.type === "text") {
    return state.active;
  }
  flushActiveBlock(state);
  const active: Extract<ActiveBlock, { type: "text" }> = { type: "text", parts: [] };
  state.active = active;
  return active;
}

function ensureActiveThinking(
  state: AnthropicSseParserState,
): Extract<ActiveBlock, { type: "thinking" }> {
  if (state.active?.type === "thinking") {
    return state.active;
  }
  flushActiveBlock(state);
  const active: Extract<ActiveBlock, { type: "thinking" }> = {
    type: "thinking",
    text: [],
    signature: [],
  };
  state.active = active;
  return active;
}

function processAnthropicSseLine(
  state: AnthropicSseParserState,
  line: string,
  onStream?: (event: LlmStreamEvent) => void,
  toolNames?: AnthropicToolNameWire,
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
    flushActiveBlock(state, onStream, toolNames);
    const block = event.content_block;
    if (!isRecord(block) || typeof block.type !== "string") {
      return;
    }
    if (block.type === "tool_use") {
      state.toolUses.push({
        id: typeof block.id === "string" ? block.id : "",
        name: typeof block.name === "string" ? block.name : "",
        inputJson: "",
      });
      state.active = { type: "tool_use", index: state.toolUses.length - 1 };
    } else if (block.type === "thinking") {
      state.active = { type: "thinking", text: [], signature: [] };
    } else if (block.type === "redacted_thinking") {
      const data = typeof block.data === "string" ? block.data : "";
      const signature =
        typeof block.signature === "string" && block.signature !== ""
          ? block.signature
          : undefined;
      state.active = { type: "redacted_thinking", data, signature };
    } else if (block.type === "text") {
      state.active = { type: "text", parts: [] };
    }
  } else if (type === "content_block_delta") {
    const delta = event.delta;
    if (!isRecord(delta)) {
      return;
    }
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      ensureActiveText(state).parts.push(delta.text);
      onStream?.({ type: "text-delta", text: delta.text });
    } else if (
      delta.type === "thinking_delta" &&
      typeof delta.thinking === "string"
    ) {
      ensureActiveThinking(state).text.push(delta.thinking);
      onStream?.({ type: "thinking-delta", text: delta.thinking });
    } else if (
      delta.type === "signature_delta" &&
      typeof delta.signature === "string"
    ) {
      // Claude 4+ streams opaque signature fragments before content_block_stop.
      ensureActiveThinking(state).signature.push(delta.signature);
    } else if (
      delta.type === "input_json_delta" &&
      typeof delta.partial_json === "string" &&
      state.active?.type === "tool_use"
    ) {
      state.toolUses[state.active.index]!.inputJson += delta.partial_json;
    }
  } else if (type === "content_block_stop") {
    flushActiveBlock(state, onStream, toolNames);
  }
}

/**
 * Feed one UTF-8 text chunk (may split mid-line); emits stream events via `onStream`.
 */
export function feedAnthropicSseChunk(
  state: AnthropicSseParserState,
  chunk: string,
  onStream?: (event: LlmStreamEvent) => void,
  toolNames?: AnthropicToolNameWire,
): void {
  feedSseLines(state, chunk, line =>
    processAnthropicSseLine(state, line, onStream, toolNames),
  );
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
    feedAnthropicSseChunk(state, "\n", onStream, toolNames);
  }

  flushActiveBlock(state, onStream, toolNames);

  return { blocks: state.blocks, streamRaw: state.streamRaw };
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
    feedAnthropicSseChunk(state, "\n", onStream, toolNames);
  }

  flushActiveBlock(state, onStream, toolNames);

  const text = state.blocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const thinking = state.blocks
    .filter((b): b is Extract<ContentBlock, { type: "thinking" }> => b.type === "thinking")
    .map((b) => b.text)
    .join("");
  const toolUses = state.blocks
    .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  const otherBlocks = state.blocks.filter(
    (b) => b.type !== "text" && b.type !== "thinking" && b.type !== "tool_use",
  );

  const blocks = buildStreamPartialBlocks(
    { text, thinking, toolUses },
    onStream,
  );
  blocks.push(...otherBlocks);

  return {
    blocks,
    streamRaw: state.streamRaw ?? ({ streamed: true, aborted: true } as Record<string, unknown>),
  };
}
