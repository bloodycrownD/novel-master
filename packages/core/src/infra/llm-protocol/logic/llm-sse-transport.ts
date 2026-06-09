/**
 * LLM SSE HTTP transport: fetch stream body or React Native XMLHttpRequest.
 *
 * React Native `fetch` often returns `response.body === null` for SSE; when
 * `navigator.product === "ReactNative"`, we use XHR `onprogress` instead.
 * No `stream: false` downgrade on failure.
 *
 * @module infra/llm-protocol/logic/llm-sse-transport
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { FetchFn } from "../ports/adapter.port.js";
import { assertOk } from "./http-util.js";

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
export function setShouldUseXhrForSseOverrideForTests(value: boolean | undefined): void {
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
  const g = globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean; __DEV__?: boolean };
  return g.__NM_DEBUG_LLM_FETCH__ === true || g.__DEV__ === true;
}

function applyXhrHeaders(
  xhr: SseXmlHttpRequest,
  headers: RequestInit["headers"] | undefined,
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
  detail?: Record<string, unknown>,
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
  logTag: string,
): Promise<{ status: number; contentType: string | null }> {
  const XhrCtor = getXmlHttpRequestCtor();
  if (XhrCtor == null) {
    return Promise.reject(
      new ProviderError(
        "HTTP_ERROR",
        "XMLHttpRequest is not available in this environment",
        { providerId },
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const xhr = new XhrCtor();
    let processedLength = 0;
    let firstChunkLogged = false;
    let settled = false;

    const resolveOnce = (value: { status: number; contentType: string | null }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: ProviderError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const MAX_SSE_EMIT_BYTES = 4096;
    const SSE_STALL_MS = 90_000;
    let pendingText = "";
    let drainTimer: ReturnType<typeof setTimeout> | null = null;
    let lastProgressAt = Date.now();
    let stallTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (Date.now() - lastProgressAt < SSE_STALL_MS) {
        return;
      }
      clearDrainTimer();
      pendingText = "";
      xhr.abort();
    }, 5000);

    const clearStallTimer = (): void => {
      if (stallTimer != null) {
        clearInterval(stallTimer);
        stallTimer = null;
      }
    };

    const clearDrainTimer = (): void => {
      if (drainTimer != null) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
    };

    const emitPendingChunk = (): boolean => {
      if (pendingText.length === 0) {
        return false;
      }
      const take = Math.min(pendingText.length, MAX_SSE_EMIT_BYTES);
      const chunk = pendingText.slice(0, take);
      pendingText = pendingText.slice(take);
      onChunk(chunk);
      return pendingText.length > 0;
    };

    const scheduleDrain = (): void => {
      if (drainTimer != null || pendingText.length === 0) {
        return;
      }
      drainTimer = setTimeout(() => {
        drainTimer = null;
        if (emitPendingChunk()) {
          scheduleDrain();
        }
      }, 0);
    };

    const drainAllPending = (onDone: () => void): void => {
      clearDrainTimer();
      const step = (): void => {
        if (emitPendingChunk()) {
          setTimeout(step, 0);
          return;
        }
        onDone();
      };
      step();
    };

    const deliverNewText = (): void => {
      lastProgressAt = Date.now();
      const text = xhr.responseText;
      if (text.length <= processedLength) {
        return;
      }
      const chunk = text.slice(processedLength);
      processedLength = text.length;
      if (!firstChunkLogged) {
        firstChunkLogged = true;
        logSse(logTag, "xhr first chunk", { bytes: chunk.length });
      }
      pendingText += chunk;
      scheduleDrain();
    };

    xhr.open(init.method ?? "POST", url);

    if (signal != null) {
      if (signal.aborted) {
        rejectOnce(new ProviderError("HTTP_ERROR", "Request aborted", { providerId }));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          xhr.abort();
        },
        { once: true },
      );
    }

    xhr.onprogress = () => {
      deliverNewText();
    };

    xhr.onload = () => {
      clearStallTimer();
      deliverNewText();
      drainAllPending(() => {
        const status = xhr.status;
        const contentType = xhr.getResponseHeader("Content-Type");
        logSse(logTag, "xhr complete", { status, contentType });

        if (status < 200 || status >= 300) {
          const body = xhr.responseText;
          const snippet = body.length > 500 ? `${body.slice(0, 500)}…` : body;
          rejectOnce(
            new ProviderError(
              "HTTP_ERROR",
              `HTTP ${status}: ${snippet}`,
              { providerId },
            ),
          );
          return;
        }

        resolveOnce({ status, contentType });
      });
    };

    xhr.onerror = () => {
      clearStallTimer();
      clearDrainTimer();
      pendingText = "";
      rejectOnce(new ProviderError("HTTP_ERROR", "XHR network error", { providerId }));
    };

    xhr.onabort = () => {
      clearStallTimer();
      clearDrainTimer();
      pendingText = "";
      rejectOnce(new ProviderError("HTTP_ERROR", "Request aborted", { providerId }));
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
  logTag: string,
): Promise<{ status: number; contentType: string | null }> {
  const fetchFn = options?.fetchFn ?? globalThis.fetch;
  const signal = options?.signal ?? init.signal;

  const response = await fetchFn(url, { ...init, signal });
  await assertOk(response, providerId);

  if (response.body == null) {
    const contentType = response.headers.get("content-type") ?? "none";
    throw new ProviderError(
      "HTTP_ERROR",
      `Empty streaming response body (HTTP ${response.status}, content-type: ${contentType}). This environment does not support fetch stream bodies.`,
      { providerId },
    );
  }

  logSse(logTag, "fetch stream start", {
    status: response.status,
    contentType: response.headers.get("content-type"),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let firstChunkLogged = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = decoder.decode(value, { stream: true });
    if (!firstChunkLogged && chunk.length > 0) {
      firstChunkLogged = true;
      logSse(logTag, "fetch first chunk", { bytes: chunk.length });
    }
    onChunk(chunk);
  }

  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
  };
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
  options?: PostSseOptions,
): Promise<{ status: number; contentType: string | null }> {
  const logTag = options?.logTag ?? DEFAULT_LOG_TAG;
  const method = init.method ?? "POST";
  logSse(logTag, "→", { method, url, transport: shouldUseXhrForSse() ? "xhr" : "fetch" });

  if (shouldUseXhrForSse()) {
    return postSseViaXhr(
      url,
      init,
      onChunk,
      providerId,
      options?.signal ?? init.signal ?? undefined,
      logTag,
    );
  }

  return postSseViaFetch(url, init, onChunk, providerId, options, logTag);
}
