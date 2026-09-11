/**
 * Isolated metrics bar — 250ms tick re-renders only this subtree, not ChatConversationPanel.
 *
 * Step 6 起数据源换 SessionStreamUnitManager 投影（stream-metrics-store 退役
 * 方向），双源为「单元快照优先 / settled 投影兜底」：
 * - 有单元快照：活跃（starting|running）走连续历时（自 startedAtMs 起算）；
 *   终态（interrupted|finished|failed）走冻结现场——重启水合的 interrupted
 *   单元常驻但不写 settled 行，快照是其唯一可显示源（杀进程重进指标恢复）；
 * - 无单元（宽限销毁/LRU 淘汰/水合前）：manager 级 settled 投影
 *   （「上次生成」冻结快照，跨重启由持久层 settled 行回填）。
 * manager.subscribe 驱动收尾/切会话/水合回填的即时刷新；活跃期间另有
 * 250ms tick 刷新 live 计时。
 */
import React, {useEffect, useState} from 'react';
import {
  type AgentStreamMetricsView,
  toAgentStreamMetricsView,
} from '@/hooks/useAgentStreamMetrics';
import {useRuntime} from '@/hooks/useRuntime';
import {isSessionStreamUnitSettled} from '@/services/session-stream-unit';
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
  /** 中断现场的正面标识（Step 7）：仅水合出的 interrupted 单元冻结指标携带。 */
  let interrupted = false;
  if (sessionId != null) {
    const view = manager.snapshot(sessionId);
    if (view != null && isSessionStreamUnitSettled(view.status)) {
      // 终态快照即冻结指标。事件收尾的单元 elapsedMs 已冻结；水合
      // interrupted 单元 elapsedMs 为 null，以 settledAtMs-startedAtMs
      // 近似冻结历时；starting 阶段被杀的 run（计时与字数皆零）无内容
      // 可展示，跳过以免空指标条常驻。
      if (
        view.startedAtMs > 0 ||
        view.metrics.textChars > 0 ||
        view.metrics.thinkingChars > 0
      ) {
        interrupted = view.status === 'interrupted';
        const elapsedMs =
          view.elapsedMs != null
            ? view.elapsedMs
            : view.startedAtMs > 0
              ? Math.max(
                  0,
                  (view.settledAtMs ?? Date.now()) - view.startedAtMs,
                )
              : 0;
        metrics = toAgentStreamMetricsView(false, {
          elapsedMs,
          textChars: view.metrics.textChars,
          thinkingChars: view.metrics.thinkingChars,
        });
      }
    } else if (agentRunning && view != null && view.startedAtMs > 0) {
      const elapsedMs = Math.max(0, Date.now() - view.startedAtMs);
      metrics = toAgentStreamMetricsView(true, {
        elapsedMs,
        textChars: view.metrics.textChars,
        thinkingChars: view.metrics.thinkingChars,
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

  return <ChatStreamMetricsBar metrics={metrics} interrupted={interrupted} />;
}
