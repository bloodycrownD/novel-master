import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentStreamMetricsLabel } from "@/features/chat/AgentStreamMetricsBar";
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

describe("buildAgentStreamMetricsLabel", () => {
  it("运行中显示生成中、正文、思考与速率", () => {
    const label = buildAgentStreamMetricsLabel({
      running: true,
      elapsedMs: 10_000,
      textChars: 5,
      thinkingChars: 100,
      totalChars: 105,
      charsPerSecond: 10.5,
    });
    assert.match(label, /生成中/);
    assert.match(label, /正文/);
    assert.match(label, /思考/);
    assert.doesNotMatch(label, /工具/);
  });

  it("结束后显示上次生成", () => {
    const label = buildAgentStreamMetricsLabel({
      running: false,
      elapsedMs: 5000,
      textChars: 0,
      thinkingChars: 42,
      totalChars: 42,
      charsPerSecond: 8.4,
    });
    assert.match(label, /上次生成/);
  });
});
