import type { LlmChatResult } from "@/infra/llm-protocol/adapter.port.js";

export interface ModelRequestService {
  request(
    applicationModelId: string,
    userContent: string,
  ): Promise<LlmChatResult>;
}
