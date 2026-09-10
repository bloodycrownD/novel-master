/**
 * Isolated metrics bar — 250ms tick re-renders only this subtree, not ChatConversationPanel.
 */
import React, {useEffect, useState} from 'react';
import {
  type AgentStreamMetricsView,
  toAgentStreamMetricsView,
} from '@/hooks/useAgentStreamMetrics';
import {
  getLastRunMetrics,
  getLiveMetrics,
} from '@/services/stream-metrics-store';
import {ChatStreamMetricsBar} from './ChatStreamMetricsBar';

type Props = {
  readonly agentRunning: boolean;
  /** 指标归属会话：切会话只换数据源，不重置（见 stream-metrics-store）。 */
  readonly sessionId: string | undefined;
};

export function ChatStreamMetricsBarLive({agentRunning, sessionId}: Props) {
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
  if (agentRunning && sessionId != null) {
    const live = getLiveMetrics(sessionId);
    if (live.startedAtMs > 0) {
      const elapsedMs = Math.max(0, Date.now() - live.startedAtMs);
      metrics = toAgentStreamMetricsView(true, {
        elapsedMs,
        textChars: live.textChars,
        thinkingChars: live.thinkingChars,
      });
    }
  }
  if (metrics == null && sessionId != null) {
    const lastRun = getLastRunMetrics(sessionId);
    if (lastRun != null) {
      metrics = toAgentStreamMetricsView(false, lastRun);
    }
  }

  if (metrics == null) {
    return null;
  }

  return <ChatStreamMetricsBar metrics={metrics} />;
}
