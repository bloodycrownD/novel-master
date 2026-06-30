import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldAcceptRunEvent,
  shouldIgnoreStaleRunStarted,
} from "@/hooks/useAgentRunLifecycle";

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

describe("shouldIgnoreStaleRunStarted", () => {
  it("abort 后 uiRunning=false 且 activeRunId=null 时忽略 RUN_STARTED", () => {
    assert.equal(shouldIgnoreStaleRunStarted(false, null), true);
  });

  it("beginUiRun 窗口内 uiRunning=true 时接受 RUN_STARTED", () => {
    assert.equal(shouldIgnoreStaleRunStarted(true, null), false);
  });

  it("已有 activeRunId 时接受 RUN_STARTED", () => {
    assert.equal(shouldIgnoreStaleRunStarted(false, "run-1"), false);
  });
});
