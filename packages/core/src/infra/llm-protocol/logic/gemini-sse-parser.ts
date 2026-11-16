/**
 * Incremental Gemini streamGenerateContent SSE parser (`?alt=sse`).
 *
 * @module infra/llm-protocol/logic/gemini-sse-parser
 */

import { isRecord } from "@/common/guards.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { DegradedToolCall, LlmStreamEvent } from "../ports/adapter.port.js";
import { geminiPartsToBlocks } from "./gemini-content-mapper.js";
import { emitDirectTextDelta } from "./inline-thinking-parser.js";
import { buildStreamPartialBlocks } from "./stream-partial-blocks.js";
import { feedSseLines } from "./sse-line-buffer.js";
import { parseSseDataLine } from "./sse-data-line.js";
import { assertSseParseSucceededOrThrow, recordMalformedSseLine, type SseFinishResult, type SseParseDiagnostics } from "./sse-parse-errors.js";
import { tryParseToolArgumentsJson } from "./tool-arguments-parse.js";
import { parseGeminiUsage } from "./usage-parser.js";

type FunctionCallAccumulator = {
  name: string;
  argsJson: string;
  id: string;
  thinkingSignature?: string;
};

type GeminiToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  thinkingSignature?: string;
};

type GeminiSseParserState = SseParseDiagnostics & {
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
 * Feed one UTF-8 text chunk (may split mid-line); emits stream events via `onStream`.
 *
 * Gemini 每个 chunk 是候选块快照：
 * - 每个候选块到达时同步 emit 流中 usage 事件（累计口径；同值不重发）。
 * - 结构化 thought → thinking-delta；非 thought 正文直通 text-delta，不做内嵌标签拆分。
 * - functionCall 用「call id，缺失时函数名 + 同一 chunk 内同名出现序」归并——裸函数名会把
 *   并行的两个同名调用压成一个累加器（argsJson 是覆盖不是累加，最终静默丢调用 + 参数串味）。
 */
export function feedGeminiSseChunk(state: GeminiSseParserState, chunk: string, onStream?: (event: LlmStreamEvent) => void): void {
  feedSseLines(state, chunk, (line) => {
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

    state.streamRaw = event;

    // usage 在 candidates 早退之前 emit：usage-only 收尾块也能发。
    const usage = parseGeminiUsage(event);
    const completionTokens = usage?.completionTokens;
    if (usage != null && completionTokens != null && completionTokens !== state.lastEmittedCompletionTokens) {
      state.lastEmittedCompletionTokens = completionTokens;
      onStream?.({ type: "usage", usage });
    }

    const candidates = event.candidates;
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

    // 同名 functionCall 的 0 基出现序号（**逐 chunk 重置**，见函数顶部注释）。
    const perChunkNameSeq = new Map<string, number>();
    for (const part of content.parts) {
      if (!isRecord(part)) {
        continue;
      }
      const rawSignature = part.thought_signature ?? part.thoughtSignature;
      const thoughtSignature = typeof rawSignature === "string" && rawSignature !== "" ? rawSignature : undefined;
      if (typeof part.text === "string" && part.text !== "") {
        if (part.thought === true) {
          // 结构化 thought → thinking-delta
          state.thinkingParts.push(part.text);
          onStream?.({ type: "thinking-delta", text: part.text });
          if (thoughtSignature != null) {
            state.thinkingSignature = thoughtSignature;
          }
        } else {
          // 非 thought 正文直通 text-delta，不做内嵌标签拆分
          emitDirectTextDelta(state, part.text, onStream);
        }
      } else if (part.thought === true) {
        if (thoughtSignature != null) {
          state.thinkingSignature = thoughtSignature;
        }
      }
      if (part.functionCall != null) {
        const fcName = isRecord(part.functionCall) && typeof part.functionCall.name === "string" ? part.functionCall.name : "";
        const ordinal = perChunkNameSeq.get(fcName) ?? 0;
        perChunkNameSeq.set(fcName, ordinal + 1);

        const fc = part.functionCall;
        if (isRecord(fc) && typeof fc.name === "string") {
          const key = typeof fc.id === "string" && fc.id !== "" ? fc.id : `${fc.name}#${ordinal}`;
          let acc = state.functionCalls.get(key);
          if (acc == null) {
            acc = { name: fc.name, argsJson: "", id: key };
            state.functionCalls.set(key, acc);
          }
          if (isRecord(fc.args)) {
            const newJson = JSON.stringify(fc.args);
            if (newJson !== acc.argsJson) {
              acc.argsJson = newJson;
            }
          }
          if (thoughtSignature != null) {
            acc.thinkingSignature = thoughtSignature;
          }
          // 参数齐了且该 key 未 emit 过 → 发 tool-use 事件。
          if (!state.emittedFunctionCallKeys.has(key) && acc.name !== "" && acc.argsJson !== "") {
            let input: Record<string, unknown> | null = null;
            try {
              input = JSON.parse(acc.argsJson) as Record<string, unknown>;
            } catch {
              input = null;
            }
            if (input != null) {
              state.emittedFunctionCallKeys.add(key);
              onStream?.({ type: "tool-use", id: acc.id, name: acc.name, input });
            }
          }
        }
      }
    }
  });
}

function functionCallsToToolUses(state: GeminiSseParserState, strict = false): { toolUses: GeminiToolUse[]; degradedToolCalls: DegradedToolCall[] } {
  const toolUses: GeminiToolUse[] = [];
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
      ...(acc.thinkingSignature != null ? { thinkingSignature: acc.thinkingSignature } : {}),
    });
  }
  return { toolUses, degradedToolCalls };
}

