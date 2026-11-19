/**
 * LLM 协议层出口：协议端口类型、适配器注册、fetch 调试、SSE transport
 * 与请求取消判定（public-surface-ownership 层 A 直映出口）。
 *
 * @module infra/llm-protocol
 */

export type {
  LlmProtocolKind,
  LlmToolDefinition,
  LlmStreamEvent,
  LlmTokenUsage,
  LlmChatResult,
} from "./ports/adapter.port.js";
export { ToolDefinitions } from "./logic/tool-definitions.js";
export { Registry } from "./logic/registry.js";
export { DebugFetch } from "./logic/debug-fetch.js";
export { LlmSseTransport, type SseTransport } from "./logic/llm-sse-transport.js";
export { RequestAbort } from "./logic/request-abort.js";
