/**
 * Agent run UI 生命周期：仅管理 uiRunning 与 activeRunId（不触碰 agentActive refcount）。
 */
import { useCallback, useRef, useState } from "react";
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
} from "@shared/agent-event-types";

export type AgentRunLifecycle = {
  readonly uiRunning: boolean;
  readonly activeRunId: string | null;
  /** 发 run 前：uiRunning=true；Desktop 不 increment agentActive */
  beginUiRun(): void;
  /** 终止：uiRunning=false + onStreamReset；不碰 agentActive */
  abortUiRun(): void;
  /** runId 不匹配则丢弃；匹配则通过 */
  acceptRunEvent(runId: string | undefined): boolean;
  /** 仅设 activeRunId=runId、uiRunning=true（幂等）；不 increment agentActive */
  onRunStarted(payload: AgentRunStartedPayload): void;
  /** 仅 accept 时：activeRunId=null、uiRunning=false；返回是否已处理 */
  onRunFinished(payload: AgentRunFinishedPayload): boolean;
  onRunFailed(payload: AgentRunFailedPayload): boolean;
  resetUiForSessionChange(): void;
};

/** 纯函数：是否接受带 runId 的 stream/bus 事件。 */
export function shouldAcceptRunEvent(
  activeRunId: string | null,
  runId: string | undefined,
): boolean {
  if (runId == null || runId === "") {
    return false;
  }
  if (activeRunId == null) {
    return false;
  }
  return activeRunId === runId;
}

/** 纯函数：abort 后迟到 RUN_STARTED 是否应被忽略。 */
export function shouldIgnoreStaleRunStarted(
  uiRunning: boolean,
  activeRunId: string | null,
): boolean {
  return !uiRunning && activeRunId == null;
}

export function useAgentRunLifecycle(
  onStreamReset?: () => void,
): AgentRunLifecycle {
  const [uiRunning, setUiRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const uiRunningRef = useRef(false);

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
    setUiRunningSynced(true);
  }, [syncActiveRunId, setUiRunningSynced]);

  const abortUiRun = useCallback(() => {
    setUiRunningSynced(false);
    syncActiveRunId(null);
    onStreamReset?.();
  }, [onStreamReset, syncActiveRunId, setUiRunningSynced]);

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
      return true;
    },
    [syncActiveRunId, setUiRunningSynced],
  );

  const resetUiForSessionChange = useCallback(() => {
    setUiRunningSynced(false);
    syncActiveRunId(null);
  }, [syncActiveRunId, setUiRunningSynced]);

  return {
    uiRunning,
    activeRunId,
    beginUiRun,
    abortUiRun,
    acceptRunEvent,
    onRunStarted,
    onRunFinished,
    onRunFailed,
    resetUiForSessionChange,
  };
}
