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

function redactHeaders(
  headers: RequestInit["headers"],
): Record<string, string> {
  if (headers == null) {
    return {};
  }
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] =
        key.toLowerCase() === "authorization" ? "Bearer ***" : value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key] =
        key.toLowerCase() === "authorization" ? "Bearer ***" : value;
    }
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    out[key] =
      key.toLowerCase() === "authorization" ? "Bearer ***" : String(value);
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
      return JSON.stringify(summary);
    } catch {
      return body.length > 400 ? `${body.slice(0, 400)}…` : body;
    }
  }
  return `[${typeof body}]`;
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

    console.log(LOG_TAG, "→", method, url);
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

    console.log(
      LOG_TAG,
      "←",
      response.status,
      response.statusText,
      `${ms}ms`,
      { contentType, hasBody },
    );

    if (!response.ok) {
      try {
        const text = await response.clone().text();
        const snippet =
          text.length > 600 ? `${text.slice(0, 600)}…` : text;
        console.log(LOG_TAG, "  error body", snippet);
      } catch {
        /* ignore */
      }
    } else if (hasBody === false) {
      console.warn(LOG_TAG, "  response.body is null (streaming may fail on RN)");
    }

    return response;
  };
}
