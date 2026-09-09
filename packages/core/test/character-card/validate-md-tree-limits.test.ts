/**
 * validateMdTreeLimits / character-card-limits 纯函数单测。
 *
 * 覆盖：条目数/单文件/总量三道闸各自抛 TOO_LARGE、恰在上限内放行、
 * utf8ByteLength 与 TextEncoder 基准一致（中文、emoji、落单代理）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateMdTreeLimits } from "../../src/domain/character-card/logic/validate-md-tree-limits.js";
import {
  CHARACTER_CARD_MAX_FILE_COUNT,
  CHARACTER_CARD_MAX_SINGLE_FILE_BYTES,
  CHARACTER_CARD_MAX_TOTAL_CONTENT_BYTES,
  utf8ByteLength,
} from "../../src/domain/character-card/logic/character-card-limits.js";
import { CharacterCardError } from "../../src/errors/character-card-errors.js";

/** 断言同步抛出 TOO_LARGE 且报错信息包含实际值与上限值。 */
function assertTooLarge(
  fn: () => void,
  actualNeedle: string,
  limitNeedle: string
): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof CharacterCardError);
    assert.equal(error.code, "TOO_LARGE");
    assert.ok(error.message.includes(actualNeedle), `信息应含 ${actualNeedle}：${error.message}`);
    assert.ok(error.message.includes(limitNeedle), `信息应含 ${limitNeedle}：${error.message}`);
    return true;
  });
}

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

describe("validateMdTreeLimits", () => {
  it("条目数超上限抛 TOO_LARGE（带实际值与上限值）", () => {
    const files = new Map<string, string>();
    for (let i = 0; i <= CHARACTER_CARD_MAX_FILE_COUNT; i++) {
      files.set(`f${i}.md`, "x");
    }
    assertTooLarge(
      () => validateMdTreeLimits(files),
      String(files.size),
      String(CHARACTER_CARD_MAX_FILE_COUNT)
    );
  });

  it("单文件超上限抛 TOO_LARGE（UTF-8 字节计量，报错带实际与上限）", () => {
    const oversized = "x".repeat(CHARACTER_CARD_MAX_SINGLE_FILE_BYTES + 1);
    const files = new Map([["oversized.md", oversized]]);
    assertTooLarge(
      () => validateMdTreeLimits(files),
      String(CHARACTER_CARD_MAX_SINGLE_FILE_BYTES + 1),
      String(CHARACTER_CARD_MAX_SINGLE_FILE_BYTES)
    );
  });

  it("总量超上限抛 TOO_LARGE（多个不超单文件闸的条目累加）", () => {
    // 每条 7MiB（< 8MiB 单文件闸），5 条合计 35MiB > 32MiB 总量闸
    const chunk = "x".repeat(7 * 1024 * 1024);
    const files = new Map<string, string>();
    for (let i = 0; i < 5; i++) {
      files.set(`part${i}.md`, chunk);
    }
    assert.throws(
      () => validateMdTreeLimits(files),
      (error: unknown) => {
        assert.ok(error instanceof CharacterCardError);
        assert.equal(error.code, "TOO_LARGE");
        assert.ok(error.message.includes("总量上限"));
        return true;
      }
    );
  });

  it("恰在上限内放行：条目数、单文件、总量均不超", () => {
    const files = new Map<string, string>();
    for (let i = 0; i < 100; i++) {
      files.set(`f${i}.md`, "正文");
    }
    assert.doesNotThrow(() => validateMdTreeLimits(files));
  });
});
