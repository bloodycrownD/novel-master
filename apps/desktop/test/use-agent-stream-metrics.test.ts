import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentStreamMetricsLabel } from "../renderer/features/chat/AgentStreamMetricsBar.js";
import {
  formatCharCount,
  formatStreamElapsed,
} from "../renderer/hooks/useAgentStreamMetrics.js";

describe("useAgentStreamMetrics formatters", () => {
  it("formatStreamElapsed 在 60s 内保留一位小数", () => {
    assert.equal(formatStreamElapsed(12.34), "12.3s");
    assert.equal(formatStreamElapsed(90), "90s");
  });

  it("formatCharCount 使用 zh-CN 分组", () => {
    const formatted = formatCharCount(1234);
    assert.match(formatted, /1/);
    assert.ok(formatted.length > 3);
  });
});

describe("AgentStreamMetricsBar", () => {
  it("assistant 落库后展示上次生成而非工具调用生成中", () => {
    const label = buildAgentStreamMetricsLabel({
      running: false,
      streamKind: "tool",
      toolUseChars: 1234,
      textChars: 0,
      thinkingChars: 0,
      elapsedMs: 5200,
      totalChars: 1234,
      charsPerSecond: 237,
    });
    assert.match(label, /上次生成/);
    assert.doesNotMatch(label, /工具调用生成中/);
    assert.match(label, /工具参数/);
  });

  it("mixed 且仅有思考+工具参数时运行中显示工具调用生成中", () => {
    const label = buildAgentStreamMetricsLabel({
      running: true,
      streamKind: "mixed",
      toolUseChars: 42,
      textChars: 0,
      thinkingChars: 128,
      elapsedMs: 3000,
      totalChars: 170,
      charsPerSecond: 56.7,
    });
    assert.match(label, /工具调用生成中/);
    assert.doesNotMatch(label, /^生成中/);
    assert.match(label, /工具参数/);
    assert.match(label, /思考/);
  });
});
