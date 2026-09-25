/**
 * llm-sse-native 的类型面（native 模块形状 + transport port）。
 *
 * @module llm-sse-native/types
 */

/** LlmSseHeaders 事件载荷：响应头到达（status 已知，流继续）。 */
export interface LlmSseHeadersEvent {
  readonly requestId: string;
  readonly status: number;
  readonly contentType: string | null;
}

/** LlmSseChunk 事件载荷：native 合批（100ms | 64KB 先到者）后的文本批。 */
export interface LlmSseChunkEvent {
  readonly requestId: string;
  readonly text: string;
}

/** LlmSseDone 事件载荷：响应体搬运完毕。 */
export interface LlmSseDoneEvent {
  readonly requestId: string;
}

/** LlmSseError 事件载荷：kind 语义——network 连接/读失败、timeout 读超时/callTimeout、http 状态错误。 */
export interface LlmSseErrorEvent {
  readonly requestId: string;
  readonly kind: "network" | "timeout" | "http";
  readonly message: string;
}

/** native 事件名常量（与 Kotlin 侧 LlmSseModule companion 对齐）。 */
export const LLM_SSE_EVENT_HEADERS = "LlmSseHeaders";
export const LLM_SSE_EVENT_CHUNK = "LlmSseChunk";
export const LLM_SSE_EVENT_DONE = "LlmSseDone";
export const LLM_SSE_EVENT_ERROR = "LlmSseError";

/** native 读超时默认值（毫秒），与 Kotlin 侧一致。 */
export const LLM_SSE_DEFAULT_READ_TIMEOUT_MS = 30_000;
/** native 整调用超时默认值（毫秒），与 Kotlin 侧一致。 */
export const LLM_SSE_DEFAULT_CALL_TIMEOUT_MS = 600_000;

/**
 * 事件订阅抽象：addListener 返回退订函数。
 * 生产实现包 NativeEventEmitter；测试注入 fake 即可直测 wrapper 逻辑。
 */
export interface LlmSseEventSink {
  addListener(name: string, listener: (event: unknown) => void): () => void;
}

/** Kotlin LlmSseNative 模块的 typed 形状（NativeModules interop）。 */
export interface LlmSseNativeModule {
  sseConnect(
    requestId: string,
    url: string,
    headersKv: string[],
    body: string,
    readTimeoutMs: number,
    callTimeoutMs: number,
  ): void;
  sseAbort(requestId: string): void;
  request(
    method: "GET" | "POST",
    url: string,
    headersKv: string[],
    body: string | null,
    callTimeoutMs: number,
  ): Promise<{ status: number; contentType: string | null; body: string }>;
}

/** bridge = native 模块 + 事件通道（transport 的全部环境依赖，测试注入点）。 */
export interface LlmSseNativeBridge extends LlmSseNativeModule {
  readonly events: LlmSseEventSink;
}

/**
 * SSE 传输 port（结构化对齐 spec llm-stream-native §3 的 `SseTransport`）。
 *
 * 本包不依赖 @novel-master/core 运行时——此接口是鸭子类型声明；
 * core 侧 Step 3 落地 `registerSseTransport(transport)` 后按结构兼容直接注册。
 * `opts.nativeTimeouts` 为本包扩展位（core port 不携带时用 native 默认值）。
 */
export interface SseTransport {
  post(
    url: string,
    init: RequestInit,
    onChunk: (chunk: string) => void,
    opts?: {
      providerId?: string;
      signal?: AbortSignal;
      logTag?: string;
      /** native 超时覆盖（毫秒；不传用 native 默认 30s/600s）。 */
      nativeTimeouts?: { readMs?: number; callMs?: number };
    },
  ): Promise<{ status: number; contentType: string | null }>;
}
