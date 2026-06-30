/**
 * Agent 回合 UI 生命周期：uiRunning + activeRunId。
 * agentActive refcount 由平台层独占；beginUiRun 递增，RUN_FINISHED/FAILED 在 stream runtime 递减。
 */
import { useCallback, useRef, useState } from 'react';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
} from '@novel-master/core/events';
import { incrementAgentActive } from '@/runtime/agent-activity';

export type AgentRunLifecycle = {
  readonly uiRunning: boolean;
  readonly activeRunId: string | null;
  /** 发 run 前：uiRunning=true 并 incrementAgentActive。 */
  beginUiRun(): void;
  /** 终止：uiRunning=false + onStreamReset；不碰 agentActive。 */
  abortUiRun(): void;
  /** runId 不匹配则丢弃。 */
  acceptRunEvent(runId: string | undefined): boolean;
  /** 设 activeRunId=runId、uiRunning=true（幂等）；不 increment agentActive。 */
  onRunStarted(payload: AgentRunStartedPayload): void;
  /** accept 后：activeRunId=null、uiRunning=false；不 decrement agentActive。 */
  onRunFinished(payload: AgentRunFinishedPayload): void;
  onRunFailed(payload: AgentRunFailedPayload): void;
  resetUiForSessionChange(): void;
};

export type UseAgentRunLifecycleParams = {
  readonly onStreamReset?: () => void;
};

export function useAgentRunLifecycle({
  onStreamReset,
}: UseAgentRunLifecycleParams = {}): AgentRunLifecycle {
  const [uiRunning, setUiRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const uiRunningRef = useRef(false);
  const onStreamResetRef = useRef(onStreamReset);
  onStreamResetRef.current = onStreamReset;

  const syncActiveRunId = useCallback((runId: string | null) => {
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
  }, []);

  const setUiRunningSynced = useCallback((next: boolean) => {
    uiRunningRef.current = next;
    setUiRunning(next);
  }, []);

  const beginUiRun = useCallback(() => {
    setUiRunningSynced(true);
    incrementAgentActive();
  }, [setUiRunningSynced]);

  const abortUiRun = useCallback(() => {
    setUiRunningSynced(false);
    syncActiveRunId(null);
    onStreamResetRef.current?.();
  }, [setUiRunningSynced, syncActiveRunId]);

  const acceptRunEvent = useCallback((runId: string | undefined): boolean => {
    if (runId == null || runId.length === 0) {
      return false;
    }
    const current = activeRunIdRef.current;
    if (current == null) {
      return false;
    }
    return current === runId;
  }, []);

  const onRunStarted = useCallback(
    (payload: AgentRunStartedPayload) => {
      if (!uiRunningRef.current && activeRunIdRef.current == null) {
        return;
      }
      syncActiveRunId(payload.runId);
      setUiRunningSynced(true);
    },
    [setUiRunningSynced, syncActiveRunId],
  );

  const onRunFinished = useCallback(
    (_payload: AgentRunFinishedPayload) => {
      syncActiveRunId(null);
      setUiRunningSynced(false);
    },
    [setUiRunningSynced, syncActiveRunId],
  );

  const onRunFailed = useCallback(
    (_payload: AgentRunFailedPayload) => {
      syncActiveRunId(null);
      setUiRunningSynced(false);
    },
    [setUiRunningSynced, syncActiveRunId],
  );

  const resetUiForSessionChange = useCallback(() => {
    setUiRunningSynced(false);
    syncActiveRunId(null);
    onStreamResetRef.current?.();
  }, [setUiRunningSynced, syncActiveRunId]);

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
