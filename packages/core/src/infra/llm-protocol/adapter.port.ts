/**
 * LLM protocol adapter port.
 *
 * @module infra/llm-protocol/adapter.port
 */

import type { ModelSamplingParams } from "@/domain/agent/model/model-sampling-params.js";
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
  readonly system?: string;
  readonly tools?: readonly LlmToolDefinition[];
  readonly stream?: boolean;
  readonly onStream?: (event: LlmStreamEvent) => void;
  readonly sampling?: ModelSamplingParams;
}

export interface LlmChatResult {
  readonly assistantText: string;
  readonly blocks: readonly ContentBlock[];
  readonly raw: unknown;
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
