/**
 * Optional fetch logging for LLM HTTP (Metro / adb logcat).
 *
 * Enable: `NM_DEBUG_LLM_FETCH=1`, `globalThis.__NM_DEBUG_LLM_FETCH__ = true`,
 * or React Native `__DEV__` when wired from the mobile entry.
 *
 * @module infra/llm-protocol/logic/debug-fetch
 */

import { Guards } from "@/common/guards.js";
import { LogSanitize } from "@/infra/log/index.js";
import { LogFactory } from "@/infra/log/logger.js";
import type { FetchFn } from "../ports/adapter.port.js";

const log = LogFactory.create("llm.fetch");

export const DebugFetch = {
  /** Whether LLM fetch logging is active. */
  // nm-style note: 剥 Fetch 主体得 isLlmDebugEnabled（语义保留）；createLoggingFetch 剥后不成词，保留原名。
  isLlmDebugEnabled(): boolean {
    if (process.env.NM_DEBUG_LLM_FETCH === "1") {
      return true;
    }
    const g = globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean; __DEV__?: boolean };
    return g.__NM_DEBUG_LLM_FETCH__ === true || g.__DEV__ === true;
  },

  /** Redact sensitive query params (e.g. Gemini `?key=`) from logged URLs. */
  redactUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.searchParams.has("key")) {
        u.searchParams.set("key", "***");
      }
      return u.toString();
    } catch {
      return url.replace(/([?&]key=)[^&]+/gi, "$1***");
    }
  },

  /** Wraps fetch with console logging (no API keys). */
  createLoggingFetch(base: FetchFn = globalThis.fetch): FetchFn {
    return async (input, init) => {
      if (!DebugFetch.isLlmDebugEnabled()) {
        return base(input, init);
      }

      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";

      // headers 脱敏：authorization / x-api-key 一律打码。
      const headers = init?.headers;
      const loggedHeaders: Record<string, string> = {};
      const redact = (key: string, value: string): string => {
        const lower = key.toLowerCase();
        return lower === "authorization" || lower === "x-api-key" ? "***" : value;
      };
      if (headers instanceof Headers) {
        headers.forEach((value, key) => {
          loggedHeaders[key] = redact(key, value);
        });
      } else if (Array.isArray(headers)) {
        for (const [key, value] of headers) {
          loggedHeaders[key] = redact(key, value);
        }
      } else if (headers != null) {
        for (const [key, value] of Object.entries(headers)) {
          loggedHeaders[key] = redact(key, String(value));
        }
      }

      log.debug(`→ ${method} ${DebugFetch.redactUrl(url)}`);
      log.debug("request headers", { headers: loggedHeaders });

      // body 摘要：字符串 JSON 只取结构字段，非 JSON 不落原文（G6 硬要求）。
      const body = init?.body ?? undefined;
      let bodySummary: string | undefined;
      if (body != null) {
        if (typeof body === "string") {
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            const summary: Record<string, unknown> = { model: parsed.model, stream: parsed.stream, tool_choice: parsed.tool_choice };
            if (Array.isArray(parsed.messages)) {
              summary.messages = `array(${parsed.messages.length})`;
            }
            if (Array.isArray(parsed.contents)) {
              summary.contents = parsed.contents.slice(0, 4).map((content, index) => {
                if (!Guards.isRecord(content) || !Array.isArray(content.parts)) {
                  return { index, role: "?", parts: 0 };
                }
                const first = content.parts[0];
                const fr = Guards.isRecord(first) ? first.functionResponse : undefined;
                const fc = Guards.isRecord(first) ? first.functionCall : undefined;
                return {
                  index,
                  role: content.role,
                  partKinds: content.parts.map((part) => (Guards.isRecord(part) ? Object.keys(part)[0] ?? "?" : "?")),
                  functionResponseName: Guards.isRecord(fr) && typeof fr.name === "string" ? fr.name : undefined,
                  functionCallName: Guards.isRecord(fc) && typeof fc.name === "string" ? fc.name : undefined,
                };
              });
            }
            bodySummary = JSON.stringify(summary);
          } catch {
            // 非 JSON 请求体：绝不能把原文当前 400 字摘要吐进日志（G6 硬要求）。
            bodySummary = `[unparsed ${typeof body}: chars=${LogSanitize.describeText(body).chars}]`;
          }
        } else {
          bodySummary = `[${typeof body}]`;
        }
      }
      if (bodySummary !== undefined) {
        log.debug("request body", { bodySummary });
      }

      // 请求是否以流式形态发出（判据只看请求侧意图）：OpenAI / Anthropic 看 body JSON 的 `stream: true`；Gemini 看 URL 的 `alt=sse`。
      // 收窄理由：core 里唯一消费 `response.body` 的路径是 postSse 的 fetch 分支，非流式请求成功响应 body 为 null 是正常形态。
      let requestIsStreaming = /[?&]alt=sse(?:&|$)/.test(url);
      if (typeof body === "string") {
        try {
          const parsed: unknown = JSON.parse(body);
          if (Guards.isRecord(parsed) && parsed.stream === true) {
            requestIsStreaming = true;
          }
        } catch {
          /* 非 JSON body 不是流式请求的形态，继续看 URL */
        }
      }

      const started = Date.now();
      const response = await base(input, init);
      const ms = Date.now() - started;
      const contentType = response.headers.get("content-type");
      const hasBody = response.body != null;

      log.debug(`← ${response.status} ${response.statusText} ${ms}ms`, { contentType, hasBody });

      if (!response.ok) {
        try {
          // 错误响应体同样是正文：交给脱敏层压成 {chars, hash}，不落原文。
          log.debug("error response body", { body: await response.clone().text() });
        } catch {
          /* ignore */
        }
      } else if (hasBody === false && requestIsStreaming) {
        log.warn("response.body is null (streaming may fail on RN)");
      }

      return response;
    };
  },
} as const;
