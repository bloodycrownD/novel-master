/**
 * Incremental Gemini streamGenerateContent SSE parser (`?alt=sse`).
 *
 * @module infra/llm-protocol/logic/gemini-sse-parser
 */

import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { LlmStreamEvent } from "../ports/adapter.port.js";
import { geminiPartsToBlocks } from "./gemini-content-mapper.js";
import {
  cleanseReplyTextAndThinking,
  feedInlineThinkingAwareTextDelta,
  finishInlineThinkingAwareText,
} from "./inline-thinking-parser.js";
import { buildStreamPartialBlocks } from "./stream-partial-blocks.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type FunctionCallAccumulator = {
  name: string;
  argsJson: string;
  id: string;
};

export type GeminiSseParserState = {
  buffer: string;
  textParts: string[];
  thinkingParts: string[];
  functionCalls: Map<string, FunctionCallAccumulator>;
  streamRaw: unknown;
  inlineTextSplitter?: import("./inline-thinking-parser.js").InlineThinkingStreamSplitter;
};

export function createGeminiSseParserState(): GeminiSseParserState {
  return {
    buffer: "",
    textParts: [],
    thinkingParts: [],
    functionCalls: new Map(),
    streamRaw: undefined,
  };
}

function mergeFunctionCallPart(
  state: GeminiSseParserState,
  part: Record<string, unknown>,
): void {
  const fc = part.functionCall;
  if (!isRecord(fc) || typeof fc.name !== "string") {
    return;
  }
  const key = typeof fc.id === "string" && fc.id !== "" ? fc.id : fc.name;
  let acc = state.functionCalls.get(key);
  if (acc == null) {
    acc = {
      name: fc.name,
      argsJson: "",
      id: key,
    };
    state.functionCalls.set(key, acc);
  }
  if (isRecord(fc.args)) {
    acc.argsJson = JSON.stringify(fc.args);
  }
}

function processGeminiResponseChunk(
  state: GeminiSseParserState,
  payload: Record<string, unknown>,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  state.streamRaw = payload;
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return;
  }
  const first = candidates[0];
  if (!isRecord(first)) {
    return;
  }
  const content = first.content;
  if (!isRecord(content) || !Array.isArray(content.parts)) {
    return;
  }

  for (const part of content.parts) {
    if (!isRecord(part)) {
      continue;
    }
    if (typeof part.text === "string" && part.text !== "") {
      if (part.thought === true) {
        state.thinkingParts.push(part.text);
        onStream?.({ type: "thinking-delta", text: part.text });
      } else {
        // Gemini gateways may also embed <thought> / >thought markers in plain text.
        feedInlineThinkingAwareTextDelta(state, part.text, onStream);
      }
    }
    if (part.functionCall != null) {
      mergeFunctionCallPart(state, part);
    }
  }
}

function processGeminiSseLine(
  state: GeminiSseParserState,
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
  processGeminiResponseChunk(state, event, onStream);
}

export function feedGeminiSseChunk(
  state: GeminiSseParserState,
  chunk: string,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    processGeminiSseLine(state, line, onStream);
  }
}

function functionCallsToToolUses(
  state: GeminiSseParserState,
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  const out: Array<{ id: string; name: string; input: Record<string, unknown> }> =
    [];
  for (const acc of state.functionCalls.values()) {
    let input: Record<string, unknown> = {};
    if (acc.argsJson !== "") {
      try {
        input = JSON.parse(acc.argsJson) as Record<string, unknown>;
      } catch {
        input = {};
      }
    }
    out.push({ id: acc.id, name: acc.name, input });
  }
  return out;
}

function emitToolUsesFromAccumulators(
  toolUses: readonly { id: string; name: string; input: Record<string, unknown> }[],
  onStream?: (event: LlmStreamEvent) => void,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const tu of toolUses) {
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

/** Finalize parser state (normal stream end). */
export function finishGeminiSse(
  state: GeminiSseParserState,
  onStream?: (event: LlmStreamEvent) => void,
): {
  blocks: ContentBlock[];
  streamRaw: unknown;
} {
  if (state.buffer !== "") {
    feedGeminiSseChunk(state, "\n", onStream);
  }

  finishInlineThinkingAwareText(state, onStream);
  const cleansed = cleanseReplyTextAndThinking(
    state.textParts.join(""),
    state.thinkingParts.join(""),
  );

  const blocks: ContentBlock[] = [];
  if (cleansed.thinking !== "") {
    blocks.push({ type: "thinking", text: cleansed.thinking });
  }
  if (cleansed.visible !== "") {
    blocks.push({ type: "text", text: cleansed.visible });
  }
  blocks.push(...emitToolUsesFromAccumulators(functionCallsToToolUses(state), onStream));

  if (blocks.length === 0 && state.streamRaw != null) {
    const raw = state.streamRaw as {
      candidates?: Array<{ content?: { parts?: unknown[] } }>;
    };
    const parts = raw.candidates?.[0]?.content?.parts ?? [];
    return { blocks: geminiPartsToBlocks(parts), streamRaw: state.streamRaw };
  }

  return { blocks, streamRaw: state.streamRaw };
}

/** Partial snapshot when the user aborted mid-stream. */
export function finishGeminiSsePartial(
  state: GeminiSseParserState,
  onStream?: (event: LlmStreamEvent) => void,
): {
  blocks: ContentBlock[];
  streamRaw: unknown;
} {
  if (state.buffer !== "") {
    feedGeminiSseChunk(state, "\n", onStream);
  }

  finishInlineThinkingAwareText(state, onStream);
  const cleansed = cleanseReplyTextAndThinking(
    state.textParts.join(""),
    state.thinkingParts.join(""),
  );
  const blocks = buildStreamPartialBlocks(
    {
      text: cleansed.visible,
      thinking: cleansed.thinking,
      toolUses: functionCallsToToolUses(state),
    },
    onStream,
  );

  return {
    blocks,
    streamRaw: state.streamRaw ?? ({ streamed: true, aborted: true } as Record<string, unknown>),
  };
}
