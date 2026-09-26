import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createLoggingFetch,
  redactUrl,
} from "../../../src/infra/llm-protocol/logic/debug-fetch.js";

describe("debug-fetch redactUrl", () => {
  it("redacts key query param on valid URL", () => {
    const redacted = redactUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=SECRET123",
    );
    assert.ok(!redacted.includes("SECRET123"));
    assert.match(redacted, /key=\*\*\*/);
  });

  it("preserves non-key query params", () => {
    const redacted = redactUrl("https://api.example.com/v1?alt=sse&key=SECRET");
    assert.match(redacted, /alt=sse/);
    assert.match(redacted, /key=\*\*\*/);
  });

  it("falls back to regex when URL constructor fails", () => {
    const redacted = redactUrl("not-a-url?key=SECRET&foo=bar");
    assert.ok(!redacted.includes("SECRET"));
    assert.match(redacted, /key=\*\*\*/);
  });

  it("leaves URLs without key unchanged", () => {
    const url = "https://api.anthropic.com/v1/messages";
    assert.equal(redactUrl(url), url);
  });
});

/**
 * 最小 Response 桩：logging 只读 ok/status/statusText/headers/body（非 ok 分支
 * 才 clone().text()）。`body` 缺省即 null——mobile fetch shim 的成功形态。
 */
function stubResponse(options?: {
  body?: unknown;
  status?: number;
  contentType?: string;
}): Response {
  const status = options?.status ?? 200;
  const headers = new Headers();
  if (options?.contentType != null) {
    headers.set("content-type", options.contentType);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers,
    body: options?.body ?? null,
    clone: () => stubResponse(options),
    text: async () => (typeof options?.body === "string" ? options.body : ""),
  } as unknown as Response;
}

describe("createLoggingFetch 空 body 告警判据收窄（native-sse/shim-2）", () => {
  const originalDebugEnv = process.env.NM_DEBUG_LLM_FETCH;
  const originalLog = console.log;
  const originalWarn = console.warn;
  let logs: string[] = [];
  let warnings: string[] = [];

  beforeEach(() => {
    process.env.NM_DEBUG_LLM_FETCH = "1";
    logs = [];
    warnings = [];
    // 只关心告警；日志与告警一起捕获，避免测试输出噪音。
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    if (originalDebugEnv === undefined) {
      delete process.env.NM_DEBUG_LLM_FETCH;
    } else {
      process.env.NM_DEBUG_LLM_FETCH = originalDebugEnv;
    }
    console.log = originalLog;
    console.warn = originalWarn;
  });

  it("非流式请求响应 body 为 null：不告警（listModels / chatNonStream 形态）", async () => {
    const fetchFn = createLoggingFetch(async () => stubResponse());
    // GET 无 body（三家 listModels 形态）。
    await fetchFn("https://api.openai.com/v1/models", { method: "GET" });
    // POST 显式非流式 body（chatNonStream 形态；mobile 走 fetch shim 时
    // 成功响应 body 为 null 是正常形态，不是流式挂掉）。
    await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude", stream: false }),
    });
    assert.deepEqual(warnings, []);
  });

  it("OpenAI 风格 body stream:true + 响应 body 为 null：仍告警", async () => {
    const fetchFn = createLoggingFetch(async () => stubResponse());
    await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt", stream: true }),
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /streaming may fail on RN/);
  });

  it("Gemini 风格 URL alt=sse + 响应 body 为 null：仍告警", async () => {
    const fetchFn = createLoggingFetch(async () => stubResponse());
    await fetchFn(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini:streamGenerateContent?alt=sse&key=SECRET",
      { method: "POST", body: JSON.stringify({ contents: [] }) }
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /streaming may fail on RN/);
    // 告警文本不含 URL；请求日志走 redactUrl，key 必须打码。
    assert.ok(!warnings[0]!.includes("SECRET"));
    assert.ok(logs.some((line) => line.includes("key=***")));
    assert.ok(!logs.some((line) => line.includes("SECRET")));
  });
});
