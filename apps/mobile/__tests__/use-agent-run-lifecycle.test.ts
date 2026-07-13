import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  shouldApplyTranscriptReload,
  useAgentRunLifecycle,
  type AgentRunLifecycle,
} from '@/hooks/useAgentRunLifecycle';

describe('shouldApplyTranscriptReload', () => {
  it('T-ARP-L2: abort retain + assistant phase 允许一次 reload', () => {
    expect(
      shouldApplyTranscriptReload(false, 2, {
        abortRetainPending: true,
        phase: 'assistant',
      }),
    ).toBe(true);
  });

  it('T-ARP-L3: abort retain + tool_results phase 仍禁止 reload', () => {
    expect(
      shouldApplyTranscriptReload(false, 2, {
        abortRetainPending: true,
        phase: 'tool_results',
      }),
    ).toBe(false);
  });
});

describe('useAgentRunLifecycle transcriptFreezeCount', () => {
  function mountLifecycle(onStreamReset?: () => void): AgentRunLifecycle {
    const api: {current?: AgentRunLifecycle} = {};

    function Harness() {
      api.current = useAgentRunLifecycle({onStreamReset});
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });
    expect(api.current).toBeDefined();
    return api.current!;
  }

  it('T-ARP-L1: abortUiRun 设 abortRetainPending 且不同步调 onStreamReset', () => {
    let resetCalls = 0;
    const lifecycle = mountLifecycle(() => {
      resetCalls += 1;
    });
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
    });

    lifecycle.abortUiRun(5);

    expect(lifecycle.getUiRunning()).toBe(false);
    expect(lifecycle.getAbortRetainPending()).toBe(true);
    expect(resetCalls).toBe(0);
  });

  it('T-ARP-L4: getAbortRetainPending / clearAbortRetainPending；FINISHED 清 freeze', () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
    });
    lifecycle.abortUiRun(4);
    expect(lifecycle.getAbortRetainPending()).toBe(true);

    lifecycle.clearAbortRetainPending();
    expect(lifecycle.getAbortRetainPending()).toBe(false);

    lifecycle.abortUiRun(3);
    expect(lifecycle.getAbortRetainPending()).toBe(true);
    expect(lifecycle.getTranscriptFreezeCount()).toBe(3);

    lifecycle.onRunFinished({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
      stopReason: 'cancelled',
    });
    expect(lifecycle.getTranscriptFreezeCount()).toBe(null);
    expect(lifecycle.getAbortRetainPending()).toBe(true);
  });

  it('T-ARP-L4: beginUiRun / resetUiForSessionChange 清 abortRetainPending', () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
    });
    lifecycle.abortUiRun(6);
    expect(lifecycle.getAbortRetainPending()).toBe(true);

    lifecycle.beginUiRun();
    expect(lifecycle.getAbortRetainPending()).toBe(false);

    lifecycle.onRunStarted({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-2',
    });
    lifecycle.abortUiRun(1);
    lifecycle.resetUiForSessionChange();
    expect(lifecycle.getAbortRetainPending()).toBe(false);
  });

  it('T-AC2-10：abortUiRun(freezeAt) 设置 freezeCount 且 getUiRunning 同步为 false', () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
    });
    expect(lifecycle.getUiRunning()).toBe(true);

    lifecycle.abortUiRun(5);

    expect(lifecycle.getUiRunning()).toBe(false);
    expect(lifecycle.getTranscriptFreezeCount()).toBe(5);
    expect(lifecycle.acceptRunEvent('run-1')).toBe(true);
  });

  it('T-AC2-10：RUN_FINISHED accept 后清空 freezeCount', () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
    });
    lifecycle.abortUiRun(4);
    expect(lifecycle.getTranscriptFreezeCount()).toBe(4);

    lifecycle.onRunFinished({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
      stopReason: 'cancelled',
    });

    expect(lifecycle.getTranscriptFreezeCount()).toBe(null);
    expect(lifecycle.acceptRunEvent('run-1')).toBe(false);
  });

  it('T-AC2-10：RUN_FAILED accept 后清空 freezeCount', () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
    });
    lifecycle.abortUiRun(2);

    lifecycle.onRunFailed({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
      error: 'boom',
    });

    expect(lifecycle.getTranscriptFreezeCount()).toBe(null);
  });

  it('T-AC2-10：resetUiForSessionChange 清空 freezeCount', () => {
    const lifecycle = mountLifecycle();
    lifecycle.beginUiRun();
    lifecycle.onRunStarted({
      sessionId: 's1',
      projectId: 'p1',
      runId: 'run-1',
    });
    lifecycle.abortUiRun(7);
    lifecycle.resetUiForSessionChange();

    expect(lifecycle.getTranscriptFreezeCount()).toBe(null);
    expect(lifecycle.getUiRunning()).toBe(false);
    expect(lifecycle.acceptRunEvent('run-1')).toBe(false);
  });
});
