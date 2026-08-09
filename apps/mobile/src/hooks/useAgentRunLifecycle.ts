/**
 * Agent 回合 run 生命周期：activeRunId 状态 + agentActivity refcount。
 *
 * Phase 2 拆分后：abort 状态机（uiRunning / freezeCount / abortRetainPending /
 * abortUiRun）已挪到 {@link useSessionAbort}；本 hook 只保留 run 生命周期——
 * activeRunId 跟踪、stale RUN_STARTED 守卫、agentActive 引用计数。
 *
 * refcount 单一归属：beginUiRun 加、onRunFinished/onRunFailed 减。stream 单元的
 * FINISHED/FAILED 不再直接 decrementAgentActive，改为通知本 hook。
 *
 * uiRunning 的同步通过 `onRunUiActivate` / `onRunUiDeactivate` 回调注入——
 * Provider 实例化顺序是「先 abort 单元、再 lifecycle」，把 abort.markRunStarted /
 * markRunEnded 注入 lifecycle，让 lifecycle 在 onRunStarted/onRunFinished 时
 * 同步刷新 abort 单元的 uiRunning state（同步更新 ref，bus 回调读 ref 零延迟）。
 */
import {
  shouldAcceptRunEvent,
  shouldApplyTranscriptReload,
  shouldIgnoreStaleRunStarted,
} from '@novel-master/core/agent';
import { useCallback, useRef, useState } from 'react';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
} from '@novel-master/core/events';
import { decrementAgentActive, incrementAgentActive } from '@/runtime/agent-activity';

export { shouldApplyTranscriptReload };

export type AgentRunLifecycle = {
  readonly activeRunId: string | null;
  /** 发 run 前：递增 agentActive；同时通过回调通知 abort 单元 markRunStarted。 */
  beginUiRun(): void;
  /** runId 不匹配则丢弃。 */
  acceptRunEvent(runId: string | undefined): boolean;
  /** 设 activeRunId=runId（幂等，stale 守卫过滤迟到的 RUN_STARTED）；通知 abort 单元 uiRunning=true。 */
  onRunStarted(payload: AgentRunStartedPayload): void;
  /** accept 后：activeRunId=null、递减 agentActive；通知 abort 单元 uiRunning=false。 */
  onRunFinished(payload: AgentRunFinishedPayload): void;
  onRunFailed(payload: AgentRunFailedPayload): void;
  /** session 切换：清 activeRunId（abort 状态与 stream 清理由 abort 单元负责）。 */
  resetUiForSessionChange(): void;
};

export type UseAgentRunLifecycleParams = {
  /** run 启动时同步通知 abort 单元（markRunStarted：uiRunning=true + 清 freeze/retain）。 */
  readonly onRunUiActivate?: () => void;
  /** run 结束时同步通知 abort 单元（markRunEnded：uiRunning=false + 清 freeze）。 */
  readonly onRunUiDeactivate?: () => void;
  /**
   * 同步读 abort 单元的 uiRunning——stale RUN_STARTED 守卫要用它
   * （abort 后 uiRunning=false，迟到的 RUN_STARTED 不应再激活）。
   */
  readonly getUiRunning?: () => boolean;
};

export function useAgentRunLifecycle({
  onRunUiActivate,
  onRunUiDeactivate,
  getUiRunning,
}: UseAgentRunLifecycleParams = {}): AgentRunLifecycle {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);

  const onRunUiActivateRef = useRef(onRunUiActivate);
  onRunUiActivateRef.current = onRunUiActivate;
  const onRunUiDeactivateRef = useRef(onRunUiDeactivate);
  onRunUiDeactivateRef.current = onRunUiDeactivate;
  const getUiRunningRef = useRef(getUiRunning);
  getUiRunningRef.current = getUiRunning;

  const syncActiveRunId = useCallback((runId: string | null) => {
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
  }, []);

  const beginUiRun = useCallback(() => {
    // abort 状态机的 freeze/retain 清理由 abort.markRunStarted 完成。
    onRunUiActivateRef.current?.();
    incrementAgentActive();
  }, []);

  const acceptRunEvent = useCallback((runId: string | undefined): boolean => {
    return shouldAcceptRunEvent(activeRunIdRef.current, runId);
  }, []);

  const onRunStarted = useCallback(
    (payload: AgentRunStartedPayload) => {
      // abort 后 uiRunning=false 时忽略迟到 RUN_STARTED（与 Desktop 对称）。
      // uiRunning 在 abort 单元，这里经注入的 getter 同步读取。
      const uiRunning = getUiRunningRef.current?.() ?? false;
      if (shouldIgnoreStaleRunStarted(uiRunning, activeRunIdRef.current)) {
        return;
      }
      syncActiveRunId(payload.runId);
      onRunUiActivateRef.current?.();
    },
    [syncActiveRunId],
  );

  const onRunFinished = useCallback(
    (_payload: AgentRunFinishedPayload) => {
      syncActiveRunId(null);
      onRunUiDeactivateRef.current?.();
      decrementAgentActive();
    },
    [syncActiveRunId],
  );

  const onRunFailed = useCallback(
    (_payload: AgentRunFailedPayload) => {
      syncActiveRunId(null);
      onRunUiDeactivateRef.current?.();
      decrementAgentActive();
    },
    [syncActiveRunId],
  );

  const resetUiForSessionChange = useCallback(() => {
    syncActiveRunId(null);
  }, [syncActiveRunId]);

  return {
    activeRunId,
    beginUiRun,
    acceptRunEvent,
    onRunStarted,
    onRunFinished,
    onRunFailed,
    resetUiForSessionChange,
  };
}
