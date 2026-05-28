import type { ChatMessage } from "@/domain/chat/model/message.js";
import type {
  LlmChatResult,
  LlmStreamEvent,
  LlmToolDefinition,
} from "@/infra/llm-protocol/adapter.port.js";

export interface ModelRequestOptions {
  readonly history?: readonly ChatMessage[];
  readonly system?: string;
  readonly tools?: readonly LlmToolDefinition[];
  readonly stream?: boolean;
  readonly onStream?: (event: LlmStreamEvent) => void;
}

/** Sends chat requests via protocol adapters. */
export interface ModelRequestService {
  request(
    applicationModelId: string,
    userContent: string,
    options?: ModelRequestOptions,
  ): Promise<LlmChatResult>;
}
