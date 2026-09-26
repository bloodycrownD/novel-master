import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentStreamMetricsLabel } from "@/hooks/useAgentStreamMetrics";
import {
  formatCharCount,
  formatStreamElapsed,
} from "@/hooks/useAgentStreamMetrics";

describe("useAgentStreamMetrics formatters", () => {
  it("formatStreamElapsed 在 60s 内保留一位小数", () => {
    assert.equal(formatStreamElapsed(12.34), "12.3s");
    assert.equal(formatStreamElapsed(61), "61s");
  });

  it("formatCharCount 使用 zh-CN 分组", () => {
    const formatted = formatCharCount(1234);
    assert.match(formatted, /1/);
    assert.ok(formatted.length > 3);
  });
});

describe("buildAgentStreamMetricsLabel（T-M8 文案快照）", () => {
  it("生成中 · 秒 · 输出 token · 速率全段拼接（与 mobile 一致）", () => {
    const label = buildAgentStreamMetricsLabel({
      running: true,
      elapsedMs: 12_300,
      textChars: 1_000,
      thinkingChars: 300,
      completionTokens: 1_234,
      tokenSource: "usage",
      tokensPerSecond: 45,
    });
    assert.equal(label, "生成中 · 12.3s · 输出 1,234 t · 45 t/s");
  });

  it("无速率样本时省略速率段（上次生成冻结态）", () => {
    const label = buildAgentStreamMetricsLabel({
      running: false,
      elapsedMs: 5_000,
      textChars: 0,
      thinkingChars: 42,
      completionTokens: 28,
      tokenSource: "heuristic",
      tokensPerSecond: null,
    });
    assert.equal(label, "上次生成 · 5.0s · 输出 28 t");
  });

  it("冻结态带末值速率：显示「上次生成 … · N t/s」（收尾快照，非实时衰减值）", () => {
    const label = buildAgentStreamMetricsLabel({
      running: false,
      elapsedMs: 39_200,
      textChars: 12_000,
      thinkingChars: 0,
      completionTokens: 12_000,
      tokenSource: "usage",
      tokensPerSecond: 96.7,
    });
    assert.equal(label, "上次生成 · 39.2s · 输出 12,000 t · 96.7 t/s");
  });

  it("速率数字格式：≥100 取整数、否则一位小数（无尾随 .0）", () => {
    assert.equal(
      buildAgentStreamMetricsLabel({
        running: true,
        elapsedMs: 5_000,
        textChars: 10,
        thinkingChars: 0,
        completionTokens: 600,
        tokenSource: "usage",
        tokensPerSecond: 123.4,
      }),
      "生成中 · 5.0s · 输出 600 t · 123 t/s"
    );
    assert.equal(
      buildAgentStreamMetricsLabel({
        running: true,
        elapsedMs: 5_000,
        textChars: 10,
        thinkingChars: 0,
        completionTokens: 28,
        tokenSource: "usage",
        tokensPerSecond: 5.52,
      }),
      "生成中 · 5.0s · 输出 28 t · 5.5 t/s"
    );
  });
});
