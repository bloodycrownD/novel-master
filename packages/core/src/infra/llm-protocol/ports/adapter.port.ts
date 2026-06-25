/**
 * LLM protocol adapter port.
 *
 * @module infra/llm-protocol/ports/adapter.port
 */

import type { ModelSamplingParams } from "@/domain/provider/model/model-sampling-params.js";
import type { ModelThinkingParams } from "@/domain/provider/model/model-thinking-params.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";

export type LlmProtocolKind = "openai" | "anthropic" | "gemini";

export interface LlmListModelsResult {
  readonly models: ReadonlyArray<{
    readonly vendorModelId: string;
    readonly displayName?: string;
  }>;
}

export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export type LlmStreamEvent =
  | { readonly type: "text-delta"; readonly text: string }
  | { readonly type: "thinking-delta"; readonly text: string }
  | {
      /**
       * 流式对话中，当某次 tool call 的 input 对象已完整且 JSON 解析成功时 emit，
       * 每种协议每个 tool call 至多一次。Anthropic 在 content block 结束；
       * OpenAI/Gemini 在 arguments 字符串首次成为合法 JSON 时。
       * Stream 正常结束前可能已收到 `tool-use`；`done` 事件仍携带完整 `blocks`。
       */
      readonly type: "tool-use";
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }
  | { readonly type: "done"; readonly result: LlmChatResult };

export interface LlmChatRequest {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly vendorModelId: string;
  readonly userContent: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /** When set, used instead of a single user message built from `userContent`. */
  readonly history?: readonly ChatMessage[];
  /** Full session messages (including hidden) for Gemini tool_use id → name resolution. */
  readonly toolUseLookupMessages?: readonly ChatMessage[];
  readonly system?: string;
  readonly tools?: readonly LlmToolDefinition[];
  readonly stream?: boolean;
  readonly onStream?: (event: LlmStreamEvent) => void;
  readonly sampling?: ModelSamplingParams;
  /** 协议级思考参数；关闭或未传时 adapter 不写 wire 字段。 */
  readonly thinking?: ModelThinkingParams;
  /** Cancels network IO and stream reads when run is terminated. */
  readonly signal?: AbortSignal;
}

/** Normalized token usage from provider responses. */
export interface LlmTokenUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface LlmChatResult {
  readonly assistantText: string;
  readonly blocks: readonly ContentBlock[];
  readonly raw: unknown;
  readonly usage?: LlmTokenUsage;
}

export interface LlmProtocolAdapter {
  readonly kind: LlmProtocolKind;
  listModels(
    req: Omit<
      LlmChatRequest,
      | "vendorModelId"
      | "userContent"
      | "history"
      | "system"
      | "tools"
      | "stream"
      | "onStream"
    >,
  ): Promise<LlmListModelsResult>;
  chat(req: LlmChatRequest): Promise<LlmChatResult>;
}

export type FetchFn = typeof globalThis.fetch;
