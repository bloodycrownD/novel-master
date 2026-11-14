import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "../../../src/errors/app-error.js";
import {
  parseToolArgumentsJson,
  tryParseToolArgumentsJson,
} from "../../../src/infra/llm-protocol/logic/tool-arguments-parse.js";

describe("tool-arguments-parse", () => {
  it("空字符串返回空对象", () => {
    assert.deepEqual(parseToolArgumentsJson("", "openai"), {});
    assert.deepEqual(tryParseToolArgumentsJson(""), { ok: true, value: {} });
  });

  it("tryParse: 非法 JSON 返回 ok:false", () => {
    assert.deepEqual(tryParseToolArgumentsJson("{not-json"), {
      ok: false,
      raw: "{not-json",
    });
  });

  it("TU-04: 非法 JSON 抛 INVALID_TOOL_ARGUMENTS", () => {
    assert.throws(
      () => parseToolArgumentsJson("{not-json", "gemini"),
      (err: unknown) => {
        assert.ok(isAppError(err, "PROVIDER_INVALID_TOOL_ARGUMENTS"));
        return true;
      },
    );
  });
});
