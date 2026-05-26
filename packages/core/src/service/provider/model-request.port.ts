import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { LlmChatResult } from "@/infra/llm-protocol/adapter.port.js";

export interface ModelRequestOptions {
  readonly history?: readonly ChatMessage[];
}

export interface ModelRequestService {
  request(
    applicationModelId: string,
    userContent: string,
    options?: ModelRequestOptions,
  ): Promise<LlmChatResult>;
}
