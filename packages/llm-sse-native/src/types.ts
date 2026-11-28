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

/** LlmSseChunk 事件载荷：native 合批（100ms | 64K 字符先到者，阈值按 UTF-16 字符计）后的文本批。 */
export interface LlmSseChunkEvent {
    readonly requestId: string;
    readonly text: string;
}

/** LlmSseDone 事件载荷：响应体搬运完毕。 */
export interface LlmSseDoneEvent {
    readonly requestId: string;
}

/** LlmSseError 事件载荷：kind 语义——network 连接/读失败、timeout callTimeout（读超时已退役，仅防御性文案路径）、http 状态错误。 */
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

/**
 * 已退役的 native 读超时默认值（毫秒）：流式流体现在不设空闲界（client 级
 * 读超时恒禁用），Kotlin 侧保留常量与 `sseConnect` 的 `readTimeoutMs` 参数
 * 仅为 JS 接口兼容，该值至多落进一条正常不可达的 SocketTimeoutException 文案。
 *
 * @deprecated 读超时已退役（恒禁用）；整调用预算也已移除，流式没有任何自动超时。
 
 */
export const LLM_SSE_DEFAULT_READ_TIMEOUT_MS = 30_000;
/**
 * native 整调用超时默认值（毫秒），与 Kotlin 侧一致。0 = 不设预算：整调用预算已移除
 * （2026-11-28），流式没有任何自动超时，挂死的连接由用户手动 abort。
 */
export const LLM_SSE_DEFAULT_CALL_TIMEOUT_MS = 0;

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
    /**
   * 非流式请求-响应。`requestId` 只是取消路由键（JS 侧生成，与流式路径的
   * requestId 各自独立命名空间），不影响请求/响应内容。`headers` 是键名小写
   * 的全头表（spec mcp-support Step 6）；旧 APK 构建缺该字段，消费方按空对象
   * 处理并以 `contentType` 兜底 content-type。
   */
    request(
        requestId: string,
        method: "GET" | "POST",
        url: string,
        headersKv: string[],
        body: string | null,
        callTimeoutMs: number,
    ): Promise<{ status: number; contentType: string | null; body: string; headers: Record<string, string> }>;
    /**
   * 取消进行中的 `request`：native 侧 `Call.cancel()` 真断连，原 promise 以
   * `code: "abort"` reject；`requestId` 不存在（已结束/从未发起）静默 no-op。
   */
    requestAbort(requestId: string): void;
}

/**
 * bridge = 流式所需的 native 方法面 + 事件通道（transport 的全部环境依赖，测试注入点）。
 * 只含 sseConnect/sseAbort：流式取消走 sseAbort；request/requestAbort 是非流式 shim 的
 * 方法面，由 apps/mobile setup-llm-fetch 自行探测退化，不属于流式 bridge 概念
 * （2026-11-22 真机实锤：旧 APK 三方法面 × 新 JS 四方法探测 → requestAbort 缺失
 * → 流式永不接管全走 XHR 黑盒，探测自己不用的方法拒绝了整个接管）。
 */
export type LlmSseNativeBridge = Pick<LlmSseNativeModule, "sseConnect" | "sseAbort"> & {
    readonly events: LlmSseEventSink;
};

/**
 * SSE 传输 port（结构化对齐 spec llm-stream-native §3 的 `SseTransport`）。
 *
 * 本包不依赖 @novel-master/core 运行时——此接口是鸭子类型声明；
 * core 侧 Step 3 落地 `registerSseTransport(transport)` 后按结构兼容直接注册。
 * `opts.wholeCallTimeoutMs` 与 `opts.nativeTimeouts.callMs` 为可选的整调用预算：
 * core 不下发，缺省不设上限。
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
            /**
       * 可选的整调用预算（毫秒）。core 不下发；显式传正值时覆盖 nativeTimeouts.callMs；
       * 缺省传 -1（Kotlin 侧 = 不设预算）。
       */
            wholeCallTimeoutMs?: number;
            /**
       * native 超时覆盖（毫秒；不传 = 不设）。
       * `callMs` 为整调用预算（缺省不设）；`readMs` 已退役——读超时恒禁用，
       * 仅保留接口兼容与错误文案位（同 Kotlin `sseConnect` 的入参）。
       */
            nativeTimeouts?: { readMs?: number; callMs?: number };
        },
    ): Promise<{ status: number; contentType: string | null }>;
}
