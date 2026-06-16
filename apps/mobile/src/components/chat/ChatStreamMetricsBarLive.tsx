/**
 * Isolated metrics bar — 250ms tick re-renders only this subtree, not ChatConversationPanel.
 */
import React, {useEffect, useState} from 'react';
import {
  type AgentStreamMetricsSnapshot,
  type AgentStreamMetricsView,
  toAgentStreamMetricsView,
  snapshotMetricsAcc,
  type StreamMetricsAccRef,
} from '../../hooks/useAgentStreamMetrics';
import {ChatStreamMetricsBar} from './ChatStreamMetricsBar';

type Props = {
  readonly agentRunning: boolean;
  readonly accRef: StreamMetricsAccRef;
  readonly lastRun: AgentStreamMetricsSnapshot | null;
};

export function ChatStreamMetricsBarLive({
  agentRunning,
  accRef,
  lastRun,
}: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!agentRunning) {
      return undefined;
    }
    const id = setInterval(() => {
      setTick(t => t + 1);
    }, 250);
    return () => clearInterval(id);
  }, [agentRunning]);

  let metrics: AgentStreamMetricsView | null = null;
  if (agentRunning && accRef.current.startedAtMs > 0) {
    const elapsedMs = Math.max(0, Date.now() - accRef.current.startedAtMs);
    metrics = toAgentStreamMetricsView(
      true,
      snapshotMetricsAcc(accRef.current, elapsedMs),
    );
  } else if (lastRun != null) {
    metrics = toAgentStreamMetricsView(false, lastRun);
  }

  if (metrics == null) {
    return null;
  }

  return <ChatStreamMetricsBar metrics={metrics} />;
};
