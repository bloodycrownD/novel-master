import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveRegexGroupId } from "../../../src/domain/format/derive-regex-group-id.js";
import { formatCharCount } from "../../../src/domain/format/format-char-count.js";
import { buildStreamMetricsLine } from "../../../src/domain/format/format-stream-metrics-line.js";

describe("formatCharCount", () => {
  it("uses zh-CN grouping", () => {
    assert.match(formatCharCount(1234), /1/);
  });
});

describe("deriveRegexGroupId", () => {
  it("slugifies display name", () => {
    assert.equal(deriveRegexGroupId("对话清洗", new Set()), "对话清洗");
  });

  it("deduplicates when id is taken", () => {
    const taken = new Set(["dialog-clean"]);
    assert.equal(deriveRegexGroupId("Dialog Clean", taken), "dialog-clean-2");
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
