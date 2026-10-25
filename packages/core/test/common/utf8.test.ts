import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { utf8ByteLength } from "../../src/common/utf8.js";

describe("utf8ByteLength", () => {
  it("与 TextEncoder 基准一致：ASCII / 中文 / emoji / 落单代理", () => {
    const reference = new TextEncoder();
    const samples = [
      "",
      "hello",
      "你好，世界书！",
      "👩‍💻 emoji 组合",
      "a😀b",
      // 落单高位代理（TextEncoder 替换为 U+FFFD，3 字节）
      "x\uD800y",
      // 落单低位代理
      "x\uDFFFy",
    ];
    for (const sample of samples) {
      assert.equal(
        utf8ByteLength(sample),
        reference.encode(sample).byteLength,
        `样本 ${JSON.stringify(sample)} 应与 TextEncoder 一致`
      );
    }
  });

  it("中文按每字符 3 字节计量", () => {
    assert.equal(utf8ByteLength("中"), 3);
    assert.equal(utf8ByteLength("中".repeat(10)), 30);
  });
});
