import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createLogger, describeText, restoreDefaultLogSink, setDefaultLogSink } from "@novel-master/core/log";
import type { LogDetail, LogRecord, LogSink } from "@novel-master/core/log";

/** 捕获 sink（公开 API 范式，无 test-only 导出）。 */
function captureSink(): { readonly records: LogRecord[]; readonly sink: LogSink } {
  const records: LogRecord[] = [];
  return { records, sink: { write: (record) => records.push(record) } };
}

/** 发一条 info，返回脱敏后的 detail（脱敏只在 emit 时执行）。 */
function emitDetail(detail: LogDetail): Record<string, unknown> {
  const { records, sink } = captureSink();
  setDefaultLogSink(sink);
  createLogger("sanitize-test").info("probe", detail);
  assert.equal(records.length, 1);
  return (records[0]!.detail ?? {}) as Record<string, unknown>;
}

afterEach(() => {
  restoreDefaultLogSink();
});

describe("describeText", () => {
  it("输出长度 + 16 位小写 hex 指纹", () => {
    const digest = describeText("落霞与孤鹜齐飞");
    assert.equal(digest.chars, 7);
    assert.match(digest.hash, /^[0-9a-f]{16}$/);
  });

  it("同文本同指纹、异文本异指纹", () => {
    assert.equal(describeText("abc").hash, describeText("abc").hash);
    assert.notEqual(describeText("abc").hash, describeText("abd").hash);
    assert.equal(describeText("").chars, 0);
  });
});

describe("脱敏 B1: key 黑名单", () => {
  it("八个敏感键的值全变 [redacted]", () => {
    const detail = emitDetail({
      apiKey: "SECRET-1",
      "x-api-key": "SECRET-2",
      authorization: "SECRET-3",
      Authorization: "SECRET-4",
      password: "SECRET-5",
      secretKey: "SECRET-6",
      accessToken: "SECRET-7",
      token: "SECRET-8",
    });
    for (const value of Object.values(detail)) {
      assert.equal(value, "[redacted]");
    }
    assert.ok(!JSON.stringify(detail).includes("SECRET"));
  });

  it("六个非敏感键原值保留（tokenCount 等不得误伤）", () => {
    const detail = emitDetail({
      tokenCount: 12,
      tokensUsed: 34,
      maxTokens: 5678,
      keyBytes: 90,
      contentHash: "deadbeef",
      providerId: "openai",
      scope: "agent.runner",
      modelId: "gpt-4.1",
      path: "/角色/a.md",
    });
    assert.equal(detail.tokenCount, 12);
    assert.equal(detail.tokensUsed, 34);
    assert.equal(detail.maxTokens, 5678);
    assert.equal(detail.keyBytes, 90);
    assert.equal(detail.contentHash, "deadbeef");
    assert.equal(detail.providerId, "openai");
    assert.equal(detail.scope, "agent.runner");
    assert.equal(detail.modelId, "gpt-4.1");
    assert.equal(detail.path, "/角色/a.md");
  });

  it("嵌套对象的敏感键同样脱敏", () => {
    const detail = emitDetail({ headers: { Authorization: "Bearer SECRET", "content-type": "application/json" } });
    const headers = detail.headers as Record<string, unknown>;
    assert.equal(headers.Authorization, "[redacted]");
    assert.equal(headers["content-type"], "application/json");
  });
});

describe("脱敏 B2: 正文键 → {chars, hash}", () => {
  it("prompt 只剩长度与指纹，输出不含原文任何片段", () => {
    const prompt = "正文".repeat(2500);
    const detail = emitDetail({ prompt });
    const digest = detail.prompt as { chars: number; hash: string };
    assert.equal(digest.chars, 5000);
    assert.match(digest.hash, /^[0-9a-f]{16}$/);
    const rendered = JSON.stringify(detail);
    assert.ok(!rendered.includes("正文"));
    assert.ok(!rendered.includes(prompt.slice(0, 20)));
  });

  it("其余正文键（content / body / message / messages / chunk）同样摘要", () => {
    const detail = emitDetail({
      content: "内容",
      body: "正文",
      message: "消息",
      messages: ["第一句", "第二句"],
      chunk: "块",
      delta: "增量",
      reasoning: "推理",
      output: "输出",
    });
    for (const key of ["content", "body", "message", "messages", "chunk", "delta", "reasoning", "output"]) {
      const digest = detail[key] as { chars: number; hash: string };
      assert.equal(typeof digest.chars, "number", `${key} 应被压成摘要`);
      assert.match(digest.hash, /^[0-9a-f]{16}$/, `${key} 应带指纹`);
    }
    assert.ok(!JSON.stringify(detail).includes("正文"));
  });
});

