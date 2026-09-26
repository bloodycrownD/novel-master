import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCharCount } from "../../../src/domain/format/format-char-count.js";
import { buildStreamMetricsLine } from "../../../src/domain/format/format-stream-metrics-line.js";

describe("formatCharCount", () => {
  it("uses zh-CN grouping", () => {
    assert.match(formatCharCount(1234), /1/);
  });
});

describe("buildStreamMetricsLine（T-M8 文案快照）", () => {
  it("生成中 · 秒 · 输出 token · 速率全段拼接（千分位 + t/s 惯例）", () => {
    const line = buildStreamMetricsLine({
      running: true,
      elapsedMs: 12_300,
      completionTokens: 1_234,
      tokensPerSecond: 45,
    });
    assert.equal(line, "生成中 · 12.3s · 输出 1,234 t · 45 t/s");
  });

  it("无速率样本时省略速率段（仅输出 token）", () => {
    const line = buildStreamMetricsLine({
      running: false,
      elapsedMs: 61_000,
      completionTokens: 2_500,
      tokensPerSecond: null,
    });
    assert.equal(line, "上次生成 · 61s · 输出 2,500 t");
  });

  it("速率数字格式：≥100 取整数、否则一位小数", () => {
    assert.equal(
      buildStreamMetricsLine({
        running: true,
        elapsedMs: 5_000,
        completionTokens: 600,
        tokensPerSecond: 123.4,
      }),
      "生成中 · 5.0s · 输出 600 t · 123 t/s"
    );
    assert.equal(
      buildStreamMetricsLine({
        running: true,
        elapsedMs: 5_000,
        completionTokens: 28,
        tokensPerSecond: 5.52,
      }),
      "生成中 · 5.0s · 输出 28 t · 5.5 t/s"
    );
  });

  it("正文/思考不再分列（token 化改版后的形态锁定）", () => {
    const line = buildStreamMetricsLine({
      running: true,
      elapsedMs: 3_000,
      completionTokens: 90,
      tokensPerSecond: 30,
    });
    assert.doesNotMatch(line, /正文/);
    assert.doesNotMatch(line, /思考/);
    assert.doesNotMatch(line, /字/);
  });
});
