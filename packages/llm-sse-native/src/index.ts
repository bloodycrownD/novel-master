/**
 * llm-sse-native 环境无关入口（不含 react-native import，Node/桌面可安全加载）。
 *
 * @module llm-sse-native
 * @remarks RN / Metro 装配请 import `@novel-master/llm-sse-native/native`
 * （静态绑定 NativeModules + NativeEventEmitter；漏配该子路径会直接解析失败）。
 */

export type {
  LlmSseChunkEvent,
  LlmSseDoneEvent,
  LlmSseErrorEvent,
  LlmSseEventSink,
  LlmSseHeadersEvent,
  LlmSseNativeBridge,
  LlmSseNativeModule,
  SseTransport,
} from "./types.js";
export {
  LLM_SSE_DEFAULT_CALL_TIMEOUT_MS,
  LLM_SSE_DEFAULT_READ_TIMEOUT_MS,
  LLM_SSE_EVENT_CHUNK,
  LLM_SSE_EVENT_DONE,
  LLM_SSE_EVENT_ERROR,
  LLM_SSE_EVENT_HEADERS,
} from "./types.js";
export {
  NativeSseAbortError,
  NativeSseTransportError,
  createNativeSseTransportFromBridge,
  flattenRequestHeaders,
} from "./transport.js";
