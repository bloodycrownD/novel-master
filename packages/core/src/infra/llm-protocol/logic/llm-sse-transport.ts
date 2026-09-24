/**
 * LLM SSE HTTP transport: fetch stream body or React Native XMLHttpRequest.
 *
 * React Native `fetch` often returns `response.body === null` for SSE; when
 * `navigator.product === "ReactNative"`, we use XHR `onprogress` instead.
 * No `stream: false` downgrade on failure.
 *
 * fetch 与 XHR 两条路径共享 {@link dispatchSseChunk} 分发语义（A-23）：解码后的
 * chunk 统一经 dispatchSseChunk 转发，首包日志只打一次。pacing 差异仍按传输介质
 * 区分——fetch 每个 reader.read() 直投 onChunk（Desktop/CLI 的异步读天然让步，无需
 * 节流），XHR 走 {@link createSseChunkEmitter} 的 32ms 整流（RN burst 平滑）。真正
 * 的 SSE 帧解析（data: / \n\n / event 字段）由下游 *-sse-parser 经 feedSseLines
 * 增量处理，跨路径一致。详见
 * `.apm/kb/docs/Iterations/mobile-sse-stream-resilience/spec.md`。
 *
 * 黑洞挂死根治（spec llm-stream-timeout 回炉版，三层防御）：
 * 1. XHR 路径请求带 `Connection: close`——OkHttp 尊重请求侧 close，连接用完
 *    即废不回池，消灭「上一次流留下的（可能已静默死亡的）连接被下一次请求
 *    复用」的黑洞入口；h2 下该头被协议剥离（无害），由 2 兜底。
 * 2. 整调用兜底 `SSE_WHOLE_CALL_TIMEOUT_MS`：XHR 经 `xhr.timeout`（RN 0.85.3
 *    映射 OkHttp callTimeout，覆盖 connect/写/读全周期）；fetch 经 whole-call
 *    定时器 + controller.abort。到点按「是否已收到响应数据」分级——0 字节 =
 *    first-chunk（黑洞，可重试且天然走新连接）；有输出 = idle（不自动重试）。
 * 3. 流空闲安全网 {@link createStreamWatchdog}（仅 idle，无首字臂——缓冲型
 *    模型首字不受任何自动超时约束）。
 *
 * @module infra/llm-protocol/logic/llm-sse-transport
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { FetchFn } from "../ports/adapter.port.js";
import { createSseChunkEmitter } from "./sse-chunk-emitter.js";
import {
  createSseDispatchState,
  dispatchSseChunk,
} from "./dispatch-sse-chunk.js";
import { assertOk } from "./http-util.js";
import {
  createStreamWatchdog,
  STREAM_IDLE_TIMEOUT_MS,
  type StreamWatchdog,
} from "./stream-watchdog.js";
import { LlmStreamTimeoutError } from "./llm-stream-timeout-error.js";

export type SseByteHandler = (chunk: string) => void;

export interface PostSseOptions {
  readonly fetchFn?: FetchFn;
  readonly signal?: AbortSignal;
  readonly logTag?: string;
}

const DEFAULT_LOG_TAG = "[novel-master/llm-sse]";

/**
 * 整调用兜底预算：connect + 写请求体 + 服务端处理 + 读响应体全周期上限。
 * 取值须显著大于最长健康流（200 t/s 下 10 分钟 ≈ 120K token 单次输出）；
 * 触发时按是否已收到数据分级（first-chunk/idle），见类文档注释第 2 条。
 */
export const SSE_WHOLE_CALL_TIMEOUT_MS = 600_000;

/** Minimal XHR surface used by SSE transport (Node types omit DOM lib). */
type SseXmlHttpRequest = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
  responseText: string;
  status: number;
  /** OkHttp callTimeout 毫秒值（RN 0.85.3 起 send 时读取并生效）。 */
  timeout: number;
  onprogress: (() => void) | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
  getResponseHeader(name: string): string | null;
};

type SseXmlHttpRequestConstructor = new () => SseXmlHttpRequest;

function getXmlHttpRequestCtor(): SseXmlHttpRequestConstructor | undefined {
  return (globalThis as { XMLHttpRequest?: SseXmlHttpRequestConstructor })
    .XMLHttpRequest;
}

let cachedShouldUseXhr: boolean | undefined;
/** @internal Test hook to force or clear transport selection. */
let shouldUseXhrOverrideForTests: boolean | undefined;

/** @internal Reset cached RN detection (tests only). */
export function resetShouldUseXhrForSseCacheForTests(): void {
  cachedShouldUseXhr = undefined;
  shouldUseXhrOverrideForTests = undefined;
}

/** @internal Force XHR/fetch branch in tests. */
export function setShouldUseXhrForSseOverrideForTests(
  value: boolean | undefined
): void {
  shouldUseXhrOverrideForTests = value;
  cachedShouldUseXhr = undefined;
}

