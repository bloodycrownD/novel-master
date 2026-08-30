/**
 * Incremental Anthropic Messages API SSE parser.
 *
 * Shared by {@link postSse} chunk delivery; abort partial uses {@link buildStreamPartialBlocks}.
 *
 * @module infra/llm-protocol/logic/anthropic-sse-parser
 */

import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type {
  DegradedToolCall,
  LlmStreamEvent,
} from "../ports/adapter.port.js";
import type { AnthropicToolNameWire } from "./anthropic-tool-names.js";
import { buildStreamPartialBlocks } from "./stream-partial-blocks.js";
import { feedSseLines } from "./sse-line-buffer.js";
import {
  assertSseParseSucceededOrThrow,
  recordMalformedSseLine,
  type SseParseDiagnostics,
} from "./sse-parse-errors.js";
import { tryParseToolArgumentsJson } from "./tool-arguments-parse.js";

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

export type AnthropicSseParserState = SseParseDiagnostics & {
  buffer: string;
  blocks: ContentBlock[];
  active: ActiveBlock | null;
  toolUses: ToolUseAccumulator[];
  /** message_start 事件原文（输入侧 usage / model 在这里，message_delta 会覆盖不到它）。 */
  messageStartRaw: unknown;
  /** message_delta 事件原文（累计 output_tokens / stop_reason 在这里）。 */
  messageDeltaRaw: unknown;
  degradedToolCalls: DegradedToolCall[];
};

export function createAnthropicSseParserState(): AnthropicSseParserState {
  return {
    buffer: "",
    blocks: [],
    active: null,
    toolUses: [],
    messageStartRaw: undefined,
    messageDeltaRaw: undefined,
    malformedLineCount: 0,
    degradedToolCalls: [],
  };
}

function flushActiveBlock(
  state: AnthropicSseParserState,
  onStream?: (event: LlmStreamEvent) => void,
  toolNames?: AnthropicToolNameWire
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
        ...(active.signature != null
          ? { thinkingSignature: active.signature }
          : {}),
      });
      break;
    }
    case "tool_use": {
      const tu = state.toolUses[active.index];
      if (tu != null) {
        const parsed = tryParseToolArgumentsJson(tu.inputJson);
        const name = toolNames?.fromWire(tu.name) ?? tu.name;
        let input: Record<string, unknown>;
        if (parsed.ok) {
          input = parsed.value;
        } else {
          input = {};
          state.degradedToolCalls.push({
            id: tu.id,
            name,
            rawArguments: parsed.raw,
            reason: "INVALID_TOOL_ARGUMENTS",
          });
        }
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

function ensureActiveText(
  state: AnthropicSseParserState
): Extract<ActiveBlock, { type: "text" }> {
  if (state.active?.type === "text") {
    return state.active;
  }
  flushActiveBlock(state);
  const active: Extract<ActiveBlock, { type: "text" }> = {
    type: "text",
    parts: [],
  };
  state.active = active;
  return active;
}

function ensureActiveThinking(
  state: AnthropicSseParserState
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
  toolNames?: AnthropicToolNameWire
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
    recordMalformedSseLine(state, payload);
    return;
  }
  const type = event.type;
  if (type === "message_start") {
    state.messageStartRaw = event;
  } else if (type === "message_delta") {
    state.messageDeltaRaw = event;
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
      const tu = state.toolUses[state.active.index]!;
      tu.inputJson += delta.partial_json;
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
  toolNames?: AnthropicToolNameWire
): void {
  feedSseLines(state, chunk, (line) =>
    processAnthropicSseLine(state, line, onStream, toolNames)
  );
}

/**
 * 合并 message_start / message_delta 双槽为单个 raw。
 *
 * usage 取 start 的输入侧（input_tokens + cache 字段）+ delta 的累计 output_tokens；
 * model 取 start；stop_reason 等其他顶层字段保留 delta 的。
 * 仅单槽有值时原样返回；两槽皆空返回 undefined（调用方自行降级）。
 */
function mergeAnthropicStreamRaw(state: AnthropicSseParserState): unknown {
  const start = state.messageStartRaw;
  const delta = state.messageDeltaRaw;
  if (!isRecord(start)) {
    return delta;
  }
  if (!isRecord(delta)) {
    return start;
  }
  const merged: Record<string, unknown> = { ...delta };
  // message_start 的 model / usage 嵌在 message 下，非流式形态才是顶层，两种都兼容。
  const startMessage = isRecord(start.message) ? start.message : undefined;
  if (typeof startMessage?.model === "string") {
    merged.model = startMessage.model;
  } else if (typeof start.model === "string") {
    merged.model = start.model;
  }
  const startUsage = isRecord(startMessage?.usage)
    ? startMessage!.usage
    : isRecord(start.usage)
    ? start.usage
    : undefined;
  const usage: Record<string, unknown> = {};
  if (startUsage != null) {
    const inputSideKeys = [
      "input_tokens",
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
      "cache_creation",
    ];
    for (const key of inputSideKeys) {
      if (startUsage[key] != null) {
        usage[key] = startUsage[key];
      }
    }
  }
  if (isRecord(delta.usage) && delta.usage.output_tokens != null) {
    usage.output_tokens = delta.usage.output_tokens;
  }
  if (Object.keys(usage).length > 0) {
    merged.usage = usage;
  }
  return merged;
}

/** Finalize parser state into content blocks (normal stream end). */
export function finishAnthropicSse(
  state: AnthropicSseParserState,
  onStream?: (event: LlmStreamEvent) => void,
  toolNames?: AnthropicToolNameWire
): {
  blocks: ContentBlock[];
  streamRaw: unknown;
  degradedToolCalls: DegradedToolCall[];
} {
  if (state.buffer !== "") {
    feedAnthropicSseChunk(state, "\n", onStream, toolNames);
  }

  flushActiveBlock(state, onStream, toolNames);

  assertSseParseSucceededOrThrow(state, state.blocks, "anthropic");
  return {
    blocks: state.blocks,
    streamRaw: mergeAnthropicStreamRaw(state),
    degradedToolCalls: state.degradedToolCalls,
  };
}

/** Partial snapshot when the user aborted mid-stream. */
export function finishAnthropicSsePartial(
  state: AnthropicSseParserState,
  onStream?: (event: LlmStreamEvent) => void,
  toolNames?: AnthropicToolNameWire
): {
  blocks: ContentBlock[];
  streamRaw: unknown;
  degradedToolCalls: DegradedToolCall[];
} {
  if (state.buffer !== "") {
    feedAnthropicSseChunk(state, "\n", onStream, toolNames);
  }

  flushActiveBlock(state, onStream, toolNames);

  const text = state.blocks
    .filter(
      (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text"
    )
    .map((b) => b.text)
    .join("");
  const thinking = state.blocks
    .filter(
      (b): b is Extract<ContentBlock, { type: "thinking" }> =>
        b.type === "thinking"
    )
    .map((b) => b.text)
    .join("");
  const toolUses = state.blocks
    .filter(
      (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use"
    )
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  const otherBlocks = state.blocks.filter(
    (b) => b.type !== "text" && b.type !== "thinking" && b.type !== "tool_use"
  );

  const blocks = buildStreamPartialBlocks(
    { text, thinking, toolUses },
    onStream
  );
  blocks.push(...otherBlocks);

  return {
    blocks,
    streamRaw:
      mergeAnthropicStreamRaw(state) ??
      ({ streamed: true, aborted: true } as Record<string, unknown>),
    degradedToolCalls: [],
  };
}