describe("脱敏 B3: 三重截断", () => {
  it("401 字符串 → 总长 ≤405、以 …(+1) 结尾、前缀恰 400", () => {
    const text = "x".repeat(401);
    const detail = emitDetail({ note: text });
    const truncated = detail.note as string;
    assert.ok(truncated.length <= 405, `总长 ${truncated.length} 应 ≤405`);
    assert.ok(truncated.endsWith("…(+1)"));
    assert.equal(truncated.slice(0, 400), "x".repeat(400));
  });

  it("400 字符串不截断", () => {
    const text = "y".repeat(400);
    const detail = emitDetail({ note: text });
    assert.equal(detail.note, text);
  });

  it("21 项数组 → 20 项 + {__truncated: 1}", () => {
    const detail = emitDetail({ items: Array.from({ length: 21 }, (_, index) => index) });
    const items = detail.items as unknown[];
    assert.equal(items.length, 21);
    assert.deepEqual(items.slice(0, 20), Array.from({ length: 20 }, (_, index) => index));
    assert.deepEqual(items[20], { __truncated: 1 });
  });

  it("6 层嵌套 → 第 5 层起 [depth-limit]", () => {
    const detail = emitDetail({ a: { b: { c: { d: { e: { f: 1 } } } } } });
    const d = ((detail.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<string, unknown>;
    const dValue = d.d as Record<string, unknown>;
    assert.equal(dValue.e, "[depth-limit]");
  });

  it("单对象 50 键上限 → 超出记 __truncatedKeys", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 52; i += 1) {
      wide[`k${i}`] = i;
    }
    const detail = emitDetail(wide);
    assert.equal(detail.__truncatedKeys, 2);
    assert.equal(Object.keys(detail).length, 51);
  });
});

describe("脱敏 B4: Error 展开", () => {
  it("name / message / stack 都在；message 超 500 被截断", () => {
    const detail = emitDetail({ error: new Error("boom") });
    const error = detail.error as Record<string, unknown>;
    assert.equal(error.name, "Error");
    assert.equal(error.message, "boom");
    assert.equal(typeof error.stack, "string");

    const long = emitDetail({ error: new Error("z".repeat(600)) });
    const longError = long.error as Record<string, unknown>;
    assert.equal(longError.message, `${"z".repeat(500)}…(+100)`);
  });

  it("AppError 的 code 保留", () => {
    const appError = Object.assign(new Error("bad pref"), { name: "PREFERENCES_INVALID_VALUE", code: 1001 });
    const detail = emitDetail({ error: appError });
    const error = detail.error as Record<string, unknown>;
    assert.equal(error.name, "PREFERENCES_INVALID_VALUE");
    assert.equal(error.code, 1001);
  });
});

describe("脱敏 B5: 不可序列化值不抛", () => {
  it("循环引用 / bigint / 函数分别产出 [unserializable: …]", () => {
    const circular: Record<string, unknown> = { big: 10n, fn: () => 1 };
    circular.self = circular;
    const detail = emitDetail(circular);
    assert.equal(detail.self, "[unserializable: cycle]");
    assert.equal(detail.big, "[unserializable: bigint]");
    assert.equal(detail.fn, "[unserializable: function]");
  });
});

describe("message 截断", () => {
  it("message 本身截 500 字符", () => {
    const { records, sink } = captureSink();
    setDefaultLogSink(sink);
    createLogger("unit").warn("m".repeat(510));
    assert.equal(records[0]!.message, `${"m".repeat(500)}…(+10)`);
  });
});

describe("detail 总量熔断", () => {
  it("序列化超 8KB → {__truncated: true, bytes}", () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) {
      wide[`k${i}`] = String(i).repeat(390);
    }
    const detail = emitDetail(wide);
    assert.equal(detail.__truncated, true);
    assert.equal(typeof detail.bytes, "number");
  });
});
