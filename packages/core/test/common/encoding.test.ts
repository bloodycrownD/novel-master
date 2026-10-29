import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base64ToBytes, bytesToBase64, utf8ByteLength } from "../../src/common/encoding.js";

describe("common/encoding · base64", () => {
  it("bytesToBase64 / base64ToBytes 往返", () => {
    const bytes = Uint8Array.from([0, 1, 2, 254, 255]);
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  });

  it("跨 0x8000 分片仍保持字节序", () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 3 }, (_, index) => index % 256);
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  });
});

describe("common/encoding · utf8ByteLength", () => {
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
