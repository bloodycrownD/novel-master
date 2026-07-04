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
