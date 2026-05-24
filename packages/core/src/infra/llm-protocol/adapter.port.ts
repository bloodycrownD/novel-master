/**
 * LLM protocol adapter port.
 *
 * @module infra/llm-protocol/adapter.port
 */

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
}

export interface LlmChatResult {
  readonly assistantText: string;
  readonly raw: unknown;
}

export interface LlmProtocolAdapter {
  readonly kind: LlmProtocolKind;
  listModels(
    req: Omit<LlmChatRequest, "vendorModelId" | "userContent">,
  ): Promise<LlmListModelsResult>;
  chat(req: LlmChatRequest): Promise<LlmChatResult>;
}

export type FetchFn = typeof globalThis.fetch;
