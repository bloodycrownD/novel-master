/**
 * Incremental OpenAI Chat Completions SSE parser.
 *
 * Shared by fetch reader loops and {@link postSse} chunk delivery.
 *
 * @module infra/llm-protocol/logic/openai-sse-parser
 */

import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { LlmStreamEvent } from "../ports/adapter.port.js";
import {
  openAiStreamAccumulatorsToBlocks,
  openAiStreamDeltaToEvents,
} from "./openai-content-mapper.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

/** Mutable accumulator state for one OpenAI SSE response. */
export type OpenAiSseParserState = {
  buffer: string;
  textParts: string[];
  thinkingParts: string[];
  toolCalls: Map<number, ToolCallAccumulator>;
  emittedToolIndices: Set<number>;
  lastEvent: Record<string, unknown> | undefined;
  /** Final chunk with `usage` (often empty `choices`); preferred over last content delta. */
  lastUsageEvent: Record<string, unknown> | undefined;
};

/** Create empty parser state for a new SSE response. */
export function createOpenAiSseParserState(): OpenAiSseParserState {
  return {
    buffer: "",
    textParts: [],
    thinkingParts: [],
    toolCalls: new Map(),
    emittedToolIndices: new Set(),
    lastEvent: undefined,
    lastUsageEvent: undefined,
  };
}

/**
 * Feed one UTF-8 text chunk (may split mid-line); emits stream events via `onStream`.
 */
export function feedOpenAiSseChunk(
  state: OpenAiSseParserState,
  chunk: string,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const payload = line.slice(6).trim();
    if (payload === "" || payload === "[DONE]") {
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    state.lastEvent = event;
    if (isRecord(event.usage)) {
      state.lastUsageEvent = event;
    }
    const choices = event.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      continue;
    }
    const first = choices[0];
    if (!isRecord(first)) {
      continue;
    }
    openAiStreamDeltaToEvents(first.delta, state, onStream);
  }
}

/** Finalize parser state into content blocks and the last raw SSE event. */
export function finishOpenAiSse(
  state: OpenAiSseParserState,
  onStream?: (event: LlmStreamEvent) => void,
): {
  blocks: ContentBlock[];
  streamRaw: unknown;
} {
  if (state.buffer !== "") {
    feedOpenAiSseChunk(state, "\n", onStream);
  }
  return {
    blocks: openAiStreamAccumulatorsToBlocks(state, onStream),
    streamRaw: state.lastUsageEvent ?? state.lastEvent,
  };
}

/** Read a fetch `ReadableStream` body and parse OpenAI SSE incrementally. */
export async function parseOpenAiSseStream(
  body: ReadableStream<Uint8Array>,
  onStream?: (event: LlmStreamEvent) => void,
): Promise<{ blocks: ContentBlock[]; streamRaw: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state = createOpenAiSseParserState();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    feedOpenAiSseChunk(state, decoder.decode(value, { stream: true }), onStream);
  }

  return finishOpenAiSse(state, onStream);
}
