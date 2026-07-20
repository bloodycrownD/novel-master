/**
 * 划词批注高亮纯算法（迁并双端；T-X2-4 / Spec Steps 7–8）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findAllOccurrences,
  groupAnnotateIdsByOriginalText,
  parseAnnotateIdsAttr,
  sortAnnotateTextsLongestFirst,
} from "../../src/domain/chat/logic/annotate-highlight.js";

describe("findAllOccurrences", () => {
  it("重复片段全部命中（非重叠）", () => {
    assert.deepEqual(findAllOccurrences("aaabaaa", "aa"), [0, 4]);
    assert.deepEqual(findAllOccurrences("hello hello", "hello"), [0, 6]);
  });

  it("空 needle → 空", () => {
    assert.deepEqual(findAllOccurrences("abc", ""), []);
  });

  it("无匹配 → 空", () => {
    assert.deepEqual(findAllOccurrences("abc", "z"), []);
  });
});

describe("groupAnnotateIdsByOriginalText", () => {
  it("同文聚合多 id；空原文与空 id 跳过", () => {
    const map = groupAnnotateIdsByOriginalText([
      { id: "a", originalText: "hello" },
      { id: "b", originalText: "hello" },
      { id: "c", originalText: "other" },
      { id: "d", originalText: "" },
      { id: "", originalText: "skip" },
    ]);
    assert.deepEqual(map.get("hello"), ["a", "b"]);
    assert.deepEqual(map.get("other"), ["c"]);
    assert.equal(map.has(""), false);
    assert.equal(map.has("skip"), false);
  });
});

describe("parseAnnotateIdsAttr", () => {
  it("解析逗号分隔 id", () => {
    assert.deepEqual(parseAnnotateIdsAttr("a,b , c"), ["a", "b", "c"]);
    assert.deepEqual(parseAnnotateIdsAttr(""), []);
    assert.deepEqual(parseAnnotateIdsAttr(null), []);
  });
});

describe("sortAnnotateTextsLongestFirst", () => {
  it("长 needle 优先于短 needle（重叠/嵌套）", () => {
    assert.deepEqual(sortAnnotateTextsLongestFirst(["ab", "a", "abc", "abcd"]), [
      "abcd",
      "abc",
      "ab",
      "a",
    ]);
    assert.deepEqual(sortAnnotateTextsLongestFirst(["短", "更长短串"]), [
      "更长短串",
      "短",
    ]);
  });
});
