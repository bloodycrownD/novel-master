/**
 * LLM protocol adapter port.
 *
 * @module infra/llm-protocol/adapter.port
 */

import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";

export type LlmProtocolKind = "openai" | "anthropic" | "gemini";

export interface LlmListModelsResult {
  readonly models: ReadonlyArray<{
    readonly vendorModelId: string;
    readonly displayName?: string;
  }>;
}

export interface LlmChatRequest {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly vendorModelId: string;
  readonly userContent: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /** When set, used instead of a single user message built from `userContent`. */
  readonly history?: readonly ChatMessage[];
}

export interface LlmChatResult {
  readonly assistantText: string;
  readonly blocks: readonly ContentBlock[];
  readonly raw: unknown;
}

export interface LlmProtocolAdapter {
  readonly kind: LlmProtocolKind;
  listModels(
    req: Omit<LlmChatRequest, "vendorModelId" | "userContent" | "history">,
  ): Promise<LlmListModelsResult>;
  chat(req: LlmChatRequest): Promise<LlmChatResult>;
}

export type FetchFn = typeof globalThis.fetch;
