import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import {
  assertSseParseSucceededOrThrow,
  isSseParseDebugEnabled,
  recordMalformedSseLine,
} from "../../../src/infra/llm-protocol/logic/sse-parse-errors.js";

describe("sse-parse-errors", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("SSE-MAL-03: debug env 关闭时不 warn", () => {
    delete process.env.NM_DEBUG_LLM_SSE;
    delete process.env.NM_DEBUG_LLM_FETCH;
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(String(args[0]));
    };
    try {
      assert.equal(isSseParseDebugEnabled(), false);
      const diag = { malformedLineCount: 0 };
      recordMalformedSseLine(diag, "{bad");
      assert.equal(diag.malformedLineCount, 1);
      assert.equal(warns.length, 0);
    } finally {
      console.warn = original;
    }
  });

  it("SSE-MAL-03: NM_DEBUG_LLM_SSE=1 时输出 warn", () => {
    process.env.NM_DEBUG_LLM_SSE = "1";
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(String(args[0]));
    };
    try {
      assert.equal(isSseParseDebugEnabled(), true);
      recordMalformedSseLine({ malformedLineCount: 0 }, "{bad-json");
      assert.equal(warns.length, 1);
      assert.match(warns[0]!, /malformed JSON line/);
    } finally {
      console.warn = original;
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
