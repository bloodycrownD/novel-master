import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import {
  assertSseParseSucceededOrThrow,
  isSseParseDebugEnabled,
  recordMalformedSseLine,
} from "../../../src/infra/llm-protocol/logic/sse-parse-errors.js";
import { restoreDefaultLogSink, setDefaultLogSink } from "@novel-master/core/log";
import type { LogRecord } from "@novel-master/core/log";

/** 捕获 sink：返回 records 与还原函数（finally 恢复，防污染同文件后续用例）。 */
function captureLogs(): { readonly records: LogRecord[]; restore(): void } {
  const records: LogRecord[] = [];
  setDefaultLogSink({ write: (record) => records.push(record) });
  return { records, restore: restoreDefaultLogSink };
}

describe("sse-parse-errors", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("SSE-MAL-03: debug env 关闭时不 warn", () => {
    delete process.env.NM_DEBUG_LLM_SSE;
    delete process.env.NM_DEBUG_LLM_FETCH;
    const logs = captureLogs();
    try {
      assert.equal(isSseParseDebugEnabled(), false);
      const diag = { malformedLineCount: 0 };
      recordMalformedSseLine(diag, "{bad");
      assert.equal(diag.malformedLineCount, 1);
      assert.equal(logs.records.length, 0);
    } finally {
      logs.restore();
    }
  });

  it("SSE-MAL-03: NM_DEBUG_LLM_SSE=1 时输出 warn", () => {
    process.env.NM_DEBUG_LLM_SSE = "1";
    const logs = captureLogs();
    try {
      assert.equal(isSseParseDebugEnabled(), true);
      recordMalformedSseLine({ malformedLineCount: 0 }, "{bad-json");
      assert.equal(logs.records.length, 1);
      assert.equal(logs.records[0]!.level, "warn");
      assert.equal(logs.records[0]!.scope, "llm.sse-parse");
      assert.match(logs.records[0]!.message, /malformed JSON line/);
      // 畸形行是正文：detail 已压成 {chars, hash}，不落原文。
      assert.ok(!JSON.stringify(logs.records[0]!.detail).includes("bad-json"));
    } finally {
      logs.restore();
    }
  });

  it("零 block 且有畸形行时抛 MALFORMED_SSE", () => {
    const diag = { malformedLineCount: 2 };
    assert.throws(
      () => assertSseParseSucceededOrThrow(diag, [], "openai"),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "MALFORMED_SSE");
        assert.match(err.message, /malformed SSE line/);
        return true;
      },
    );
  });
});
