import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import {
  shouldAcceptRunEvent,
  shouldIgnoreStaleRunStarted,
  shouldReloadTranscriptOnRunEvent,
} from "@shared/logic/agent";
import {
  shouldApplyTranscriptReload,
  useAgentRunLifecycle,
  type AgentRunLifecycle,
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

describe("shouldApplyTranscriptReload", () => {
  it("uiRunning=false 时禁止 reload", () => {
    assert.equal(
      shouldApplyTranscriptReload(false, null),
      shouldReloadTranscriptOnRunEvent(false),
    );
    assert.equal(shouldApplyTranscriptReload(false, null), false);
  });

  it("uiRunning=true 且无 freeze 时允许 reload", () => {
    assert.equal(shouldApplyTranscriptReload(true, null), true);
  });

  it("freezeCount 非 null 时禁止一切增列表 reload", () => {
    assert.equal(shouldApplyTranscriptReload(true, 3), false);
    assert.equal(shouldApplyTranscriptReload(false, 3), false);
  });
});

describe("useAgentRunLifecycle transcriptFreezeCount (T-AC2-5)", () => {
  function mountLifecycle(): AgentRunLifecycle {
    const api: { current?: AgentRunLifecycle } = {};

    function Harness() {
      api.current = useAgentRunLifecycle();
      return null;
    }

    renderToStaticMarkup(React.createElement(Harness));
    assert.ok(api.current);
    return api.current;
  }

  it("T-ARP-L1: abortUiRun 设 abortRetainPending 且 defer overlay clear", () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
    });

    lifecycle.abortUiRun(5);

    assert.equal(lifecycle.getUiRunning(), false);
    assert.equal(lifecycle.getAbortRetainPending(), true);
  });

  it("T-ARP-L4: getAbortRetainPending / clearAbortRetainPending；FINISHED 清 freeze", () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
    });
    lifecycle.abortUiRun(4);
    assert.equal(lifecycle.getAbortRetainPending(), true);

    lifecycle.clearAbortRetainPending();
    assert.equal(lifecycle.getAbortRetainPending(), false);

    lifecycle.abortUiRun(3);
    assert.equal(lifecycle.getAbortRetainPending(), true);
    assert.equal(lifecycle.getTranscriptFreezeCount(), 3);

    lifecycle.onRunFinished({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
      stopReason: "cancelled",
    });
    assert.equal(lifecycle.getTranscriptFreezeCount(), null);
    // FINISHED 不自动清 abortRetainPending（由 retain reload 或 fallback 负责）
    assert.equal(lifecycle.getAbortRetainPending(), true);
  });

  it("T-ARP-L4: beginUiRun / resetUiForSessionChange 清 abortRetainPending", () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
    });
    lifecycle.abortUiRun(6);
    assert.equal(lifecycle.getAbortRetainPending(), true);

    lifecycle.beginUiRun();
    assert.equal(lifecycle.getAbortRetainPending(), false);

    lifecycle.onRunStarted({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-2",
    });
    lifecycle.abortUiRun(1);
    lifecycle.resetUiForSessionChange();
    assert.equal(lifecycle.getAbortRetainPending(), false);
  });

  it("abortUiRun(freezeAt) 设置 freezeCount 且 getUiRunning 同步为 false", () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
    });
    assert.equal(lifecycle.getUiRunning(), true);

    lifecycle.abortUiRun(5);

    assert.equal(lifecycle.getUiRunning(), false);
    assert.equal(lifecycle.getTranscriptFreezeCount(), 5);
    assert.equal(lifecycle.acceptRunEvent("run-1"), true);
  });

  it("RUN_FINISHED accept 后清空 freezeCount", () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
    });
    lifecycle.abortUiRun(4);
    assert.equal(lifecycle.getTranscriptFreezeCount(), 4);

    const accepted = lifecycle.onRunFinished({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
      stopReason: "cancelled",
    });
    assert.equal(accepted, true);

    assert.equal(lifecycle.getTranscriptFreezeCount(), null);
    assert.equal(lifecycle.acceptRunEvent("run-1"), false);
  });

  it("RUN_FAILED accept 后清空 freezeCount", () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
    });
    lifecycle.abortUiRun(2);

    const accepted = lifecycle.onRunFailed({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
      error: "boom",
    });
    assert.equal(accepted, true);

    assert.equal(lifecycle.getTranscriptFreezeCount(), null);
  });

  it("resetUiForSessionChange 清空 freezeCount", () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
    });
    lifecycle.abortUiRun(7);
    lifecycle.resetUiForSessionChange();

    assert.equal(lifecycle.getTranscriptFreezeCount(), null);
    assert.equal(lifecycle.getUiRunning(), false);
    assert.equal(lifecycle.acceptRunEvent("run-1"), false);
  });

  it("beginUiRun 清空 freezeCount（新 run 前解除 abort 快照）", () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: "s1",
      projectId: "p1",
      runId: "run-1",
    });
    lifecycle.abortUiRun(6);
    lifecycle.beginUiRun();

    assert.equal(lifecycle.getTranscriptFreezeCount(), null);
    assert.equal(lifecycle.getUiRunning(), true);
  });
});