/**
 * True on React Native where fetch streaming bodies are unavailable.
 * Result is cached for the process lifetime.
 */
export function shouldUseXhrForSse(): boolean {
  if (shouldUseXhrOverrideForTests !== undefined) {
    return shouldUseXhrOverrideForTests;
  }
  if (cachedShouldUseXhr !== undefined) {
    return cachedShouldUseXhr;
  }
  // RN exposes XMLHttpRequest and sets navigator.product; Node/CLI do not.
  cachedShouldUseXhr =
    getXmlHttpRequestCtor() != null &&
    (globalThis as { navigator?: { product?: string } }).navigator?.product ===
      "ReactNative";
  return cachedShouldUseXhr;
}

function isSseDebugEnabled(): boolean {
  if (process.env.NM_DEBUG_LLM_FETCH === "1") {
    return true;
  }
  const g = globalThis as {
    __NM_DEBUG_LLM_FETCH__?: boolean;
    __DEV__?: boolean;
  };
  return g.__NM_DEBUG_LLM_FETCH__ === true || g.__DEV__ === true;
}

function applyXhrHeaders(
  xhr: SseXmlHttpRequest,
  headers: RequestInit["headers"] | undefined
): void {
  if (headers == null) {
    return;
  }
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });
    return;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      xhr.setRequestHeader(key, value);
    }
    return;
  }
  for (const [key, value] of Object.entries(headers)) {
    xhr.setRequestHeader(key, String(value));
  }
}

function logSse(
  logTag: string,
  message: string,
  detail?: Record<string, unknown>
): void {
  if (!isSseDebugEnabled()) {
    return;
  }
  if (detail != null) {
    console.log(logTag, message, detail);
  } else {
    console.log(logTag, message);
  }
}

