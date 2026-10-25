import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { integerAtLeast, stringOrEmpty } from "../../src/common/coerce.js";

describe("stringOrEmpty", () => {
  it("字符串原样返回；非字符串 → 空串", () => {
    assert.equal(stringOrEmpty("x"), "x");
    assert.equal(stringOrEmpty(""), "");
    assert.equal(stringOrEmpty(null), "");
    assert.equal(stringOrEmpty(undefined), "");
    assert.equal(stringOrEmpty(42), "");
    assert.equal(stringOrEmpty({ a: 1 }), "");
  });
});

describe("integerAtLeast", () => {
  it("整数 / 数字字符串且达到 min → 数字", () => {
    assert.equal(integerAtLeast(3, 1), 3);
    assert.equal(integerAtLeast(0, 0), 0);
    assert.equal(integerAtLeast("3", 1), 3);
    assert.equal(integerAtLeast(" 3 ", 1), 3);
  });

  it("小数 / 非数字 / 越界 / NaN / Infinity → undefined", () => {
    assert.equal(integerAtLeast(3.5, 1), undefined);
    assert.equal(integerAtLeast(0, 1), undefined);
    assert.equal(integerAtLeast("3.5", 1), undefined);
    assert.equal(integerAtLeast("", 0), undefined);
    assert.equal(integerAtLeast(" ", 0), undefined);
    assert.equal(integerAtLeast("x", 0), undefined);
    assert.equal(integerAtLeast(Number.NaN, 0), undefined);
    assert.equal(integerAtLeast(Number.POSITIVE_INFINITY, 0), undefined);
    assert.equal(integerAtLeast(true, 0), undefined);
  });
});