/** Finalize parser state (normal stream end). */
export function finishGeminiSse(state: GeminiSseParserState, onStream?: (event: LlmStreamEvent) => void): SseFinishResult {
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
      ...(state.thinkingSignature != null ? { thinkingSignature: state.thinkingSignature } : {}),
    });
  }
  if (text !== "") {
    blocks.push({ type: "text", text });
  }
  const { toolUses, degradedToolCalls } = functionCallsToToolUses(state, true);
  let signatureEmitted = false;
  for (const tu of toolUses) {
    const thinkingSignature = !signatureEmitted && tu.thinkingSignature != null ? tu.thinkingSignature : undefined;
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
    if (!state.emittedFunctionCallKeys.has(tu.id)) {
      state.emittedFunctionCallKeys.add(tu.id);
      onStream?.({
        type: "tool-use",
        id: tu.id,
        name: tu.name,
        input: tu.input,
      });
    }
  }

  // 断言失败沿 parser 既有 throw 通道上行（transport catch → reject），不新增构造。
  const asserted = assertSseParseSucceededOrThrow(state, blocks, "gemini");
  if (!asserted.ok) throw asserted.error;

  if (blocks.length === 0 && state.streamRaw != null) {
    const raw = state.streamRaw as { candidates?: Array<{ content?: { parts?: unknown[] } }> };
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
export function finishGeminiSsePartial(state: GeminiSseParserState, onStream?: (event: LlmStreamEvent) => void): SseFinishResult {
  if (state.buffer !== "") {
    feedGeminiSseChunk(state, "\n", onStream);
  }

  const { toolUses } = functionCallsToToolUses(state);
  const partialInput = {
    text: state.textParts.join(""),
    thinking: state.thinkingParts.join(""),
    // 与正常收尾路径（finishGeminiSse）同源：同一份 state.thinkingSignature。
    // 不传它 ⇒ 中断收尾产出的 thinking 块比正常收尾少一个签名，回传时会被 400。
    thinkingSignature: state.thinkingSignature,
    toolUses,
  };
  const blocks = buildStreamPartialBlocks(partialInput, onStream);

  return {
    blocks,
    streamRaw: state.streamRaw ?? ({ streamed: true, aborted: true } as Record<string, unknown>),
    degradedToolCalls: [],
  };
}
