import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  setMobileAgentActive,
  isMobileAgentActive,
} from '@/runtime/agent-activity';
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

/**
 * 瘦身后的 useAgentRunLifecycle 只保留 activeRunId + refcount。
 * abort 状态机的测试在 use-session-abort.test.ts。
 */
describe('useAgentRunLifecycle (slimmed)', () => {
  function mountLifecycle(
    params?: Parameters<typeof useAgentRunLifecycle>[0],
  ): AgentRunLifecycle {
    const api: {current?: AgentRunLifecycle} = {};

    function Harness() {
      api.current = useAgentRunLifecycle(params);
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });
    expect(api.current).toBeDefined();

    // 返回 getter 包装：state 字段（activeRunId）每次读最新 render 的 api.current，
    // 方法引用稳定（useCallback），调用后需在 act 里读才能看到新 state。
    return new Proxy(
      {} as AgentRunLifecycle,
      {
        get(_t, prop) {
          const current = api.current;
          if (current == null) {
            return undefined;
          }
          // @ts-expect-error 动态透传属性
          const value = current[prop];
          return typeof value === 'function' ? value.bind(current) : value;
        },
      },
    );
  }

  beforeEach(() => {
    setMobileAgentActive(false);
  });

  afterEach(() => {
    setMobileAgentActive(false);
  });

  it('beginUiRun 递增 agentActive 并通知 abort 单元 markRunStarted', () => {
    const onRunUiActivate = jest.fn();
    const lifecycle = mountLifecycle({onRunUiActivate});
    act(() => {
      lifecycle.beginUiRun();
    });
    expect(isMobileAgentActive()).toBe(true);
    expect(onRunUiActivate).toHaveBeenCalledTimes(1);
  });

  it('onRunStarted 设 activeRunId 并通知 abort 单元', () => {
    const onRunUiActivate = jest.fn();
    // getUiRunning 返回 true 模拟 abort 单元已 markRunStarted（beginUiRun 路径）。
    const lifecycle = mountLifecycle({onRunUiActivate, getUiRunning: () => true});
    act(() => {
      lifecycle.onRunStarted({sessionId: 's1', projectId: 'p1', runId: 'r1'});
    });
    expect(lifecycle.activeRunId).toBe('r1');
    expect(onRunUiActivate).toHaveBeenCalledTimes(1);
    expect(lifecycle.acceptRunEvent('r1')).toBe(true);
  });

  it('onRunFinished 清 activeRunId、递减 agentActive、通知 abort', () => {
    const onRunUiDeactivate = jest.fn();
    const lifecycle = mountLifecycle({onRunUiDeactivate, getUiRunning: () => true});
    act(() => {
      lifecycle.beginUiRun();
      lifecycle.onRunStarted({sessionId: 's1', projectId: 'p1', runId: 'r1'});
    });
    act(() => {
      lifecycle.onRunFinished({
        sessionId: 's1',
        projectId: 'p1',
        runId: 'r1',
        stopReason: 'end_turn',
      });
    });
    expect(lifecycle.activeRunId).toBe(null);
    expect(isMobileAgentActive()).toBe(false);
    expect(onRunUiDeactivate).toHaveBeenCalledTimes(1);
  });

  it('onRunFailed 清 activeRunId、递减 agentActive', () => {
    const lifecycle = mountLifecycle({getUiRunning: () => true});
    act(() => {
      lifecycle.beginUiRun();
      lifecycle.onRunStarted({sessionId: 's1', projectId: 'p1', runId: 'r1'});
    });
    act(() => {
      lifecycle.onRunFailed({
        sessionId: 's1',
        projectId: 'p1',
        runId: 'r1',
        error: 'boom',
      });
    });
    expect(lifecycle.activeRunId).toBe(null);
    expect(isMobileAgentActive()).toBe(false);
  });

  it('resetUiForSessionChange 清 activeRunId', () => {
    const lifecycle = mountLifecycle({getUiRunning: () => true});
    act(() => {
      lifecycle.beginUiRun();
      lifecycle.onRunStarted({sessionId: 's1', projectId: 'p1', runId: 'r1'});
    });
    act(() => {
      lifecycle.resetUiForSessionChange();
    });
    expect(lifecycle.activeRunId).toBe(null);
    expect(lifecycle.acceptRunEvent('r1')).toBe(false);
  });

  it('getUiRunning 注入时 stale RUN_STARTED 被忽略（uiRunning=false）', () => {
    const onRunUiActivate = jest.fn();
    const lifecycle = mountLifecycle({
      onRunUiActivate,
      getUiRunning: () => false,
    });
    act(() => {
      lifecycle.onRunStarted({sessionId: 's1', projectId: 'p1', runId: 'r1'});
    });
    expect(lifecycle.activeRunId).toBe(null);
    expect(onRunUiActivate).not.toHaveBeenCalled();
  });

  it('beginUiRun 后即使 getUiRunning=false，onRunStarted 仍被忽略（依赖 abort 真实状态）', () => {
    // 这里验证拆分后的契约：lifecycle 不再自己管 uiRunning，
    // stale 判定完全以 abort 单元注入的 getUiRunning 为准。
    const onRunUiActivate = jest.fn();
    const lifecycle = mountLifecycle({
      onRunUiActivate,
      getUiRunning: () => false,
    });
    act(() => {
      lifecycle.beginUiRun();
    });
    act(() => {
      lifecycle.onRunStarted({sessionId: 's1', projectId: 'p1', runId: 'r1'});
    });
    expect(lifecycle.activeRunId).toBe(null);
  });

  // T-CF4: composer finally 兑底收敛到 lifecycle.endUiRunOnError 后的幂等与守卫。
  describe('endUiRunOnError (T-CF4)', () => {
    it('beginUiRun 后 runAgentTurn 同步 throw → endUiRunOnError 收尾，refcount 归 0、uiActiveRef 翻 false', () => {
      const onRunUiDeactivate = jest.fn();
      const lifecycle = mountLifecycle({onRunUiDeactivate});
      act(() => {
        lifecycle.beginUiRun();
      });
      expect(isMobileAgentActive()).toBe(true);

      // 模拟 runAgentTurn 同步 throw 后 composer 调用 endUiRunOnError。
      act(() => {
        lifecycle.endUiRunOnError();
      });
      expect(isMobileAgentActive()).toBe(false);
      expect(lifecycle.activeRunId).toBe(null);
      expect(onRunUiDeactivate).toHaveBeenCalledTimes(1);

      // 幂等：再调一次不应再递减（这里以不报错 + 状态仍归 0 来间接验证）。
      act(() => {
        lifecycle.endUiRunOnError();
      });
      expect(isMobileAgentActive()).toBe(false);
      expect(onRunUiDeactivate).toHaveBeenCalledTimes(1);
    });

    it('未 beginUiRun 时 endUiRunOnError 是 no-op', () => {
      const onRunUiDeactivate = jest.fn();
      const lifecycle = mountLifecycle({onRunUiDeactivate});
      act(() => {
        lifecycle.endUiRunOnError();
      });
      expect(isMobileAgentActive()).toBe(false);
      expect(onRunUiDeactivate).not.toHaveBeenCalled();
    });

    it('正常完成路径：beginUiRun → onRunStarted → onRunFinished，不调 endUiRunOnError', () => {
      const onRunUiDeactivate = jest.fn();
      const lifecycle = mountLifecycle({
        onRunUiDeactivate,
        getUiRunning: () => true,
      });
      act(() => {
        lifecycle.beginUiRun();
        lifecycle.onRunStarted({sessionId: 's1', projectId: 'p1', runId: 'r1'});
      });
      act(() => {
        lifecycle.onRunFinished({
          sessionId: 's1',
          projectId: 'p1',
          runId: 'r1',
          stopReason: 'end_turn',
        });
      });
      expect(isMobileAgentActive()).toBe(false);
      expect(lifecycle.activeRunId).toBe(null);
      expect(onRunUiDeactivate).toHaveBeenCalledTimes(1);
    });

    it('endUiRunOnError 后迟到的 RUN_FINISHED 不会二次递减（shouldAcceptRunEvent 守卫生效）', () => {
      const lifecycle = mountLifecycle({getUiRunning: () => true});
      act(() => {
        lifecycle.beginUiRun();
        lifecycle.onRunStarted({sessionId: 's1', projectId: 'p1', runId: 'r1'});
      });
      expect(isMobileAgentActive()).toBe(true);

      // runAgentTurn 同步 throw：endUiRunOnError 已递减并清空 activeRunId。
      act(() => {
        lifecycle.endUiRunOnError();
      });
      expect(isMobileAgentActive()).toBe(false);

      // 此时迟到的 RUN_FINISHED 到达——不匹配的 runId（r1 vs null）被守卫拒绝，
      // decrementAgentActive 不应被再次调用，refcount 维持在 0（不会变负）。
      act(() => {
        lifecycle.onRunFinished({
          sessionId: 's1',
          projectId: 'p1',
          runId: 'r1',
          stopReason: 'end_turn',
        });
      });
      expect(isMobileAgentActive()).toBe(false);
      expect(lifecycle.activeRunId).toBe(null);
    });
  });
});
