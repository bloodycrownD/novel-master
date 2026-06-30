import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldAcceptRunEvent } from "@/hooks/useAgentRunLifecycle";

describe("shouldAcceptRunEvent", () => {
  it("activeRunId 为空时拒绝", () => {
    assert.equal(shouldAcceptRunEvent(null, "run-1"), false);
    assert.equal(shouldAcceptRunEvent(null, undefined), false);
  });

  it("runId 为空时拒绝", () => {
    assert.equal(shouldAcceptRunEvent("run-1", undefined), false);
    assert.equal(shouldAcceptRunEvent("run-1", ""), false);
  });

  it("runId 匹配时接受", () => {
    assert.equal(shouldAcceptRunEvent("run-a", "run-a"), true);
  });

  it("stale runId 不匹配时拒绝", () => {
    assert.equal(shouldAcceptRunEvent("run-a", "run-b"), false);
  });
});
