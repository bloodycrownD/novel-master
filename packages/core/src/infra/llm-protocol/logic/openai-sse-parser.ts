/**
 * Incremental OpenAI Chat Completions SSE parser.
 *
 * Shared by fetch reader loops and {@link LlmSseTransport.post} chunk delivery.
 * State 收在 {@link OpenAiSseParser.create} 闭包里，同名动词归位到对象方法。
 *
 * @module infra/llm-protocol/logic/openai-sse-parser
 */

import { Guards } from "@/common/guards.js";
import type { LlmStreamEvent } from "../ports/adapter.port.js";
import { OpenAiMapper } from "./openai-content-mapper.js";
import { SseJsonEvents } from "./sse-json-events.js";
import { SseLineBuffer } from "./sse-line-buffer.js";
import { SseParseErrors, type SseFinishResult, type SseParseDiagnostics } from "./sse-parse-errors.js";

type ToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

/** 单条流的累加器（工厂闭包持有；诊断字段与白盒测试可见）。 */
type OpenAiSseParserState = SseParseDiagnostics & {
  buffer: string;
  textParts: string[];
  thinkingParts: string[];
  toolCalls: Map<number, ToolCallAccumulator>;
  emittedToolIndices: Set<number>;
  lastEvent: Record<string, unknown> | undefined;
  /** Final chunk with `usage` (often empty `choices`); preferred over last content delta. */
  lastUsageEvent: Record<string, unknown> | undefined;
};

export type OpenAiSseParserOptions = {
  readonly onStream?: (event: LlmStreamEvent) => void;
};

type OpenAiSseParserHandle = {
  readonly state: OpenAiSseParserState;
  readonly feed: (chunk: string) => void;
  readonly finish: () => SseFinishResult;
  readonly finishPartial: () => SseFinishResult;
};

export const OpenAiSseParser = {
  /** 创建一个单流 OpenAI SSE parser；`state` 持有本次流的全部累加器。 */
  create(options: OpenAiSseParserOptions = {}): OpenAiSseParserHandle {
    const onStream = options.onStream;
    const state: OpenAiSseParserState = {
      buffer: "",
      textParts: [],
      thinkingParts: [],
      toolCalls: new Map(),
      emittedToolIndices: new Set(),
      lastEvent: undefined,
      lastUsageEvent: undefined,
      malformedLineCount: 0,
    };

    const feed = (chunk: string): void => {
      SseJsonEvents.feed(state, chunk, (event) => {
        state.lastEvent = event;
        if (Guards.isRecord(event.usage)) {
          state.lastUsageEvent = event;
        }
        const choices = event.choices;
        if (!Array.isArray(choices) || choices.length === 0) {
          return;
        }
        const first = choices[0];
        if (!Guards.isRecord(first)) {
          return;
        }
        OpenAiMapper.streamDeltaToEvents(first.delta, state, onStream);
      });
    };

    const finish = (): SseFinishResult => {
      SseLineBuffer.drain(state, feed);
      const { blocks, degradedToolCalls } = OpenAiMapper.streamAccumulatorsToBlocks(state, onStream);
      // nm-throw: keep — 断言失败沿 parser 既有 throw 通道上行（transport catch → reject），不新增构造。
      const asserted = SseParseErrors.assertSucceededOrThrow(state, blocks, "openai");
      // nm-throw: keep — parser 既有 throw 通道上行（transport catch → reject）。
      if (!asserted.ok) throw asserted.error;
      return {
        blocks,
        streamRaw: state.lastUsageEvent ?? state.lastEvent,
        degradedToolCalls,
      };
    };

    /** Abort 快照：宽松解析已累积参数、不 assert；先冲刷尾部残行，与 anthropic/gemini 的中断收尾一致。 */
    const finishPartial = (): SseFinishResult => {
      SseLineBuffer.drain(state, feed);
      const blocks = OpenAiMapper.streamAccumulatorsToPartialBlocks(state, onStream);
      return {
        blocks,
        streamRaw: state.lastUsageEvent ?? state.lastEvent ?? ({ streamed: true, aborted: true } as Record<string, unknown>),
        degradedToolCalls: [],
      };
    };

    return { state, feed, finish, finishPartial };
  },
} as const;
