import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base64ToBytes, bytesToBase64 } from "../../src/common/base64.js";

describe("common/base64", () => {
  it("bytesToBase64 / base64ToBytes 往返", () => {
    const bytes = Uint8Array.from([0, 1, 2, 254, 255]);
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  });

  it("跨 0x8000 分片仍保持字节序", () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 3 }, (_, index) => index % 256);
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  });
});
