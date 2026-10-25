import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJsonText } from "../../src/common/json.js";

describe("parseJsonText", () => {
  it("剥 UTF-8 BOM 后解析", () => {
    const result = parseJsonText(`\uFEFF{"a":1}`);
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepEqual(result.value, { a: 1 });
  });

  it("非法 JSON 返回 Err 而不是抛异常", () => {
    const result = parseJsonText("{");
    assert.equal(result.ok, false);
  });
});
