import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeToolInvoking } from "@/hooks/useStreamToolInvoking";

describe("computeToolInvoking", () => {
  it("agent 未运行时为 false", () => {
    assert.equal(
      computeToolInvoking({
        agentRunning: false,
        thinkingContent: "plan",
        textContent: "",
        msSinceLastThinkingDelta: 500,
      }),
      false,
    );
  });

  it("无 thinking 且无正文时为 false", () => {
    assert.equal(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: "",
        textContent: "",
        msSinceLastThinkingDelta: 500,
      }),
      false,
    );
  });

  it("thinking 空闲 ≥300ms 且无正文时为 true", () => {
    assert.equal(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: "plan",
        textContent: "",
        msSinceLastThinkingDelta: 300,
      }),
      true,
    );
  });

  it("有正文且 text 空闲 ≥300ms 时为 true（post-text 路径）", () => {
    assert.equal(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: "",
        textContent: "hello",
        msSinceLastThinkingDelta: 0,
        msSinceLastTextDelta: 300,
      }),
      true,
    );
  });

  it("有正文且仍在流式输出时为 false", () => {
    assert.equal(
      computeToolInvoking({
        agentRunning: true,
        thinkingContent: "plan",
        textContent: "hello",
        msSinceLastThinkingDelta: 500,
        msSinceLastTextDelta: 50,
        idleThresholdMs: 300,
      }),
      false,
    );
  });
});
