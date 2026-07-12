import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useAgentRunLifecycle, type AgentRunLifecycle} from '@/hooks/useAgentRunLifecycle';

describe('useAgentRunLifecycle transcriptFreezeCount', () => {
  function mountLifecycle(): AgentRunLifecycle {
    const api: {current?: AgentRunLifecycle} = {};

    function Harness() {
      api.current = useAgentRunLifecycle();
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });
    expect(api.current).toBeDefined();
    return api.current!;
  }

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
