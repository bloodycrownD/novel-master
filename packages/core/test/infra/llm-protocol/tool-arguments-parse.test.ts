import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import { parseToolArgumentsJson } from "../../../src/infra/llm-protocol/logic/tool-arguments-parse.js";

describe("tool-arguments-parse", () => {
  it("空字符串返回空对象", () => {
    assert.deepEqual(parseToolArgumentsJson("", "openai"), {});
  });

  it("TU-04: 非法 JSON 抛 INVALID_TOOL_ARGUMENTS", () => {
    assert.throws(
      () => parseToolArgumentsJson("{not-json", "gemini"),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "INVALID_TOOL_ARGUMENTS");
        return true;
      },
    );
  });
});
