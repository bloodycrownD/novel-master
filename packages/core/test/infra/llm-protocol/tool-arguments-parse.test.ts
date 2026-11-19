import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  ToolArguments  } from "../../../src/infra/llm-protocol/logic/tool-arguments-parse.js";

describe("tool-arguments-parse", () => {
  it("空字符串返回空对象", () => {
    assert.deepEqual(ToolArguments.tryParseJson(""), { ok: true, value: {} });
  });

  it("tryParse: 非法 JSON 返回 ok:false", () => {
    assert.deepEqual(ToolArguments.tryParseJson("{not-json"), {
      ok: false,
      raw: "{not-json",
    });
  });
});
