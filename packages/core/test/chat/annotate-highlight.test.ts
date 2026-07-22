/**
 * 划词批注高亮纯算法（迁并双端；T-X2-4 / Spec Steps 7–8；
 * 跨节点扁平索引 T-XN1 / T-XN1b / T-XN1c）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFlatTextIndex,
  findAllOccurrences,
  groupAnnotateIdsByOriginalText,
  mapFlatRangeToSegments,
  normalizeAnnotateNeedle,
  normalizeAnnotateSegmentText,
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

describe("normalizeAnnotateNeedle / normalizeAnnotateSegmentText", () => {
  it("needle：NBSP→space 且 trim；空则跳过", () => {
    assert.equal(normalizeAnnotateNeedle(`\u00a0hello\u00a0`), "hello");
    assert.equal(normalizeAnnotateNeedle("  \u00a0  "), "");
  });

  it("segment：仅 NBSP→space，不 trim", () => {
    assert.equal(normalizeAnnotateSegmentText(`  a\u00a0b  `), "  a b  ");
  });
});

describe("T-XN1 buildFlatTextIndex + mapFlatRangeToSegments", () => {
  it("跨 segment 直拼匹配 hello → 两段局部区间", () => {
    const index = buildFlatTextIndex(["hel", "lo"]);
    assert.equal(index.haystack, "hello");
    const needle = normalizeAnnotateNeedle("hello");
    assert.equal(needle, "hello");
    const hits = findAllOccurrences(index.haystack, needle);
    assert.deepEqual(hits, [0]);
    const ranges = mapFlatRangeToSegments(
      hits[0]!,
      hits[0]! + needle.length,
      index,
    );
    assert.deepEqual(ranges, [
      { segmentIndex: 0, start: 0, end: 3 },
      { segmentIndex: 1, start: 0, end: 2 },
    ]);
  });
});

describe("T-XN1b 跨 p / br / 单元格切断不误命中", () => {
  it("分属不同 block run 时 lohe（前段尾+后段首）零命中", () => {
    // 调用方按切断点分批：各自建索引（D1 方案 a）
    const p1 = buildFlatTextIndex(["hel", "lo"]);
    const p2 = buildFlatTextIndex(["he", "llo"]);
    const crossNeedle = normalizeAnnotateNeedle("lohe");
    assert.deepEqual(findAllOccurrences(p1.haystack, crossNeedle), []);
    assert.deepEqual(findAllOccurrences(p2.haystack, crossNeedle), []);
    // 对照：若错误跨 p 直拼则会误命中
    const wronglyJoined = buildFlatTextIndex(["hel", "lo", "he", "llo"]);
    assert.deepEqual(findAllOccurrences(wronglyJoined.haystack, crossNeedle), [
      3,
    ]);
  });
});

describe("T-XN1c segment 归一 1:1 与 haystack 不 trim", () => {
  it("NBSP 归一后等长；flat 局部 offset ≡ raw 下标；haystack 未 trim", () => {
    const raw = `  a\u00a0b  `;
    const normalized = normalizeAnnotateSegmentText(raw);
    assert.equal(normalized.length, raw.length);
    assert.equal(normalized, "  a b  ");

    const index = buildFlatTextIndex([raw]);
    assert.equal(index.haystack, "  a b  ");
    assert.notEqual(index.haystack, index.haystack.trim());

    const needle = normalizeAnnotateNeedle("a b");
    const hits = findAllOccurrences(index.haystack, needle);
    assert.deepEqual(hits, [2]);
    const ranges = mapFlatRangeToSegments(
      hits[0]!,
      hits[0]! + needle.length,
      index,
    );
    assert.deepEqual(ranges, [{ segmentIndex: 0, start: 2, end: 5 }]);
    // local offset 即 raw nodeValue 下标（1:1）
    assert.equal(raw.slice(ranges[0]!.start, ranges[0]!.end), `a\u00a0b`);
  });
});
