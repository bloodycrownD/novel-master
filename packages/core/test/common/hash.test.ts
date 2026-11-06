import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fnv1aHex16 } from "../../src/common/hash.js";
import { chunkHash16 } from "../../src/infra/tokenizer/logic/token-chunk-cache.js";

describe("common/hash · fnv1aHex16", () => {
  it("恒 16 位小写 hex，确定性", () => {
    for (const sample of ["", "a", "落霞与孤鹜齐飞", "x".repeat(4096), "👩‍💻"]) {
      const hash = fnv1aHex16(sample);
      assert.match(hash, /^[0-9a-f]{16}$/, `样本 ${JSON.stringify(sample.slice(0, 12))} 形态不对`);
      assert.equal(hash, fnv1aHex16(sample));
    }
  });

  it("不同文本输出不同指纹（短中英文抽样）", () => {
    const hashes = new Set(["甲句正文", "乙句正文", "abc", "abd", "同一前缀很长很长很长很长很长很长X", "同一前缀很长很长很长很长很长很长Y"].map(fnv1aHex16));
    assert.equal(hashes.size, 6);
  });

  it("chunkHash16 与 fnv1aHex16 逐字节一致（上提后键值域不变）", () => {
    for (const sample of ["", "块一", "块二", "a".repeat(10_000), "落霞与孤鹜齐飞，秋水共长天一色。"]) {
      assert.equal(chunkHash16(sample), fnv1aHex16(sample));
    }
  });
});
