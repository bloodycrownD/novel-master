import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Guards } from "../../src/common/guards.js";

describe("common/guards · Guards.isRecord", () => {
  it("普通对象 → true；null / 数组 / 原始值 → false", () => {
    assert.equal(Guards.isRecord({}), true);
    assert.equal(Guards.isRecord({ a: 1 }), true);
    // 只看 typeof + 非数组，不校验原型。
    assert.equal(Guards.isRecord(new Date()), true);
    assert.equal(Guards.isRecord(null), false);
    assert.equal(Guards.isRecord(undefined), false);
    assert.equal(Guards.isRecord([]), false);
    assert.equal(Guards.isRecord([1]), false);
    assert.equal(Guards.isRecord("x"), false);
    assert.equal(Guards.isRecord(42), false);
    assert.equal(Guards.isRecord(true), false);
  });
});

describe("common/guards · Guards.isNonEmptyString", () => {
  it("长度 > 0 的字符串 → true；空串 / 非字符串 → false", () => {
    assert.equal(Guards.isNonEmptyString("x"), true);
    assert.equal(Guards.isNonEmptyString(" x "), true);
    // 只判长度：空白串算非空；trim 口径走 Coerce.nonEmptyText。
    assert.equal(Guards.isNonEmptyString(" "), true);
    assert.equal(Guards.isNonEmptyString(""), false);
    assert.equal(Guards.isNonEmptyString(null), false);
    assert.equal(Guards.isNonEmptyString(undefined), false);
    assert.equal(Guards.isNonEmptyString(0), false);
    assert.equal(Guards.isNonEmptyString([]), false);
  });
});

describe("common/guards · Guards.isBinaryFilePath", () => {
  it("按扩展名判二进制；大小写 / 反斜杠 / 无扩展名", () => {
    assert.equal(Guards.isBinaryFilePath("/a/photo.PNG"), true);
    assert.equal(Guards.isBinaryFilePath("C:\\a\\archive.ZIP"), true);
    assert.equal(Guards.isBinaryFilePath("notes.md"), false);
    assert.equal(Guards.isBinaryFilePath("noext"), false);
    assert.equal(Guards.isBinaryFilePath("dir.with.dot/file"), false);
    assert.equal(Guards.isBinaryFilePath(""), false);
    assert.equal(Guards.isBinaryFilePath(".png"), false);
    assert.equal(Guards.isBinaryFilePath("trailing."), false);
  });
});

describe("common/guards · Guards.isImageFilePath", () => {
  it("图片判据与二进制分离；pdf 不算图片", () => {
    assert.equal(Guards.isImageFilePath("x.JPG"), true);
    assert.equal(Guards.isImageFilePath("x.png"), true);
    assert.equal(Guards.isImageFilePath("x.pdf"), false);
    assert.equal(Guards.isImageFilePath("x"), false);
    assert.equal(Guards.isImageFilePath("xd.pn"), false);
  });
});
