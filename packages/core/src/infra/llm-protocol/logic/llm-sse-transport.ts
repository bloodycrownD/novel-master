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
 * 两条路径均装配 {@link createStreamWatchdog} 双 deadline（首字/流空闲，spec
 * llm-stream-timeout）：任何失联在有限时间内以 {@link LlmStreamTimeoutError}
 * 收敛，连接随之中断清理；超时分级语义（首字前可重试/流中断不重试）由
 * model-request.service 的 isRetryableError 承接。
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
  FIRST_CHUNK_TIMEOUT_MS,
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

/** Minimal XHR surface used by SSE transport (Node types omit DOM lib). */
type SseXmlHttpRequest = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
  responseText: string;
  status: number;
  onprogress: (() => void) | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
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

    // 双 deadline 看门狗（spec llm-stream-timeout 第 2 节）：
    // onTimeout 时序关键——先 rejectOnce(超时错误) 抢占 settle，再 xhr.abort()
    // + emitter.dispose() 仅作断流清理。abort 触发的 onabort 里二次 rejectOnce
    // 被 settled 守卫挡掉，ProviderError("Request aborted") 根本不会产生，超时
    // 错误原样上抛；若反过来寄望 onabort 链传播，会被 isRequestAborted 识别为
    // 用户取消、被 adapter 吞成 partial，分级语义全失效。
    const watchdog: StreamWatchdog = createStreamWatchdog({
      onTimeout: (phase) => {
        logSse(logTag, "stream timeout", {
          phase,
          lastActivityAt,
          processedLength,
          bufferedBytes: emitter.bufferedLength(),
        });
        rejectOnce(
          new LlmStreamTimeoutError(
            phase,
            phase === "first-chunk"
              ? FIRST_CHUNK_TIMEOUT_MS
              : STREAM_IDLE_TIMEOUT_MS
          )
        );
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
      // 任何响应数据到达（含每次增量）：撤销首字阶段并重置空闲 deadline。
      lastActivityAt = Date.now();
      watchdog.noteActivity();
      deliverNewText();
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

  // 读循环包入带 settled 守卫的 Promise（spec llm-stream-timeout 第 3 节），
  // onTimeout 时序与 XHR 同构：先 rejectOnce(超时错误) 抢占 settle，再
  // controller.abort() 仅作断流清理；随后 reader.read() 抛出的 AbortError 落入
  // 已 settle 分支被丢弃，最终传播的只会是超时错误（isAbortLikeError 无机会介入）。
  return new Promise((resolve, reject) => {
    let settled = false;

    const resolveOnce = (value: {
      status: number;
      contentType: string | null;
    }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const watchdog: StreamWatchdog = createStreamWatchdog({
      onTimeout: (phase) => {
        // fetch 路径即时转发、无节流缓冲，bufferedBytes 不适用（记 0）。
        logSse(logTag, "stream timeout", {
          phase,
          lastActivityAt,
          processedLength,
          bufferedBytes: 0,
        });
        rejectOnce(
          new LlmStreamTimeoutError(
            phase,
            phase === "first-chunk"
              ? FIRST_CHUNK_TIMEOUT_MS
              : STREAM_IDLE_TIMEOUT_MS
          )
        );
        watchdog.dispose();
        controller.abort();
      },
    });

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
