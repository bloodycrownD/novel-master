/**
 * Agent run UI 生命周期：仅管理 uiRunning 与 activeRunId（不触碰 agentActive refcount）。
 */
import {
  shouldAcceptRunEvent,
  shouldApplyTranscriptReload,
  shouldIgnoreStaleRunStarted,
  shouldReloadTranscriptOnRunEvent,
} from "@novel-master/core/agent";
import { useCallback, useRef, useState } from "react";
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
} from "@shared/agent-event-types";

export {
  shouldAcceptRunEvent,
  shouldApplyTranscriptReload,
  shouldIgnoreStaleRunStarted,
  shouldReloadTranscriptOnRunEvent,
};

export type AgentRunLifecycle = {
  readonly uiRunning: boolean;
  readonly activeRunId: string | null;
  /** 发 run 前：uiRunning=true；Desktop 不 increment agentActive */
  beginUiRun(): void;
  /** 终止：uiRunning=false + abortRetainPending；可选 freezeAt 快照消息数；defer onStreamReset 至 retain 完成 */
  abortUiRun(freezeAt?: number): void;
  /** 同步读 uiRunningRef（bus 回调守卫用，禁止读 React state）。 */
  getUiRunning(): boolean;
  /** 同步读 abort 快照；非 null 时禁止一切增列表 reload（abort retain 例外除外）。 */
  getTranscriptFreezeCount(): number | null;
  /** abort 后等待一次 assistant STEP reload。 */
  getAbortRetainPending(): boolean;
  /** retain reload 或 FINISHED fallback 完成后清除。 */
  clearAbortRetainPending(): void;
  /** runId 不匹配则丢弃；匹配则通过 */
  acceptRunEvent(runId: string | undefined): boolean;
  /** 仅设 activeRunId=runId、uiRunning=true（幂等）；不 increment agentActive */
  onRunStarted(payload: AgentRunStartedPayload): void;
  /** 仅 accept 时：activeRunId=null、uiRunning=false；返回是否已处理 */
  onRunFinished(payload: AgentRunFinishedPayload): boolean;
  onRunFailed(payload: AgentRunFailedPayload): boolean;
  resetUiForSessionChange(): void;
};

export function useAgentRunLifecycle(): AgentRunLifecycle {
  const [uiRunning, setUiRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const uiRunningRef = useRef(false);
  const transcriptFreezeCountRef = useRef<number | null>(null);
  const abortRetainPendingRef = useRef(false);

  const syncActiveRunId = useCallback((runId: string | null) => {
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
  }, []);

  const setUiRunningSynced = useCallback((next: boolean) => {
    uiRunningRef.current = next;
    setUiRunning(next);
  }, []);

  const beginUiRun = useCallback(() => {
    syncActiveRunId(null);
    transcriptFreezeCountRef.current = null;
    abortRetainPendingRef.current = false;
    setUiRunningSynced(true);
  }, [syncActiveRunId, setUiRunningSynced]);

  const abortUiRun = useCallback(
    (freezeAt?: number) => {
      setUiRunningSynced(false);
      abortRetainPendingRef.current = true;
      transcriptFreezeCountRef.current = freezeAt ?? null;
      // defer onStreamReset 至 retain reload 或 FINISHED fallback
    },
    [setUiRunningSynced],
  );

  const getUiRunning = useCallback((): boolean => {
    return uiRunningRef.current;
  }, []);

  const getTranscriptFreezeCount = useCallback((): number | null => {
    return transcriptFreezeCountRef.current;
  }, []);

  const getAbortRetainPending = useCallback((): boolean => {
    return abortRetainPendingRef.current;
  }, []);

  const clearAbortRetainPending = useCallback((): void => {
    abortRetainPendingRef.current = false;
  }, []);

  const acceptRunEvent = useCallback((runId: string | undefined): boolean => {
    return shouldAcceptRunEvent(activeRunIdRef.current, runId);
  }, []);

  const onRunStarted = useCallback(
    (payload: AgentRunStartedPayload) => {
      // abort 后迟到 RUN_STARTED 不得复活 uiRunning（与 Mobile 对称）
      if (shouldIgnoreStaleRunStarted(uiRunningRef.current, activeRunIdRef.current)) {
        return;
      }
      syncActiveRunId(payload.runId);
      setUiRunningSynced(true);
    },
    [syncActiveRunId, setUiRunningSynced],
  );

  const onRunFinished = useCallback(
    (payload: AgentRunFinishedPayload): boolean => {
      if (!shouldAcceptRunEvent(activeRunIdRef.current, payload.runId)) {
        return false;
      }
      syncActiveRunId(null);
      setUiRunningSynced(false);
      transcriptFreezeCountRef.current = null;
      return true;
    },
    [syncActiveRunId, setUiRunningSynced],
  );

  const onRunFailed = useCallback(
    (payload: AgentRunFailedPayload): boolean => {
      if (!shouldAcceptRunEvent(activeRunIdRef.current, payload.runId)) {
        return false;
      }
      syncActiveRunId(null);
      setUiRunningSynced(false);
      transcriptFreezeCountRef.current = null;
      return true;
    },
    [syncActiveRunId, setUiRunningSynced],
  );

  const resetUiForSessionChange = useCallback(() => {
    setUiRunningSynced(false);
    syncActiveRunId(null);
    transcriptFreezeCountRef.current = null;
    abortRetainPendingRef.current = false;
  }, [syncActiveRunId, setUiRunningSynced]);

  return {
    uiRunning,
    activeRunId,
    beginUiRun,
    abortUiRun,
    getUiRunning,
    getTranscriptFreezeCount,
    getAbortRetainPending,
    clearAbortRetainPending,
    acceptRunEvent,
    onRunStarted,
    onRunFinished,
    onRunFailed,
    resetUiForSessionChange,
  };
}
