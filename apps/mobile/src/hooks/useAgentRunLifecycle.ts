/**
 * Agent 回合 UI 生命周期：uiRunning + activeRunId。
 * agentActive refcount 由平台层独占；beginUiRun 递增，RUN_FINISHED/FAILED 在 stream runtime 递减。
 */
import {
  shouldAcceptRunEvent,
  shouldIgnoreStaleRunStarted,
} from '@novel-master/core/agent';
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
  /** 终止：uiRunning=false + onStreamReset + 可选 freeze 快照；不碰 agentActive；不清 activeRunId，由 FINISHED/FAILED 清除。 */
  abortUiRun(freezeAt?: number): void;
  /** 同步读 uiRunning（bus 回调须用此，禁止读 React state）。 */
  getUiRunning(): boolean;
  /** 同步读 abort 时快照的消息条数；非 null 时禁止增列表 reload。 */
  getTranscriptFreezeCount(): number | null;
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
  const transcriptFreezeCountRef = useRef<number | null>(null);
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

  const getUiRunning = useCallback((): boolean => uiRunningRef.current, []);

  const getTranscriptFreezeCount = useCallback(
    (): number | null => transcriptFreezeCountRef.current,
    [],
  );

  const abortUiRun = useCallback(
    (freezeAt?: number) => {
      if (freezeAt != null) {
        transcriptFreezeCountRef.current = freezeAt;
      }
      setUiRunningSynced(false);
      onStreamResetRef.current?.();
    },
    [setUiRunningSynced],
  );

  const acceptRunEvent = useCallback((runId: string | undefined): boolean => {
    return shouldAcceptRunEvent(activeRunIdRef.current, runId);
  }, []);

  const onRunStarted = useCallback(
    (payload: AgentRunStartedPayload) => {
      // abort 后 uiRunning=false 时忽略迟到 RUN_STARTED（与 Desktop 对称）
      if (
        shouldIgnoreStaleRunStarted(
          uiRunningRef.current,
          activeRunIdRef.current,
        )
      ) {
        return;
      }
      syncActiveRunId(payload.runId);
      setUiRunningSynced(true);
    },
    [setUiRunningSynced, syncActiveRunId],
  );

  const onRunFinished = useCallback(
    (_payload: AgentRunFinishedPayload) => {
      transcriptFreezeCountRef.current = null;
      syncActiveRunId(null);
      setUiRunningSynced(false);
    },
    [setUiRunningSynced, syncActiveRunId],
  );

  const onRunFailed = useCallback(
    (_payload: AgentRunFailedPayload) => {
      transcriptFreezeCountRef.current = null;
      syncActiveRunId(null);
      setUiRunningSynced(false);
    },
    [setUiRunningSynced, syncActiveRunId],
  );

  const resetUiForSessionChange = useCallback(() => {
    transcriptFreezeCountRef.current = null;
    setUiRunningSynced(false);
    syncActiveRunId(null);
    onStreamResetRef.current?.();
  }, [setUiRunningSynced, syncActiveRunId]);

  return {
    uiRunning,
    activeRunId,
    beginUiRun,
    abortUiRun,
    getUiRunning,
    getTranscriptFreezeCount,
    acceptRunEvent,
    onRunStarted,
    onRunFinished,
    onRunFailed,
    resetUiForSessionChange,
  };
}
