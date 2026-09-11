/**
 * Isolated metrics bar — 250ms tick re-renders only this subtree, not ChatConversationPanel.
 *
 * Step 6 起数据源换 SessionStreamUnitManager 投影（stream-metrics-store 退役
 * 方向）：活跃单元走 snapshot(sessionId)（连续历时自 startedAtMs 起算），
 * 空闲会话走 manager 级 settled 投影（「上次生成」冻结快照，跨重启由
 * 持久层 settled 行回填）。manager.subscribe 驱动收尾/切会话的即时刷新。
 */
import React, {useEffect, useState} from 'react';
import {
  type AgentStreamMetricsView,
  toAgentStreamMetricsView,
} from '@/hooks/useAgentStreamMetrics';
import {useRuntime} from '@/hooks/useRuntime';
import {ChatStreamMetricsBar} from './ChatStreamMetricsBar';

type Props = {
  readonly agentRunning: boolean;
  /** 指标归属会话：切会话只换数据源，不重置（单元/ settled 投影按会话归属）。 */
  readonly sessionId: string | undefined;
};

export function ChatStreamMetricsBarLive({agentRunning, sessionId}: Props) {
  const runtime = useRuntime();
  const manager = runtime.sessionStreamUnitManager;
  const [, setTick] = useState(0);

  // 活跃期间 250ms tick 刷新 live 计时；空闲时靠 manager 订阅触发
  // （收尾写 settled 投影、切会话换源、水合回填均经 notifyChanged）。
  useEffect(() => {
    if (!agentRunning) {
      return undefined;
    }
    const id = setInterval(() => {
      setTick(t => t + 1);
    }, 250);
    return () => clearInterval(id);
  }, [agentRunning]);

  useEffect(() => {
    const sync = () => setTick(t => t + 1);
    return manager.subscribe(sync);
  }, [manager]);

  let metrics: AgentStreamMetricsView | null = null;
  if (agentRunning && sessionId != null) {
    const live = manager.snapshot(sessionId);
    if (live != null && live.startedAtMs > 0) {
      const elapsedMs = Math.max(0, Date.now() - live.startedAtMs);
      metrics = toAgentStreamMetricsView(true, {
        elapsedMs,
        textChars: live.metrics.textChars,
        thinkingChars: live.metrics.thinkingChars,
      });
    }
  }
  if (metrics == null && sessionId != null) {
    const lastRun = manager.getSettledProjection(sessionId);
    if (lastRun != null) {
      metrics = toAgentStreamMetricsView(false, {
        elapsedMs: lastRun.elapsedMs,
        textChars: lastRun.metrics.textChars,
        thinkingChars: lastRun.metrics.thinkingChars,
      });
    }
  }

  if (metrics == null) {
    return null;
  }

  return <ChatStreamMetricsBar metrics={metrics} />;
}
