import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldAcceptRunEvent,
  shouldIgnoreStaleRunStarted,
} from "@novel-master/core/agent";

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

  it("abort 后保留 activeRunId 时 RUN_FINISHED 仍可 accept", () => {
    assert.equal(shouldAcceptRunEvent("run-abort", "run-abort"), true);
  });
});

describe("shouldIgnoreStaleRunStarted", () => {
  it("abort 后 uiRunning=false 时忽略 RUN_STARTED（保留 activeRunId 亦然）", () => {
    assert.equal(shouldIgnoreStaleRunStarted(false, null), true);
    assert.equal(shouldIgnoreStaleRunStarted(false, "run-1"), true);
  });

  it("beginUiRun 窗口内 uiRunning=true 时接受 RUN_STARTED", () => {
    assert.equal(shouldIgnoreStaleRunStarted(true, null), false);
    assert.equal(shouldIgnoreStaleRunStarted(true, "run-1"), false);
  });
});
