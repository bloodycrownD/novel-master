import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBinaryFilePath, isImageFilePath } from "../../src/common/file.js";

describe("isBinaryFilePath", () => {
  it("按扩展名判二进制；大小写 / 反斜杠 / 无扩展名", () => {
    assert.equal(isBinaryFilePath("/a/photo.PNG"), true);
    assert.equal(isBinaryFilePath("C:\\a\\archive.ZIP"), true);
    assert.equal(isBinaryFilePath("notes.md"), false);
    assert.equal(isBinaryFilePath("noext"), false);
    assert.equal(isBinaryFilePath("dir.with.dot/file"), false);
  });
});

describe("isImageFilePath", () => {
  it("图片判据与二进制分离；pdf 不算图片", () => {
    assert.equal(isImageFilePath("x.JPG"), true);
    assert.equal(isImageFilePath("x.png"), true);
    assert.equal(isImageFilePath("x.pdf"), false);
    assert.equal(isImageFilePath("x"), false);
  });
});
