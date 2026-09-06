import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCharCount } from "../../../src/domain/format/format-char-count.js";
import { buildStreamMetricsLine } from "../../../src/domain/format/format-stream-metrics-line.js";

describe("formatCharCount", () => {
  it("uses zh-CN grouping", () => {
    assert.match(formatCharCount(1234), /1/);
  });
});

describe("buildStreamMetricsLine", () => {
  it("includes running prefix and text chars", () => {
    const line = buildStreamMetricsLine({
      running: true,
      elapsedMs: 1500,
      textChars: 42,
      thinkingChars: 0,
      totalChars: 42,
      charsPerSecond: 28,
    });
    assert.match(line, /生成中/);
    assert.match(line, /42/);
  });
});
