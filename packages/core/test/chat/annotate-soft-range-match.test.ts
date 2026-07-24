/**
 * T-AR4–T-AR6：源文件宽松行列估算、窗口优先匹配、plain 多行 needle（H12）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findAllOccurrences,
  findAnnotateOccurrenceInSource,
  normalizeAnnotateNeedle,
  normalizeAnnotateNeedleStripNewlines,
  selectAnnotateOccurrenceStarts,
} from "@/domain/chat/logic/annotate-highlight.js";
import {
  ANNOTATE_SOFT_RANGE_LINE_PADDING,
  estimateSoftRangeFromOriginalText,
  estimateSoftRangeFromPlainOffsets,
  expandSoftRangeOnce,
  sliceSourceBySoftRange,
} from "@/domain/chat/logic/annotate-source-range.js";

describe("T-AR4 plain 选区宽松窗口", () => {
  it("窗口覆盖选区行且 ≥ 默认 padding", () => {
    // 行1–7；选区在第 4 行
    const source = ["L1", "L2", "L3", "TARGET HERE", "L5", "L6", "L7"].join(
      "\n",
    );
    const selStart = source.indexOf("TARGET");
    const selEnd = selStart + "TARGET".length;
    const range = estimateSoftRangeFromPlainOffsets(
      source,
      selStart,
      selEnd,
    );
    assert.equal(ANNOTATE_SOFT_RANGE_LINE_PADDING, 2);
    // 精确行 4 → padding ±2 → 2..6
    assert.equal(range.startLine, 2);
    assert.equal(range.endLine, 6);
    assert.ok(range.startLine <= 4 && range.endLine >= 4);
    assert.ok(4 - range.startLine >= ANNOTATE_SOFT_RANGE_LINE_PADDING);
    assert.ok(range.endLine - 4 >= ANNOTATE_SOFT_RANGE_LINE_PADDING);

    const sliced = sliceSourceBySoftRange(source, range);
    assert.match(sliced.text, /TARGET HERE/);
    assert.ok(!sliced.text.includes("L1") || range.startLine === 1);
  });

  it("estimateSoftRangeFromOriginalText 定位 + padding", () => {
    const source = "aaa\nbbb\nfind-me\nccc\nddd\n";
    const range = estimateSoftRangeFromOriginalText(source, "find-me");
    assert.ok(range);
    assert.equal(range!.startLine, 1);
    assert.equal(range!.endLine, 5);
  });
});

describe("T-AR5 窗口内命中优先于文外相同原文", () => {
  it("同文两处时返回窗口内下标与 strategy=window", () => {
    const source = [
      "noise",
      "SAME",
      "mid",
      "mid2",
      "SAME",
      "tail",
    ].join("\n");
    // 窗口对准第二处 SAME（行 5）±0 以便严格窗口
    const hit = findAnnotateOccurrenceInSource(source, "SAME", {
      startLine: 4,
      endLine: 6,
    });
    assert.ok(hit);
    assert.equal(hit!.strategy, "window");
    const secondAt = source.lastIndexOf("SAME");
    assert.equal(hit!.index, secondAt);

    // 无行列 → 全文首次
    const full = findAnnotateOccurrenceInSource(source, "SAME");
    assert.ok(full);
    assert.equal(full!.strategy, "full");
    assert.equal(full!.index, source.indexOf("SAME"));
  });

  it("窗口未命中时扩大一次再命中", () => {
    const source = ["a", "b", "c", "HIT", "e", "f", "g"].join("\n");
    // 窗口在 HIT 外；扩大 ±2 后可盖住行 4
    const hit = findAnnotateOccurrenceInSource(
      source,
      "HIT",
      { startLine: 6, endLine: 7 },
      { linePadding: 2 },
    );
    assert.ok(hit);
    assert.equal(hit!.strategy, "expanded");
    assert.equal(hit!.index, source.indexOf("HIT"));
  });
});

describe("T-AR6 plain/pre 多行 originalText 可命中（H12）", () => {
  it("normalizeAnnotateNeedle 保留 \\n；删 tab；表域可另删换行", () => {
    assert.equal(normalizeAnnotateNeedle("a\tb\nc"), "ab\nc");
    assert.equal(normalizeAnnotateNeedle("  a\n\nb  "), "a\n\nb");
    assert.equal(normalizeAnnotateNeedleStripNewlines("a\tb\nc"), "abc");
  });

  it("含 \\n 的 needle 在保留换行的 haystack 中可 findAll", () => {
    const haystack = "pre\nline1\nline2\npost";
    const needle = normalizeAnnotateNeedle("line1\nline2");
    assert.equal(needle, "line1\nline2");
    assert.deepEqual(findAllOccurrences(haystack, needle), [4]);
  });

  it("有 preferredOrdinal 时只保留对应出现序次（多处匹配收敛）", () => {
    const starts = findAllOccurrences("xx foo yy foo zz", "foo");
    assert.deepEqual(starts, [3, 10]);
    assert.deepEqual(selectAnnotateOccurrenceStarts(starts, 1), [10]);
    assert.deepEqual(selectAnnotateOccurrenceStarts(starts, 0), [3]);
    assert.deepEqual(selectAnnotateOccurrenceStarts(starts, null), [3, 10]);
  });

  it("findAnnotateOccurrenceInSource 多行原文命中", () => {
    const source = "intro\nfoo\nbar\noutro";
    const hit = findAnnotateOccurrenceInSource(source, "foo\nbar", {
      startLine: 1,
      endLine: 4,
    });
    assert.ok(hit);
    assert.equal(hit!.strategy, "window");
    assert.equal(hit!.index, source.indexOf("foo\nbar"));
    assert.equal(source.slice(hit!.index, hit!.index + hit!.length), "foo\nbar");
  });

  it("expandSoftRangeOnce 再扩一行窗", () => {
    const source = "1\n2\n3\n4\n5\n6\n7";
    const expanded = expandSoftRangeOnce(
      { startLine: 3, endLine: 5 },
      source,
      { linePadding: 2 },
    );
    assert.equal(expanded.startLine, 1);
    assert.equal(expanded.endLine, 7);
  });
});