function postSseViaXhr(
  url: string,
  init: RequestInit,
  onChunk: SseByteHandler,
  providerId: string | undefined,
  signal: AbortSignal | undefined,
  logTag: string
): Promise<{ status: number; contentType: string | null }> {
  const XhrCtor = getXmlHttpRequestCtor();
  if (XhrCtor == null) {
    return Promise.reject(
      new ProviderError(
        "HTTP_ERROR",
        "XMLHttpRequest is not available in this environment",
        { providerId }
      )
    );
  }

  return new Promise((resolve, reject) => {
    const xhr = new XhrCtor();
    let processedLength = 0;
    const dispatchState = createSseDispatchState();
    let settled = false;
    let lastActivityAt = Date.now();

    const resolveOnce = (value: {
      status: number;
      contentType: string | null;
    }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // 放宽为 Error：watchdog 超时要以此 settle LlmStreamTimeoutError（非 ProviderError）。
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const emitter = createSseChunkEmitter(onChunk);

    // 空闲看门狗（仅 idle，无首字臂——回炉版 spec 第 3 节）：
    // onTimeout 时序关键——先 rejectOnce(超时错误) 抢占 settle，再 xhr.abort()
    // + emitter.dispose() 仅作断流清理。abort 触发的 onabort 里二次 rejectOnce
    // 被 settled 守卫挡掉，ProviderError("Request aborted") 根本不会产生，超时
    // 错误原样上抛；若反过来寄望 onabort 链传播，会被 isRequestAborted 识别为
    // 用户取消、被 adapter 吞成 partial，分级语义全失效。
    const watchdog: StreamWatchdog = createStreamWatchdog({
      onTimeout: () => {
        const phase = processedLength > 0 ? "idle" : "first-chunk";
        logSse(logTag, "stream timeout", {
          phase,
          lastActivityAt,
          processedLength,
          bufferedBytes: emitter.bufferedLength(),
        });
        rejectOnce(new LlmStreamTimeoutError(phase, STREAM_IDLE_TIMEOUT_MS));
        watchdog.dispose();
        emitter.dispose();
        xhr.abort();
      },
    });

    const deliverNewText = (): void => {
      const text = xhr.responseText;
      if (text.length <= processedLength) {
        return;
      }
      const chunk = text.slice(processedLength);
      processedLength = text.length;
      // 经公共 dispatchSseChunk 转发到 emitter（节流由 emitter 负责），首包日志统一在此。
      dispatchSseChunk(
        chunk,
        dispatchState,
        (text) => emitter.append(text),
        (bytes) => logSse(logTag, "xhr first chunk", { bytes })
      );
    };

    xhr.open(init.method ?? "POST", url);
    // 整调用兜底（回炉版 spec 第 2 节）：RN 0.85.3 将 xhr.timeout 映射为
    // OkHttp callTimeout（克隆 builder，共享池/分发器），覆盖 connect/写/读
    // 全周期——死连接黑洞（四超时全 0 下读永久阻塞）的唯一确定性下界。
    xhr.timeout = SSE_WHOLE_CALL_TIMEOUT_MS;

    if (signal != null) {
      if (signal.aborted) {
        emitter.dispose();
        watchdog.dispose();
        rejectOnce(
          new ProviderError("HTTP_ERROR", "Request aborted", { providerId })
        );
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          xhr.abort();
        },
        { once: true }
      );
    }

    xhr.onprogress = () => {
      // 任何响应数据到达（含每次增量）：重置空闲 deadline。
      lastActivityAt = Date.now();
      watchdog.noteActivity();
      deliverNewText();
    };

    // 整调用预算耗尽（callTimeout 到点，RN dispatch 'timeout' 事件）：
    // 按「是否已收到响应数据」分级——黑洞 0 字节 → first-chunk（可重试，
    // Connection: close 保证重试走新连接）；健康长流超预算（有输出）→
    // idle（不自动重试，走失败链）。rejectOnce 抢占 settle 后，RN 后续
    // 可能补发的 load/error/abort 回调被 settled 守卫丢弃。
    xhr.ontimeout = () => {
      const phase = processedLength > 0 ? "idle" : "first-chunk";
      logSse(logTag, "stream timeout", {
        phase,
        source: "whole-call",
        lastActivityAt,
        processedLength,
        bufferedBytes: emitter.bufferedLength(),
      });
      rejectOnce(
        new LlmStreamTimeoutError(phase, SSE_WHOLE_CALL_TIMEOUT_MS, "whole-call budget")
      );
      watchdog.dispose();
      emitter.dispose();
    };

    xhr.onload = () => {
      watchdog.dispose();
      deliverNewText();
      // Synchronous flush on complete: no async drain chain; guarantees tail delivery.
      const tail = emitter.flush();
      if (tail.length > 0) {
        onChunk(tail);
      }

      const status = xhr.status;
      const contentType = xhr.getResponseHeader("Content-Type");
      logSse(logTag, "xhr complete", { status, contentType });

      if (status < 200 || status >= 300) {
        const body = xhr.responseText;
        const snippet = body.length > 500 ? `${body.slice(0, 500)}…` : body;
        rejectOnce(
          new ProviderError("HTTP_ERROR", `HTTP ${status}: ${snippet}`, {
            providerId,
          })
        );
        return;
      }

      resolveOnce({ status, contentType });
    };

    xhr.onerror = () => {
      watchdog.dispose();
      emitter.dispose();
      rejectOnce(
        new ProviderError("HTTP_ERROR", "XHR network error", { providerId })
      );
    };

    xhr.onabort = () => {
      watchdog.dispose();
      emitter.dispose();
      rejectOnce(
        new ProviderError("HTTP_ERROR", "Request aborted", { providerId })
      );
    };

    applyXhrHeaders(xhr, init.headers);
    // 防死连接复用（回炉版 spec 第 1 节）：置于 applyXhrHeaders 之后 =
    // 覆盖用户 provider.headers 的同名头，强制生效。OkHttp 尊重请求侧
    // Connection: close（CallServerInterceptor → noNewExchangesOnConnection），
    // 连接用完即废不回池——「上一次流留下的（可能已静默死亡的）连接」不再
    // 被下一次请求复用。h2 下该头被协议剥离（无害），黑洞由 xhr.timeout 兜底。
    xhr.setRequestHeader("Connection", "close");
    xhr.send(init.body ?? null);
  });
}

