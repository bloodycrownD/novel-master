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
 * 瘦身后的 useAgentRunLifecycle 只保留 activeRunId + UI 态守卫；
 * refcount 已归 AgentRunManager（本 hook 不再改 agent-activity 计数）。
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
    return new Proxy({} as AgentRunLifecycle, {
      get(_t, prop) {
        const current = api.current;
        if (current == null) {
          return undefined;
        }
        // @ts-expect-error 动态透传属性
        const value = current[prop];
        return typeof value === 'function' ? value.bind(current) : value;
      },
    });
  }

  beforeEach(() => {
    setMobileAgentActive(false);
  });

  afterEach(() => {
    setMobileAgentActive(false);
  });

  it('beginUiRun 通知 abort 单元 markRunStarted；refcount 归 Manager 不再加计数', () => {
    const onRunUiActivate = jest.fn();
    const lifecycle = mountLifecycle({onRunUiActivate});
    act(() => {
      lifecycle.beginUiRun();
    });
    expect(isMobileAgentActive()).toBe(false);
    expect(onRunUiActivate).toHaveBeenCalledTimes(1);
  });

  it('onRunStarted 设 activeRunId 并通知 abort 单元', () => {
    const onRunUiActivate = jest.fn();
    // getUiRunning 返回 true 模拟 abort 单元已 markRunStarted（beginUiRun 路径）。
    const lifecycle = mountLifecycle({
      onRunUiActivate,
      getUiRunning: () => true,
    });
    act(() => {
      lifecycle.onRunStarted({sessionId: 's1', projectId: 'p1', runId: 'r1'});
    });
    expect(lifecycle.activeRunId).toBe('r1');
    expect(onRunUiActivate).toHaveBeenCalledTimes(1);
    expect(lifecycle.acceptRunEvent('r1')).toBe(true);
  });

  it('onRunFinished 清 activeRunId、通知 abort（decrement 归 Manager）', () => {
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
    expect(lifecycle.activeRunId).toBe(null);
    expect(isMobileAgentActive()).toBe(false);
    expect(onRunUiDeactivate).toHaveBeenCalledTimes(1);
  });

  it('onRunFailed 清 activeRunId（decrement 归 Manager）', () => {
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

  // ===== 恢复窗口（T-R2 / 主会话流式重进恢复） =====

  it('恢复窗口开启时：activeRunId==null 下接纳任意非空 runId 并同步反填', () => {
    const lifecycle = mountLifecycle({getResumeWindowEligible: () => true});
    act(() => {
      // session 切换：reset 内部按 eligible 开窗（模拟切回仍有 in-flight run 的会话）
      lifecycle.resetUiForSessionChange();
    });
    expect(lifecycle.activeRunId).toBe(null);
    // 窗口内第一条带 runId 的事件被接纳（带副作用反填）
    let accepted = false;
    act(() => {
      accepted = lifecycle.acceptRunEvent('run-live-1');
    });
    expect(accepted).toBe(true);
    expect(lifecycle.activeRunId).toBe('run-live-1');
  });

  it('反填后关窗：不匹配的新 runId 事件被拒（防旧 run 迟到事件干扰）', () => {
    const lifecycle = mountLifecycle({getResumeWindowEligible: () => true});
    act(() => {
      lifecycle.resetUiForSessionChange();
      lifecycle.acceptRunEvent('run-live-1');
    });
    expect(lifecycle.acceptRunEvent('run-stale-2')).toBe(false);
    expect(lifecycle.activeRunId).toBe('run-live-1');
    // 空 runId 同样拒绝
    expect(lifecycle.acceptRunEvent(undefined)).toBe(false);
    expect(lifecycle.acceptRunEvent('')).toBe(false);
  });

  it('eligible=false 时不开窗：activeRunId==null 下仍拒绝（现状口径不变）', () => {
    const lifecycle = mountLifecycle({getResumeWindowEligible: () => false});
    act(() => {
      lifecycle.resetUiForSessionChange();
    });
    expect(lifecycle.acceptRunEvent('run-1')).toBe(false);
  });

  it('T-P3a: reset 时采纳 Manager running 投影——activeRunId 立即恢复严格匹配', () => {
    // 重进会话场景：Manager 已回填 runId（RUN_STARTED 已达），reset 直接采纳，
    // 不等首事件反填、不依赖恢复窗口放宽。
    let entry: {status: 'starting' | 'running'; runId: string | null} | null = {
      status: 'running',
      runId: 'run-live-1',
    };
    const lifecycle = mountLifecycle({
      getManagerEntry: () => entry,
      getResumeWindowEligible: () => false,
    });
    expect(lifecycle.activeRunId).toBe(null);
    act(() => {
      lifecycle.resetUiForSessionChange();
    });
    expect(lifecycle.activeRunId).toBe('run-live-1');
    // 严格匹配恢复：同 runId 的 delta 被接纳、异 runId 被拒
    expect(lifecycle.acceptRunEvent('run-live-1')).toBe(true);
    expect(lifecycle.acceptRunEvent('run-other')).toBe(false);
    // FINISHED 直接收尾（无需开窗）
    act(() => {
      lifecycle.onRunFinished({
        sessionId: 's1',
        projectId: 'p1',
        runId: 'run-live-1',
        stopReason: 'end_turn',
      });
    });
    expect(lifecycle.activeRunId).toBe(null);
    entry = null;
  });

  it('T-P3b: starting 投影（runId 未知）不采纳——恢复窗口放宽接纳首事件', () => {
    // 受理空窗场景：entry 处 starting（RUN_STARTED 未达），投影 runId 为 null，
    // reset 不采纳；开窗资格由 Provider 侧扩为 registry ∥ Manager（本测试直接
    // 模拟 eligible=true），首事件（RUN_STARTED 前的 delta / 迟到的 FINISHED）
    // 经窗口放宽接纳并反填。
    const lifecycle = mountLifecycle({
      getManagerEntry: () => ({status: 'starting', runId: null}),
      getResumeWindowEligible: () => true,
      getUiRunning: () => true,
    });
    act(() => {
      lifecycle.resetUiForSessionChange();
    });
    expect(lifecycle.activeRunId).toBe(null);
    // 窗口放宽：非空 runId 接纳 + 反填（setState 后需 re-render 再读）
    let accepted = false;
    act(() => {
      accepted = lifecycle.acceptRunEvent('run-late-1');
    });
    expect(accepted).toBe(true);
    expect(lifecycle.activeRunId).toBe('run-late-1');
  });

  it('T-P3c: 无投影（未注入 getManagerEntry）时 reset 归零——旧口径不变', () => {
    const lifecycle = mountLifecycle({getResumeWindowEligible: () => false});
    act(() => {
      lifecycle.resetUiForSessionChange();
    });
    expect(lifecycle.activeRunId).toBe(null);
    expect(lifecycle.acceptRunEvent('run-any')).toBe(false);
  });

  it('FINISHED 是窗口内第一条事件：accept 反填先于内部守卫，收尾正常', () => {
    const onRunUiDeactivate = jest.fn();
    const lifecycle = mountLifecycle({
      onRunUiDeactivate,
      // 模拟状态重建已合成 markRunStarted（uiRunning=true）
      getUiRunning: () => true,
      getResumeWindowEligible: () => true,
    });
    act(() => {
      // 切回时 reset 开窗（agent-activity 计数归 AgentRunManager，本测试不涉）
      lifecycle.resetUiForSessionChange();
    });
    act(() => {
      // 窗口内第一条事件是 FINISHED：useSessionStream 先 accept（反填）再 onRunFinished
      expect(lifecycle.acceptRunEvent('run-live-1')).toBe(true);
      lifecycle.onRunFinished({
        sessionId: 's1',
        projectId: 'p1',
        runId: 'run-live-1',
        stopReason: 'end_turn',
      });
    });
    // 反填先于内部守卫求值：收尾未被拒
    expect(lifecycle.activeRunId).toBe(null);
    expect(onRunUiDeactivate).toHaveBeenCalledTimes(1);
  });

  it('窗口内真 RUN_STARTED 到达也承担关窗并反填真实 runId', () => {
    const lifecycle = mountLifecycle({
      getUiRunning: () => true,
      getResumeWindowEligible: () => true,
    });
    act(() => {
      lifecycle.resetUiForSessionChange();
      lifecycle.onRunStarted({
        sessionId: 's1',
        projectId: 'p1',
        runId: 'run-live-1',
      });
    });
    expect(lifecycle.activeRunId).toBe('run-live-1');
    // 窗已关：新 runId 被拒
    expect(lifecycle.acceptRunEvent('run-other')).toBe(false);
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
    it('beginUiRun 后本地异常 → endUiRunOnError 收 UI 态（refcount 归 Manager，本 hook 不碰计数）', () => {
      const onRunUiDeactivate = jest.fn();
      const lifecycle = mountLifecycle({onRunUiDeactivate});
      act(() => {
        lifecycle.beginUiRun();
      });
      expect(isMobileAgentActive()).toBe(false); // 不加计数

      // 模拟 startRun 被拒 / 本地异常后 composer 调用 endUiRunOnError。
      act(() => {
        lifecycle.endUiRunOnError();
      });
      expect(isMobileAgentActive()).toBe(false); // 也不减计数
      expect(lifecycle.activeRunId).toBe(null);
      expect(onRunUiDeactivate).toHaveBeenCalledTimes(1);

      // 幂等：再调一次不应再通知。
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
      expect(isMobileAgentActive()).toBe(false); // 计数归 Manager

      // runAgentTurn 同步 throw：endUiRunOnError 已清空 activeRunId。
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
