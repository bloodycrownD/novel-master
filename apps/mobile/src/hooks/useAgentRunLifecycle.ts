/**
 * Agent 回合 run 生命周期：activeRunId 状态 + UI 侧 run 态守卫。
 *
 * Phase 2 拆分后：abort 状态机（uiRunning / freezeCount / abortRetainPending /
 * abortUiRun）已挪到 {@link useSessionAbort}；本 hook 只保留 run 生命周期——
 * activeRunId 跟踪、stale RUN_STARTED 守卫。
 *
 * refcount 单一归属已移交 AgentRunManager（多会话并行迭代）：
 * increment 在 Manager.startRun 受理路径同步执行、decrement 由 Manager 的
 * 全量 FINISHED/FAILED 事件订阅驱动——本 hook 不再直接改 agent-activity 计数
 * （切走会话后 UI 面板过滤会丢弃 FINISHED，旧行为会泄漏 refcount）。
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
import {useCallback, useRef, useState} from 'react';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
} from '@novel-master/core/events';

export {shouldApplyTranscriptReload};

export type AgentRunLifecycle = {
  readonly activeRunId: string | null;
  /** 发 run 前：通知 abort 单元 markRunStarted（refcount 归 Manager，不再加计数）。 */
  beginUiRun(): void;
  /** runId 不匹配则丢弃。 */
  acceptRunEvent(runId: string | undefined): boolean;
  /** 设 activeRunId=runId（幂等，stale 守卫过滤迟到的 RUN_STARTED）；通知 abort 单元 uiRunning=true。 */
  onRunStarted(payload: AgentRunStartedPayload): void;
  /** accept 后：activeRunId=null；通知 abort 单元 uiRunning=false（decrement 归 Manager）。 */
  onRunFinished(payload: AgentRunFinishedPayload): void;
  onRunFailed(payload: AgentRunFailedPayload): void;
  /**
   * UI 侧 run 异常收尾（如 startRun 被拒 / 本地异常）。
   *
   * 幂等：用 uiActiveRef 跟踪 beginUiRun / onRunStarted 是否已激活 UI run 态，
   * 未激活时直接 no-op；激活过则清 activeRunId、通知 abort 单元 uiRunning=false，
   * 并把 uiActiveRef 翻回未激活。
   *
   * refcount 已归 AgentRunManager，这里只收 UI 侧状态。
   */
  endUiRunOnError(): void;
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
  // 跟踪 beginUiRun / onRunStarted 是否已激活 UI run 态，给 endUiRunOnError 做幂等守卫。
  const uiActiveRef = useRef(false);

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
    // agent-activity 计数归 AgentRunManager（受理路径同步 increment）。
    uiActiveRef.current = true;
    onRunUiActivateRef.current?.();
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
      uiActiveRef.current = true;
      onRunUiActivateRef.current?.();
    },
    [syncActiveRunId],
  );

  const onRunFinished = useCallback(
    (payload: AgentRunFinishedPayload) => {
      // 守卫：runId 不匹配（含 endUiRunOnError 已清空 activeRunId 的迟到事件）则拒绝，
      // 避免二次递减导致 refcount 负数。
      if (!shouldAcceptRunEvent(activeRunIdRef.current, payload.runId)) {
        return;
      }
      syncActiveRunId(null);
      uiActiveRef.current = false;
      onRunUiDeactivateRef.current?.();
    },
    [syncActiveRunId],
  );

  const onRunFailed = useCallback(
    (payload: AgentRunFailedPayload) => {
      // 同 onRunFinished：守卫拒绝迟到的 RUN_FAILED。
      if (!shouldAcceptRunEvent(activeRunIdRef.current, payload.runId)) {
        return;
      }
      syncActiveRunId(null);
      uiActiveRef.current = false;
      onRunUiDeactivateRef.current?.();
    },
    [syncActiveRunId],
  );

  const endUiRunOnError = useCallback(() => {
    // 幂等：未激活过 UI run 态时直接 return（比如还没 beginUiRun 就报错）。
    // refcount 归 AgentRunManager，这里只收 UI 侧状态。
    if (!uiActiveRef.current) {
      return;
    }
    syncActiveRunId(null);
    uiActiveRef.current = false;
    onRunUiDeactivateRef.current?.();
  }, [syncActiveRunId]);

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
    endUiRunOnError,
    resetUiForSessionChange,
  };
}
