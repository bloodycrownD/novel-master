import type { ModelSamplingParams } from "@/domain/provider/model/model-sampling-params.js";
import type { ModelThinkingParams } from "@/domain/provider/model/model-thinking-params.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { ChatMessageData } from "@/domain/chat/model/message.js";
import type {
  LlmChatResult,
  LlmStreamEvent,
  LlmToolDefinition,
} from "@/infra/llm-protocol/ports/adapter.port.js";

export interface ModelRequestOptions {
  readonly history?: readonly ChatMessageData[];
  /** Full session messages (including hidden) for Gemini tool_use id → name resolution. */
  readonly toolUseLookupMessages?: readonly ChatMessageData[];
  readonly system?: string;
  readonly tools?: readonly LlmToolDefinition[];
  readonly stream?: boolean;
  readonly onStream?: (event: LlmStreamEvent) => void;
  readonly sampling?: ModelSamplingParams;
  /** 覆盖已保存模型的思考参数。 */
  readonly thinking?: ModelThinkingParams;
  /** Forwarded to provider adapter transport for explicit cancellation. */
  readonly signal?: AbortSignal;
}

/** Sends chat requests via protocol adapters. */
export interface ModelRequestService {
  /**
   * 已知失败走返回值（五期门⑦）：预检失败（模型未保存 / 服务商不存在 / API key
   * 未设 / retry policy 读取失败）收 `Result.err`；传输层错误与取消仍抛
   * （llm-protocol ProviderError 协议：retry 按 catch + code 分派）。
   */
  request(
    savedModelId: string,
    userContent: string,
    options?: ModelRequestOptions
  ): Promise<Result<LlmChatResult, AppError>>;
}
