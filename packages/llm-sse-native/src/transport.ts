/**
 * transport 纯逻辑：requestId 匹配、native 事件 → port 回调分发。
 *
 * @module llm-sse-native/transport
 * @remarks 环境无关（不 import react-native）：bridge 由入口注入，
 * 包内 `tsx --test` 直测即覆盖全部分发/匹配/错误映射逻辑。
 */

import {
  LLM_SSE_EVENT_CHUNK,
  LLM_SSE_EVENT_DONE,
  LLM_SSE_EVENT_ERROR,
  LLM_SSE_EVENT_HEADERS,
  type LlmSseChunkEvent,
  type LlmSseDoneEvent,
  type LlmSseErrorEvent,
  type LlmSseHeadersEvent,
  type LlmSseNativeBridge,
  type SseTransport,
} from "./types.js";

/** native 失败经 wrapper 上抛的错误：kind 语义与 LlmSseError 事件一致（core 侧映射 LlmStreamTimeoutError 用）。 */
export class NativeSseTransportError extends Error {
  readonly kind: "network" | "timeout" | "http";
  readonly requestId: string;
  readonly httpStatus: number | null;

  constructor(
    kind: "network" | "timeout" | "http",
    message: string,
    requestId: string,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "NativeSseTransportError";
    this.kind = kind;
    this.requestId = requestId;
    this.httpStatus = httpStatus;
  }
}

/** 主动 abort 经 wrapper 上抛的错误：name "AbortError" 让 core 的 abort 判定（isAbortLikeError）认出。 */
export class NativeSseAbortError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super("Aborted");
    this.name = "AbortError";
    this.requestId = requestId;
  }
}

/** 单个进行中流的路由状态。 */
interface StreamRoutes {
  onHeaders(event: LlmSseHeadersEvent): void;
  onChunk(event: LlmSseChunkEvent): void;
  onDone(event: LlmSseDoneEvent): void;
  onError(event: LlmSseErrorEvent): void;
}

let nextRequestId = 1;

/** init.headers 的三种 RequestInit 形态（无 DOM lib 环境下显式声明）。 */
export type RequestHeadersLike =
  | Headers
  | string[][]
  | Record<string, string>;

/** init.headers（Headers | string[][] | Record）→ 扁平 ["k","v",...] 数组（native 侧成对消费）。 */
export function flattenRequestHeaders(
  headers: RequestHeadersLike | undefined,
): string[] {
  if (headers == null) {
    return [];
  }
  const flat: string[] = [];
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (Array.isArray(pair)) {
        flat.push(String(pair[0]), String(pair[1]));
      }
      // HeadersInit 的数组形态只会是 [string, string][]，无裸字符串元素
    }
    return flat;
  }
  if (typeof headers === "object" && typeof (headers as Headers).forEach === "function") {
    (headers as Headers).forEach((value, name) => {
      flat.push(name, value);
    });
    return flat;
  }
  for (const [name, value] of Object.entries(headers as Record<string, string>)) {
    flat.push(name, value);
  }
  return flat;
}

/**
 * 从注入的 bridge 构建 SseTransport：订阅一次共享事件流，按 requestId 路由到各请求。
 * settle 语义对齐 core XHR 分支——promise 在流结束时 settle：2xx resolve
 * `{status, contentType}`；非 2xx 收完错误 body 后 reject（kind "http" + body 摘要）。
 */
