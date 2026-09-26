/**
 * Optional fetch logging for LLM HTTP (Metro / adb logcat).
 *
 * Enable: `NM_DEBUG_LLM_FETCH=1`, `globalThis.__NM_DEBUG_LLM_FETCH__ = true`,
 * or React Native `__DEV__` when wired from the mobile entry.
 *
 * @module infra/llm-protocol/logic/debug-fetch
 */

import type { FetchFn } from "../ports/adapter.port.js";

const LOG_TAG = "[novel-master/llm]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether LLM fetch logging is active. */
export function isLlmFetchDebugEnabled(): boolean {
  if (process.env.NM_DEBUG_LLM_FETCH === "1") {
    return true;
  }
  const g = globalThis as {
    __NM_DEBUG_LLM_FETCH__?: boolean;
    __DEV__?: boolean;
  };
  return g.__NM_DEBUG_LLM_FETCH__ === true || g.__DEV__ === true;
}

/** Redact sensitive query params (e.g. Gemini `?key=`) from logged URLs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("key")) {
      u.searchParams.set("key", "***");
    }
    return u.toString();
  } catch {
    return url.replace(/([?&]key=)[^&]+/gi, "$1***");
  }
}

function redactHeaders(
  headers: RequestInit["headers"]
): Record<string, string> {
  if (headers == null) {
    return {};
  }
  const out: Record<string, string> = {};
  const redact = (key: string, value: string): string => {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "x-api-key") {
      return "***";
    }
    return value;
  };
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = redact(key, value);
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key] = redact(key, value);
    }
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    out[key] = redact(key, String(value));
  }
  return out;
}

function summarizeBody(body: RequestInit["body"]): string | undefined {
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const summary: Record<string, unknown> = {
        model: parsed.model,
        stream: parsed.stream,
        tool_choice: parsed.tool_choice,
      };
      if (Array.isArray(parsed.messages)) {
        summary.messages = `array(${parsed.messages.length})`;
      }
      if (Array.isArray(parsed.contents)) {
        summary.contents = parsed.contents.slice(0, 4).map((content, index) => {
          if (!isRecord(content) || !Array.isArray(content.parts)) {
            return { index, role: "?", parts: 0 };
          }
          const first = content.parts[0];
          const fr = isRecord(first) ? first.functionResponse : undefined;
          const fc = isRecord(first) ? first.functionCall : undefined;
          return {
            index,
            role: content.role,
            partKinds: content.parts.map((part) =>
              isRecord(part) ? Object.keys(part)[0] ?? "?" : "?"
            ),
            functionResponseName:
              isRecord(fr) && typeof fr.name === "string" ? fr.name : undefined,
            functionCallName:
              isRecord(fc) && typeof fc.name === "string" ? fc.name : undefined,
          };
        });
      }
      return JSON.stringify(summary);
    } catch {
      return body.length > 400 ? `${body.slice(0, 400)}…` : body;
    }
  }
  return `[${typeof body}]`;
}

/**
 * 请求是否以流式形态发出。判据只看请求侧意图：
 * - OpenAI / Anthropic：body JSON 的 `stream: true`；
 * - Gemini：URL 的 `alt=sse`（其 body 不带 stream 字段）。
 *
 * 收窄理由：core 里唯一消费 `response.body` 的路径是 postSse 的 fetch 分支
 * （`llm-sse-transport.ts` 的空 body 防御），因此「body 为 null 会让流式挂掉」
 * 只对流式请求成立。非流式请求（含 mobile 走 native request 的 fetch shim）
 * 成功响应 body 为 null 是正常形态，不该打「streaming may fail on RN」。
 */
function isStreamingRequest(url: string, body: RequestInit["body"]): boolean {
  if (typeof body === "string") {
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed) && parsed.stream === true) {
        return true;
      }
    } catch {
      /* 非 JSON body 不是流式请求的形态，继续看 URL */
    }
  }
  return /[?&]alt=sse(?:&|$)/.test(url);
}

/** Wraps fetch with console logging (no API keys). */
export function createLoggingFetch(base: FetchFn = globalThis.fetch): FetchFn {
  return async (input, init) => {
    if (!isLlmFetchDebugEnabled()) {
      return base(input, init);
    }

    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
    const method = init?.method ?? "GET";

    console.log(LOG_TAG, "→", method, redactUrl(url));
    console.log(LOG_TAG, "  headers", redactHeaders(init?.headers));
    const bodySummary = summarizeBody(init?.body ?? undefined);
    if (bodySummary !== undefined) {
      console.log(LOG_TAG, "  body", bodySummary);
    }

    const started = Date.now();
    const response = await base(input, init);
    const ms = Date.now() - started;
    const contentType = response.headers.get("content-type");
    const hasBody = response.body != null;

    console.log(LOG_TAG, "←", response.status, response.statusText, `${ms}ms`, {
      contentType,
      hasBody,
    });

    if (!response.ok) {
      try {
        const text = await response.clone().text();
        const snippet = text.length > 600 ? `${text.slice(0, 600)}…` : text;
        console.log(LOG_TAG, "  error body", snippet);
      } catch {
        /* ignore */
      }
    } else if (hasBody === false && isStreamingRequest(url, init?.body)) {
      console.warn(
        LOG_TAG,
        "  response.body is null (streaming may fail on RN)"
      );
    }

    return response;
  };
}
