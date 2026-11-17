/**
 * Incremental OpenAI Chat Completions SSE parser.
 *
 * Shared by fetch reader loops and {@link postSse} chunk delivery.
 * State 收在 {@link createOpenAiSseParser} 闭包里，同名动词归位到对象方法。
 *
 * @module infra/llm-protocol/logic/openai-sse-parser
 */

import { Guards } from "@/common/guards.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { LlmStreamEvent } from "../ports/adapter.port.js";
import { openAiStreamAccumulatorsToBlocks, openAiStreamAccumulatorsToPartialBlocks, openAiStreamDeltaToEvents } from "./openai-content-mapper.js";
import { feedSseJsonEvents } from "./sse-json-events.js";
import { assertSseParseSucceededOrThrow, type SseFinishResult, type SseParseDiagnostics } from "./sse-parse-errors.js";

type ToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

/** 单条流的累加器（工厂闭包持有；诊断字段与白盒测试可见）。 */
export type OpenAiSseParserState = SseParseDiagnostics & {
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

export type OpenAiSseParser = {
  readonly state: OpenAiSseParserState;
  readonly feed: (chunk: string) => void;
  readonly finish: () => SseFinishResult;
  readonly finishPartial: () => SseFinishResult;
};

/** 创建一个单流 OpenAI SSE parser；`state` 持有本次流的全部累加器。 */
export function createOpenAiSseParser(options: OpenAiSseParserOptions = {}): OpenAiSseParser {
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
    feedSseJsonEvents(state, chunk, (event) => {
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
      openAiStreamDeltaToEvents(first.delta, state, onStream);
    });
  };

  const finish = (): SseFinishResult => {
    if (state.buffer !== "") {
      feed("\n");
    }
    const { blocks, degradedToolCalls } = openAiStreamAccumulatorsToBlocks(state, onStream);
    // 断言失败沿 parser 既有 throw 通道上行（transport catch → reject），不新增构造。
    const asserted = assertSseParseSucceededOrThrow(state, blocks, "openai");
    if (!asserted.ok) throw asserted.error;
    return {
      blocks,
      streamRaw: state.lastUsageEvent ?? state.lastEvent,
      degradedToolCalls,
    };
  };

  /** Abort 快照：宽松解析已累积参数、不 assert、也不 drain 缓冲（与既有 adapter 行为一致）。 */
  const finishPartial = (): SseFinishResult => {
    const blocks = openAiStreamAccumulatorsToPartialBlocks(state, onStream);
    return {
      blocks,
      streamRaw: state.lastUsageEvent ?? state.lastEvent ?? ({ streamed: true, aborted: true } as Record<string, unknown>),
      degradedToolCalls: [],
    };
  };

  return { state, feed, finish, finishPartial };
}

/** Read a fetch `ReadableStream` body and parse OpenAI SSE incrementally. */
export async function parseOpenAiSseStream(body: ReadableStream<Uint8Array>, onStream?: (event: LlmStreamEvent) => void): Promise<{ blocks: ContentBlock[]; streamRaw: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createOpenAiSseParser({ onStream });

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parser.feed(decoder.decode(value, { stream: true }));
  }

  return parser.finish();
}
