/**
 * Incremental Gemini streamGenerateContent SSE parser (`?alt=sse`).
 *
 * @module infra/llm-protocol/logic/gemini-sse-parser
 */

import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type {
  DegradedToolCall,
  LlmStreamEvent,
} from "../ports/adapter.port.js";
import { geminiPartsToBlocks } from "./gemini-content-mapper.js";
import { emitDirectTextDelta } from "./inline-thinking-parser.js";
import { buildStreamPartialBlocks } from "./stream-partial-blocks.js";
import { feedSseLines } from "./sse-line-buffer.js";
import { parseSseDataLine } from "./sse-data-line.js";
import {
  assertSseParseSucceededOrThrow,
  recordMalformedSseLine,
  type SseParseDiagnostics,
} from "./sse-parse-errors.js";
import { tryParseToolArgumentsJson } from "./tool-arguments-parse.js";
import { parseGeminiUsage } from "./usage-parser.js";

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
  emittedFunctionCallKeys: Set<string>;
  /** 上一次 usage 事件 emit 的输出侧累计值（值不变不重发；undefined = 尚未 emit）。 */
  lastEmittedCompletionTokens: number | undefined;
};

function readThoughtSignature(
  part: Record<string, unknown>
): string | undefined {
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
    lastEmittedCompletionTokens: undefined,
  };
}

/**
 * 每个候选块到达时同步 emit 流中 usage 事件（usageMetadata.candidatesTokenCount
 * 累计口径）。放在 `streamRaw` 覆盖存储点、candidates 早退之前——无候选内容的
 * 块（如 usage-only 收尾块）也能 emit。累计值与上次 emit 相同（或缺失）时不发；
 * 协议层不节流，每块必变的量由上层合批/节流吸收。
 */
function emitGeminiUsage(
  state: GeminiSseParserState,
  payload: Record<string, unknown>,
  onStream?: (event: LlmStreamEvent) => void
): void {
  const usage = parseGeminiUsage(payload);
  const completionTokens = usage?.completionTokens;
  if (
    usage == null ||
    completionTokens == null ||
    completionTokens === state.lastEmittedCompletionTokens
  ) {
    return;
  }
  state.lastEmittedCompletionTokens = completionTokens;
  onStream?.({ type: "usage", usage });
}

function tryEmitGeminiToolUseIfComplete(
  state: GeminiSseParserState,
  key: string,
  onStream?: (event: LlmStreamEvent) => void
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

/**
 * `mergeFunctionCallPart` 的归并键。
 *
 * `functionCall.id` 缺席时（Gemini 明确允许省略）用「函数名 + 同一 chunk 内同名出现序」
 * 而不是裸函数名——裸名字会把**并行的两个同名调用压成一个累加器**，而
 * `argsJson` 分支是赋值不是累加 ⇒ 第二个 chunk 的 args 整体覆盖第一个，
 * `blocks` 最终只剩一条 `tool_use`、携带最后一次调用的参数（工具调用静默丢失 + 参数串味）。
 *
 * 为什么「chunk 内序号」是稳定的：SSE 的增量语义是「每个 chunk 携带当前完整的
 * parts 快照」，一个持续增长的调用在后续 chunk 里出现在同一 part 位置、同名序号不变
 * ⇒ key 稳定、argsJson 继续被同一条累加器更新；而并行的第二个同名调用占另一个序号。
 *
 * ⚠️ 已知边界（R1）：若供应商真按「只带新增 part」的增量形态发，且两个同名调用**分处两个
 * chunk**，两者序号都是 0 ⇒ 仍会塌缩。届时需改用全局序号 + part 位置。
 */
function functionCallMergeKey(
  fc: Record<string, unknown>,
  ordinal: number
): string {
  return typeof fc.id === "string" && fc.id !== "" ? fc.id : `${fc.name}#${ordinal}`;
}

function mergeFunctionCallPart(
  state: GeminiSseParserState,
  part: Record<string, unknown>,
  ordinal: number,
  onStream?: (event: LlmStreamEvent) => void
): void {
  const fc = part.functionCall;
  if (!isRecord(fc) || typeof fc.name !== "string") {
    return;
  }
  const key = functionCallMergeKey(fc, ordinal);
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
  onStream?: (event: LlmStreamEvent) => void
): void {
  state.streamRaw = payload;
  emitGeminiUsage(state, payload, onStream);
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

  // 同名 functionCall 的 0 基出现序号（**逐 chunk 重置**，见 functionCallMergeKey 注释）
  const perChunkNameSeq = new Map<string, number>();
  for (const part of content.parts) {
    if (!isRecord(part)) {
      continue;
    }
    if (typeof part.text === "string" && part.text !== "") {
      if (part.thought === true) {
        // 结构化 thought → thinking-delta
        state.thinkingParts.push(part.text);
        onStream?.({ type: "thinking-delta", text: part.text });
        const thoughtSignature = readThoughtSignature(part);
        if (thoughtSignature != null) {
          state.thinkingSignature = thoughtSignature;
        }
      } else {
        // 非 thought 正文直通 text-delta，不做内嵌标签拆分
        emitDirectTextDelta(state, part.text, onStream);
      }
    } else if (part.thought === true) {
      const thoughtSignature = readThoughtSignature(part);
      if (thoughtSignature != null) {
        state.thinkingSignature = thoughtSignature;
      }
    }
    if (part.functionCall != null) {
      const fcName =
        isRecord(part.functionCall) && typeof part.functionCall.name === "string"
          ? part.functionCall.name
          : "";
      const ordinal = perChunkNameSeq.get(fcName) ?? 0;
      perChunkNameSeq.set(fcName, ordinal + 1);
      mergeFunctionCallPart(state, part, ordinal, onStream);
    }
  }
}

function processGeminiSseLine(
  state: GeminiSseParserState,
  line: string,
  onStream?: (event: LlmStreamEvent) => void
): void {
  const payload = parseSseDataLine(line);
  if (payload == null) {
    return;
  }
  if (payload === "[DONE]") {
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
  onStream?: (event: LlmStreamEvent) => void
): void {
  feedSseLines(state, chunk, (line) =>
    processGeminiSseLine(state, line, onStream)
  );
}

function functionCallsToToolUses(
  state: GeminiSseParserState,
  strict = false
): {
  toolUses: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    thinkingSignature?: string;
  }>;
  degradedToolCalls: DegradedToolCall[];
} {
  const toolUses: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    thinkingSignature?: string;
  }> = [];
  const degradedToolCalls: DegradedToolCall[] = [];
  for (const acc of state.functionCalls.values()) {
    let input: Record<string, unknown> = {};
    if (acc.argsJson !== "") {
      if (strict) {
        const parsed = tryParseToolArgumentsJson(acc.argsJson);
        if (parsed.ok) {
          input = parsed.value;
        } else {
          degradedToolCalls.push({
            id: acc.id,
            name: acc.name,
            rawArguments: parsed.raw,
            reason: "INVALID_TOOL_ARGUMENTS",
          });
        }
      } else {
        try {
          input = JSON.parse(acc.argsJson) as Record<string, unknown>;
        } catch {
          input = {};
        }
      }
    }
    toolUses.push({
      id: acc.id,
      name: acc.name,
      input,
      ...(acc.thinkingSignature != null
        ? { thinkingSignature: acc.thinkingSignature }
        : {}),
    });
  }
  return { toolUses, degradedToolCalls };
}

