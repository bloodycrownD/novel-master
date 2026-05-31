import type { ModelSamplingParams } from "@/domain/provider/model/model-sampling-params.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type {
  LlmChatResult,
  LlmStreamEvent,
  LlmToolDefinition,
} from "@/infra/llm-protocol/ports/adapter.port.js";

export interface ModelRequestOptions {
  readonly history?: readonly ChatMessage[];
  readonly system?: string;
  readonly tools?: readonly LlmToolDefinition[];
  readonly stream?: boolean;
  readonly onStream?: (event: LlmStreamEvent) => void;
  readonly sampling?: ModelSamplingParams;
}

/** Sends chat requests via protocol adapters. */
export interface ModelRequestService {
  request(
    applicationModelId: string,
    userContent: string,
    options?: ModelRequestOptions,
  ): Promise<LlmChatResult>;
}
