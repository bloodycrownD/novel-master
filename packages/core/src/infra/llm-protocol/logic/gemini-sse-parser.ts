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
  emitDirectTextDelta,
  feedInlineThinkingAwareTextDelta,
  finishInlineThinkingAwareText,
} from "./inline-thinking-parser.js";
import { inlineStreamThinkingSplitEnabled } from "./stream-inline-thinking-split-mode.js";
import { buildStreamPartialBlocks } from "./stream-partial-blocks.js";
import { feedSseLines } from "./sse-line-buffer.js";
import {
  assertSseParseSucceededOrThrow,
  recordMalformedSseLine,
  type SseParseDiagnostics,
} from "./sse-parse-errors.js";
import { parseToolArgumentsJson } from "./tool-arguments-parse.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type FunctionCallAccumulator = {
  name: string;
  argsJson: string;
  id: string;
  thinkingSignature?: string;
};

export type GeminiSseParserState = SseParseDiagnostics & {
  buffer: string;
  textParts: string[];
  thinkingParts: string[];
  thinkingSignature?: string;
  functionCalls: Map<string, FunctionCallAccumulator>;
  streamRaw: unknown;
  inlineTextSplitter?: import("./inline-thinking-parser.js").InlineThinkingStreamSplitter;
  emittedFunctionCallKeys: Set<string>;
};

function readThoughtSignature(part: Record<string, unknown>): string | undefined {
  const sig = part.thought_signature ?? part.thoughtSignature;
  return typeof sig === "string" && sig !== "" ? sig : undefined;
}

export function createGeminiSseParserState(): GeminiSseParserState {
  return {
    buffer: "",
    textParts: [],
    thinkingParts: [],
    functionCalls: new Map(),
    streamRaw: undefined,
    malformedLineCount: 0,
    emittedFunctionCallKeys: new Set(),
  };
}

function tryEmitGeminiToolUseIfComplete(
  state: GeminiSseParserState,
  key: string,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  if (state.emittedFunctionCallKeys.has(key)) {
    return;
  }
  const acc = state.functionCalls.get(key);
  if (acc == null || acc.name === "" || acc.argsJson === "") {
    return;
  }
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(acc.argsJson) as Record<string, unknown>;
  } catch {
    return;
  }
  state.emittedFunctionCallKeys.add(key);
  onStream?.({ type: "tool-use", id: acc.id, name: acc.name, input });
}

function mergeFunctionCallPart(
  state: GeminiSseParserState,
  part: Record<string, unknown>,
  onStream?: (event: LlmStreamEvent) => void,
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
    const newJson = JSON.stringify(fc.args);
    if (newJson !== acc.argsJson) {
      acc.argsJson = newJson;
    }
  }
  const sig = readThoughtSignature(part);
  if (sig != null) {
    acc.thinkingSignature = sig;
  }
  tryEmitGeminiToolUseIfComplete(state, key, onStream);
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
        const thoughtSignature = readThoughtSignature(part);
        if (thoughtSignature != null) {
          state.thinkingSignature = thoughtSignature;
        }
      } else {
        // Gemini gateways may also embed <thought> / >thought markers in plain text.
        if (inlineStreamThinkingSplitEnabled()) {
          feedInlineThinkingAwareTextDelta(state, part.text, onStream);
        } else {
          emitDirectTextDelta(state, part.text, onStream);
        }
      }
    } else if (part.thought === true) {
      const thoughtSignature = readThoughtSignature(part);
      if (thoughtSignature != null) {
        state.thinkingSignature = thoughtSignature;
      }
    }
    if (part.functionCall != null) {
      mergeFunctionCallPart(state, part, onStream);
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
    recordMalformedSseLine(state, payload);
    return;
  }
  processGeminiResponseChunk(state, event, onStream);
}

export function feedGeminiSseChunk(
  state: GeminiSseParserState,
  chunk: string,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  feedSseLines(state, chunk, line =>
    processGeminiSseLine(state, line, onStream),
  );
}

function functionCallsToToolUses(
  state: GeminiSseParserState,
  strict = false,
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  const out: Array<{ id: string; name: string; input: Record<string, unknown> }> =
    [];
  for (const acc of state.functionCalls.values()) {
    let input: Record<string, unknown> = {};
    if (acc.argsJson !== "") {
      if (strict) {
        input = parseToolArgumentsJson(acc.argsJson, "gemini");
      } else {
        try {
          input = JSON.parse(acc.argsJson) as Record<string, unknown>;
        } catch {
          input = {};
        }
      }
    }
    out.push({
      id: acc.id,
      name: acc.name,
      input,
      ...(acc.thinkingSignature != null ? { thinkingSignature: acc.thinkingSignature } : {}),
    });
  }
  return out;
}

function emitToolUsesFromAccumulators(
  toolUses: readonly {
    id: string;
    name: string;
    input: Record<string, unknown>;
    thinkingSignature?: string;
  }[],
  onStream?: (event: LlmStreamEvent) => void,
  emittedKeys?: Set<string>,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let signatureEmitted = false;
  for (const tu of toolUses) {
    const thinkingSignature =
      !signatureEmitted && tu.thinkingSignature != null
        ? tu.thinkingSignature
        : undefined;
    if (thinkingSignature != null) {
      signatureEmitted = true;
    }
    blocks.push({
      type: "tool_use",
      id: tu.id,
      name: tu.name,
      input: tu.input,
      ...(thinkingSignature != null ? { thinkingSignature } : {}),
    });
    if (emittedKeys == null || !emittedKeys.has(tu.id)) {
      if (emittedKeys != null) {
        emittedKeys.add(tu.id);
      }
      onStream?.({
        type: "tool-use",
        id: tu.id,
        name: tu.name,
        input: tu.input,
      });
    }
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
  if (cleansed.thinking !== "" || state.thinkingSignature != null) {
    blocks.push({
      type: "thinking",
      text: cleansed.thinking,
      ...(state.thinkingSignature != null
        ? { thinkingSignature: state.thinkingSignature }
        : {}),
    });
  }
  if (cleansed.visible !== "") {
    blocks.push({ type: "text", text: cleansed.visible });
  }
  blocks.push(
    ...emitToolUsesFromAccumulators(
      functionCallsToToolUses(state, true),
      onStream,
      state.emittedFunctionCallKeys,
    ),
  );

  assertSseParseSucceededOrThrow(state, blocks, "gemini");

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
