import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { truncateText } from "../../src/common/text.js";

describe("truncateText", () => {
  it("未超长原样返回（含恰好等于上限）", () => {
    assert.equal(truncateText("abc", 5), "abc");
    assert.equal(truncateText("abc", 3), "abc");
    assert.equal(truncateText("", 0), "");
  });

  it("超长保留前 maxChars 个字符并追加省略号", () => {
    assert.equal(truncateText("abcdef", 3), "abc…");
    assert.equal(truncateText("abcdef", 0), "…");
  });

  it("按 UTF-16 码元计数（与 slice 既有口径一致）", () => {
    assert.equal(truncateText("你好世界", 2), "你好…");
    assert.equal(truncateText("😀😀😀", 2), "😀…");
  });
});
