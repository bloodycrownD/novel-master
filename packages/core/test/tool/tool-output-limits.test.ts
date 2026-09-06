import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capMatchList,
  capUtf8Bytes,
  capUtf8BytesFill,
  sliceLinesFromOffset,
  sliceUtf8BytePrefix,
  TOOL_OUTPUT_MAX_BYTES,
  TOOL_OUTPUT_MAX_LINES,
  TOOL_OUTPUT_MAX_MATCHES,
  truncateLine,
} from "../../src/domain/tool/logic/tool-output-limits.js";

describe("tool-output-limits", () => {
  it("T1: sliceLinesFromOffset returns 2000 lines by default", () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line-${i + 1}`);
    const { slice, totalLines, nextOffset } = sliceLinesFromOffset(lines, 1);
    assert.equal(slice.length, TOOL_OUTPUT_MAX_LINES);
    assert.equal(totalLines, 2500);
    assert.equal(nextOffset, TOOL_OUTPUT_MAX_LINES + 1);
  });

  it("T1: capUtf8Bytes stops at 50KB", () => {
    const line = "x".repeat(1000);
    const lines: string[] = [];
    while (new TextEncoder().encode(lines.join("\n")).byteLength < TOOL_OUTPUT_MAX_BYTES + 5000) {
      lines.push(line);
    }
    const capped = capUtf8Bytes(lines);
    assert.ok(capped.bytesUsed <= TOOL_OUTPUT_MAX_BYTES);
    assert.equal(capped.truncated, true);
  });

  it("T1: capMatchList caps at 100 items", () => {
    const items = Array.from({ length: 150 }, (_, i) => i);
    const capped = capMatchList(items, TOOL_OUTPUT_MAX_MATCHES, (n) => String(n));
    assert.equal(capped.items.length, 100);
    assert.equal(capped.total, 150);
    assert.equal(capped.truncated, true);
  });

  it("truncateLine adds suffix for long lines", () => {
    const long = "a".repeat(2500);
    const { line, truncated } = truncateLine(long);
    assert.equal(truncated, true);
    assert.ok(line.includes("line truncated"));
  });

  it("sliceUtf8BytePrefix 截到字节预算且不切半个字符（多字节与代理对）", () => {
    // ASCII：预算内全量、预算外精确截断。
    assert.equal(sliceUtf8BytePrefix("abcdef", 3), "abc");
    assert.equal(sliceUtf8BytePrefix("abcdef", 100), "abcdef");
    assert.equal(sliceUtf8BytePrefix("abcdef", 0), "");
    // 中文 3 字节/字符：预算 7 只装 2 个整字（6B），不切第 3 个字的中间。
    assert.equal(sliceUtf8BytePrefix("你好呀", 7), "你好");
    // 代理对（emoji 4B/字符）：不切半个代理对（预算 6 只装 1 个 emoji）。
    assert.equal(sliceUtf8BytePrefix("\u{1F600}\u{1F601}", 6), "\u{1F600}");
  });

  it("T-R1 前置: capUtf8BytesFill 预算内全收（与 capUtf8Bytes 一致），无截断标记", () => {
    const lines = ["abc", "def", "中文行"];
    const filled = capUtf8BytesFill(lines, 100);
    assert.deepEqual(filled.lines, lines);
    assert.equal(filled.truncated, false);
    assert.equal(filled.lastLinePartial, false);
  });

  it("T-R1 前置: capUtf8BytesFill 单行超预算截到预算点（不整行丢弃、不切半字符）", () => {
    // 单行 300KB > 50KB：保留 51200B 前缀（'a' 1B/字符），lastLinePartial。
    const single = "a".repeat(300 * 1024);
    const filled = capUtf8BytesFill([single]);
    assert.equal(filled.truncated, true);
    assert.equal(filled.lastLinePartial, true);
    assert.equal(filled.lines.length, 1);
    const used = new TextEncoder().encode(filled.lines[0]).byteLength;
    assert.equal(used, TOOL_OUTPUT_MAX_BYTES);
    // 多字节单行：截断点不切半个字符（'你' 3B/字，51200 % 3 == 2 → 51198B）。
    const cjk = "你".repeat(100 * 1024);
    const filledCjk = capUtf8BytesFill([cjk]);
    const usedCjk = new TextEncoder().encode(filledCjk.lines[0]).byteLength;
    assert.ok(usedCjk <= TOOL_OUTPUT_MAX_BYTES);
    assert.equal(usedCjk % 3, 0, "不应切在多字节字符中间");
    assert.ok(usedCjk >= TOOL_OUTPUT_MAX_BYTES - 4, "应尽量填满预算");
  });

  it("T-R1 前置: capUtf8BytesFill 多行预算耗尽时末行截断、剩余预算为零时整行丢弃", () => {
    // 行 1-2 含分隔符共用 9B，行 3（9+1+6>11）触发截断：remaining=11-9-1=1
    // → 'a' 1B 前缀保留。
    const partial = capUtf8BytesFill(["abcd", "efgh", "abcdef"], 11);
    assert.deepEqual(partial.lines, ["abcd", "efgh", "a"]);
    assert.equal(partial.truncated, true);
    assert.equal(partial.lastLinePartial, true);
    // 预算恰好被前两行（含分隔符）用尽：行 3 remaining=9-9-1=-1 → 整行
    // 丢弃，lastLinePartial=false（续读从该行重新开始，预算重置可整行读出）。
    const dropped = capUtf8BytesFill(["abcd", "efgh", "abcdef"], 9);
    assert.deepEqual(dropped.lines, ["abcd", "efgh"]);
    assert.equal(dropped.truncated, true);
    assert.equal(dropped.lastLinePartial, false);
  });
});