export function createNativeSseTransportFromBridge(
  bridge: LlmSseNativeBridge,
): SseTransport {
  /** requestId → 路由表（settle 或 abort 后移除，后续事件按未知 id 丢弃）。 */
  const routes = new Map<string, StreamRoutes>();

  bridge.events.addListener(LLM_SSE_EVENT_HEADERS, (event) => {
    const parsed = parseHeadersEvent(event);
    if (parsed != null) {
      routes.get(parsed.requestId)?.onHeaders(parsed);
    }
  });
  bridge.events.addListener(LLM_SSE_EVENT_CHUNK, (event) => {
    const parsed = parseChunkEvent(event);
    if (parsed != null) {
      routes.get(parsed.requestId)?.onChunk(parsed);
    }
  });
  bridge.events.addListener(LLM_SSE_EVENT_DONE, (event) => {
    const parsed = parseDoneEvent(event);
    if (parsed != null) {
      routes.get(parsed.requestId)?.onDone(parsed);
    }
  });
  bridge.events.addListener(LLM_SSE_EVENT_ERROR, (event) => {
    const parsed = parseErrorEvent(event);
    if (parsed != null) {
      routes.get(parsed.requestId)?.onError(parsed);
    }
  });

  return {
    post(url, init, onChunk, opts) {
      const requestId = `llm-sse-${nextRequestId++}`;
      const headersKv = flattenRequestHeaders(init.headers);
      const body = init.body == null ? "" : String(init.body);
      const timeouts = opts?.nativeTimeouts;
      const readTimeoutMs = timeouts?.readMs ?? -1;
      const callTimeoutMs = timeouts?.callMs ?? -1;
      const signal = opts?.signal ?? init.signal;

      return new Promise<{ status: number; contentType: string | null }>(
        (resolve, reject) => {
          let status: number | null = null;
          let contentType: string | null = null;
          /** 非 2xx 时收集错误 body（对齐 XHR 分支的 `HTTP ${status}: ${snippet}` 形态）。 */
          let errorBody = "";
          let settled = false;
          let onAbort: (() => void) | null = null;

          const finish = (settle: () => void): void => {
            if (settled) {
              return;
            }
            settled = true;
            routes.delete(requestId);
            if (onAbort != null && signal != null) {
              signal.removeEventListener("abort", onAbort);
            }
            settle();
          };

          routes.set(requestId, {
            onHeaders(event) {
              status = event.status;
              contentType = event.contentType;
            },
            onChunk(event) {
              if (status != null && status >= 200 && status < 300) {
                onChunk(event.text);
              } else {
                errorBody += event.text;
              }
            },
            onDone() {
              const finalStatus = status;
              if (finalStatus == null) {
                finish(() =>
                  reject(
                    new NativeSseTransportError(
                      "network",
                      "stream ended before headers",
                      requestId,
                    ),
                  ),
                );
                return;
              }
              if (finalStatus < 200 || finalStatus >= 300) {
                const snippet =
                  errorBody.length > 500
                    ? `${errorBody.slice(0, 500)}…`
                    : errorBody;
                finish(() =>
                  reject(
                    new NativeSseTransportError(
                      "http",
                      `HTTP ${finalStatus}: ${snippet}`,
                      requestId,
                      finalStatus,
                    ),
                  ),
                );
                return;
              }
              finish(() => resolve({ status: finalStatus, contentType }));
            },
            onError(event) {
              finish(() =>
                reject(
                  new NativeSseTransportError(
                    event.kind,
                    event.message,
                    requestId,
                  ),
                ),
              );
            },
          });

          if (signal != null) {
            if (signal.aborted) {
              routes.delete(requestId);
              reject(new NativeSseAbortError(requestId));
              return;
            }
            onAbort = () => {
              bridge.sseAbort(requestId);
              finish(() => reject(new NativeSseAbortError(requestId)));
            };
            signal.addEventListener("abort", onAbort, { once: true });
          }

          bridge.sseConnect(
            requestId,
            url,
            headersKv,
            body,
            readTimeoutMs,
            callTimeoutMs,
          );
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 事件载荷解析（native 侧 WritableMap 经 bridge 到达；宽容解析，形状不对即忽略）
// ---------------------------------------------------------------------------

function asRecord(event: unknown): Record<string, unknown> | null {
  if (typeof event !== "object" || event == null) {
    return null;
  }
  return event as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function parseHeadersEvent(event: unknown): LlmSseHeadersEvent | null {
  const record = asRecord(event);
  if (record == null) {
    return null;
  }
  const requestId = requireString(record, "requestId");
  const status = record["status"];
  if (requestId == null || typeof status !== "number") {
    return null;
  }
  const contentType =
    typeof record["contentType"] === "string" ? record["contentType"] : null;
  return { requestId, status, contentType };
}

function parseChunkEvent(event: unknown): LlmSseChunkEvent | null {
  const record = asRecord(event);
  if (record == null) {
    return null;
  }
  const requestId = requireString(record, "requestId");
  const text = record["text"];
  if (requestId == null || typeof text !== "string") {
    return null;
  }
  return { requestId, text };
}

function parseDoneEvent(event: unknown): LlmSseDoneEvent | null {
  const record = asRecord(event);
  if (record == null) {
    return null;
  }
  const requestId = requireString(record, "requestId");
  return requestId == null ? null : { requestId };
}

function parseErrorEvent(event: unknown): LlmSseErrorEvent | null {
  const record = asRecord(event);
  if (record == null) {
    return null;
  }
  const requestId = requireString(record, "requestId");
  const kind = record["kind"];
  const message = requireString(record, "message");
  if (
    requestId == null ||
    message == null ||
    (kind !== "network" && kind !== "timeout" && kind !== "http")
  ) {
    return null;
  }
  return { requestId, kind, message };
}