function emitToolUsesFromAccumulators(
  toolUses: readonly {
    id: string;
    name: string;
    input: Record<string, unknown>;
    thinkingSignature?: string;
  }[],
  onStream?: (event: LlmStreamEvent) => void,
  emittedKeys?: Set<string>
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
  onStream?: (event: LlmStreamEvent) => void
): {
  blocks: ContentBlock[];
  streamRaw: unknown;
  degradedToolCalls: DegradedToolCall[];
} {
  if (state.buffer !== "") {
    feedGeminiSseChunk(state, "\n", onStream);
  }

  const text = state.textParts.join("");
  const thinking = state.thinkingParts.join("");

  const blocks: ContentBlock[] = [];
  if (thinking !== "" || state.thinkingSignature != null) {
    blocks.push({
      type: "thinking",
      text: thinking,
      ...(state.thinkingSignature != null
        ? { thinkingSignature: state.thinkingSignature }
        : {}),
    });
  }
  if (text !== "") {
    blocks.push({ type: "text", text });
  }
  const { toolUses, degradedToolCalls } = functionCallsToToolUses(state, true);
  blocks.push(
    ...emitToolUsesFromAccumulators(
      toolUses,
      onStream,
      state.emittedFunctionCallKeys
    )
  );

  assertSseParseSucceededOrThrow(state, blocks, "gemini");

  if (blocks.length === 0 && state.streamRaw != null) {
    const raw = state.streamRaw as {
      candidates?: Array<{ content?: { parts?: unknown[] } }>;
    };
    const parts = raw.candidates?.[0]?.content?.parts ?? [];
    return {
      blocks: geminiPartsToBlocks(parts),
      streamRaw: state.streamRaw,
      degradedToolCalls,
    };
  }

  return { blocks, streamRaw: state.streamRaw, degradedToolCalls };
}

/** Partial snapshot when the user aborted mid-stream. */
export function finishGeminiSsePartial(
  state: GeminiSseParserState,
  onStream?: (event: LlmStreamEvent) => void
): {
  blocks: ContentBlock[];
  streamRaw: unknown;
  degradedToolCalls: DegradedToolCall[];
} {
  if (state.buffer !== "") {
    feedGeminiSseChunk(state, "\n", onStream);
  }

  const { toolUses } = functionCallsToToolUses(state);
  const blocks = buildStreamPartialBlocks(
    {
      text: state.textParts.join(""),
      thinking: state.thinkingParts.join(""),
      // 与正常收尾路径（finishGeminiSse）同源：同一份 state.thinkingSignature。
      // 不传它 ⇒ 中断收尾产出的 thinking 块比正常收尾少一个签名，回传时会被 400。
      thinkingSignature: state.thinkingSignature,
      toolUses,
    },
    onStream
  );

  return {
    blocks,
    streamRaw:
      state.streamRaw ??
      ({ streamed: true, aborted: true } as Record<string, unknown>),
    degradedToolCalls: [],
  };
}