async function postSseViaFetch(
  url: string,
  init: RequestInit,
  onChunk: SseByteHandler,
  providerId: string | undefined,
  options: PostSseOptions | undefined,
  logTag: string
): Promise<{ status: number; contentType: string | null }> {
  const fetchFn = options?.fetchFn ?? globalThis.fetch;
  const signal = options?.signal ?? init.signal;

  // 组合自有 controller：用户 AbortSignal（停止生成）转发进来；watchdog 超时也
  // 经它主动断流。用户取消语义不变——signal abort → controller.abort →
  // fetch/reader 抛 AbortError → 上抛（与直接传 signal 等价）。
  const controller = new AbortController();
  if (signal != null) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener(
        "abort",
        () => {
          controller.abort();
        },
        { once: true }
      );
    }
  }

  let processedLength = 0;
  let lastActivityAt = Date.now();

  // 读循环包入带 settled 守卫的 Promise，onTimeout 时序与 XHR 同构：
  // 先 rejectOnce(超时错误) 抢占 settle，再 controller.abort() 仅作断流
  // 清理；随后 reader.read() 抛出的 AbortError 落入已 settle 分支被丢弃，
  // 最终传播的只会是超时错误（isAbortLikeError 无机会介入）。
  return new Promise((resolve, reject) => {
    let settled = false;
    let wholeCallTimer: ReturnType<typeof setTimeout> | null = null;

    const resolveOnce = (value: {
      status: number;
      contentType: string | null;
    }) => {
      if (settled) return;
      settled = true;
      clearWholeCallTimer();
      resolve(value);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearWholeCallTimer();
      reject(error);
    };

    const clearWholeCallTimer = (): void => {
      if (wholeCallTimer != null) {
        clearTimeout(wholeCallTimer);
        wholeCallTimer = null;
      }
    };

    const watchdog: StreamWatchdog = createStreamWatchdog({
      onTimeout: () => {
        // fetch 路径即时转发、无节流缓冲，bufferedBytes 不适用（记 0）。
        const phase = processedLength > 0 ? "idle" : "first-chunk";
        logSse(logTag, "stream timeout", {
          phase,
          lastActivityAt,
          processedLength,
          bufferedBytes: 0,
        });
        rejectOnce(new LlmStreamTimeoutError(phase, STREAM_IDLE_TIMEOUT_MS));
        watchdog.dispose();
        controller.abort();
      },
    });

    // 整调用兜底（与 XHR 的 xhr.timeout 语义对齐，回炉版 spec 第 2 节）：
    // connect/写/读全周期预算，到点按是否已收到数据分级收敛。
    wholeCallTimer = setTimeout(() => {
      wholeCallTimer = null;
      if (settled) {
        return;
      }
      const phase = processedLength > 0 ? "idle" : "first-chunk";
      logSse(logTag, "stream timeout", {
        phase,
        source: "whole-call",
        lastActivityAt,
        processedLength,
        bufferedBytes: 0,
      });
      rejectOnce(
        new LlmStreamTimeoutError(
          phase,
          SSE_WHOLE_CALL_TIMEOUT_MS,
          "whole-call budget"
        )
      );
      watchdog.dispose();
      controller.abort();
    }, SSE_WHOLE_CALL_TIMEOUT_MS);

    void (async () => {
      try {
        const response = await fetchFn(url, {
          ...init,
          signal: controller.signal,
        });
        await assertOk(response, providerId);

        if (response.body == null) {
          const contentType = response.headers.get("content-type") ?? "none";
          throw new ProviderError(
            "HTTP_ERROR",
            `Empty streaming response body (HTTP ${response.status}, content-type: ${contentType}). This environment does not support fetch stream bodies.`,
            { providerId }
          );
        }

        logSse(logTag, "fetch stream start", {
          status: response.status,
          contentType: response.headers.get("content-type"),
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const dispatchState = createSseDispatchState();

        while (true) {
          const { done, value } = await reader.read();
          // reader.read() 每次返回（含空 chunk / done）即活动：撤销首字阶段、
          // 重置空闲 deadline。
          lastActivityAt = Date.now();
          watchdog.noteActivity();
          if (done) {
            break;
          }
          // fetch 在此完成 UTF-8 解码，再经公共 dispatchSseChunk 直投 onChunk（即时转发，
          // 无节流）；首包日志与 XHR 路径共用同一套分发语义。processedLength 为
          // 解码后累计字符数（观测打点用，spec 第 5 节口径）。
          const chunk = decoder.decode(value, { stream: true });
          processedLength += chunk.length;
          dispatchSseChunk(chunk, dispatchState, onChunk, (bytes) =>
            logSse(logTag, "fetch first chunk", { bytes })
          );
        }

        watchdog.dispose();
        resolveOnce({
          status: response.status,
          contentType: response.headers.get("content-type"),
        });
      } catch (error) {
        watchdog.dispose();
        if (settled) {
          // watchdog 已以超时错误 settle：controller.abort() 导致的 AbortError
          // 在此丢弃，不让它顶替/竞态超时错误。
          return;
        }
        rejectOnce(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    })();
  });
}

/**
 * POST and deliver SSE text chunks incrementally (UTF-8 decoded strings).
 * HTTP 4xx/5xx throw {@link ProviderError} with code `HTTP_ERROR`.
 */
export async function postSse(
  url: string,
  init: RequestInit,
  onChunk: SseByteHandler,
  providerId?: string,
  options?: PostSseOptions
): Promise<{ status: number; contentType: string | null }> {
  const logTag = options?.logTag ?? DEFAULT_LOG_TAG;
  const method = init.method ?? "POST";
  logSse(logTag, "→", {
    method,
    url,
    transport: shouldUseXhrForSse() ? "xhr" : "fetch",
  });

  if (shouldUseXhrForSse()) {
    return postSseViaXhr(
      url,
      init,
      onChunk,
      providerId,
      options?.signal ?? init.signal ?? undefined,
      logTag
    );
  }

  return postSseViaFetch(url, init, onChunk, providerId, options, logTag);
}
