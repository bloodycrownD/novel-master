import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countOccurrences,
  longestCommonSubstring,
  MAX_LCS_SNIPPET_CHARS,
  MIN_LCS_LENGTH,
  truncateLcsSnippet,
} from "../../src/domain/vfs/logic/longest-common-substring.js";

describe("longestCommonSubstring", () => {
  it("T-LCS-01: finds non-empty substring for whitespace difference", () => {
    const a = "function hello() {    return 1; }";
    const b = "function hello() { return 1; }";
    const result = longestCommonSubstring(a, b);
    assert.ok(result.length >= MIN_LCS_LENGTH);
    assert.ok(b.includes(result.substring));
  });

  it("T-LCS-02: unrelated strings yield short substring", () => {
    const result = longestCommonSubstring("abc", "xyz");
    assert.ok(result.length < MIN_LCS_LENGTH);
  });

  it("T-LCS-03: countOccurrences counts multiple hits", () => {
    assert.equal(countOccurrences("aa aa aa", "aa"), 3);
  });

  it("T-LCS-04: truncateLcsSnippet caps length", () => {
    const long = "x".repeat(MAX_LCS_SNIPPET_CHARS + 10);
    const truncated = truncateLcsSnippet(long);
    assert.ok(truncated.endsWith("…"));
    assert.ok(truncated.length <= MAX_LCS_SNIPPET_CHARS + 1);
  });
});

describe("longestCommonSubstring 中文引号场景", () => {
  it("T-LCS-CN: 弯引号 vs 直引号能找到公共子串（诊断可读性）", () => {
    // edit 失败时 LCS 诊断要把「除了引号其他都对得上」这件事摆出来，
    // 所以这里验证弯引号与直引号之间至少能命中一段不含引号的公共子串。
    const fileContent = `他说“你好”`;
    const oldString = `他说“你好”`;
    const result = longestCommonSubstring(oldString, fileContent);
    assert.ok(result.length >= MIN_LCS_LENGTH);
    assert.ok(fileContent.includes(result.substring));
    // 主体「你好」应该出现在公共子串里（撇开引号差异）
    assert.ok(result.substring.includes("你好"));
  });
});
