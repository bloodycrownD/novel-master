import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capMatchList,
  capUtf8Bytes,
  sliceLinesFromOffset,
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
    while (Buffer.byteLength(lines.join("\n"), "utf8") < TOOL_OUTPUT_MAX_BYTES + 5000) {
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
});
