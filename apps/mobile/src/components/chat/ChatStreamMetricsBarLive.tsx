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
 *
 * stream-metrics-tokens：活跃 run 的实时速率由本组件采样喂
 * slidingTokenRate——tick/通知驱动的每次重渲染把「当前累计 token」采成
 * (t, tokens) 样本；heuristic→usage 校正点（tokenSource 翻转、累计值跳变）
 * 样本序列清空重 seed，防一次巨大差分污染速率。冻结态不喂速率（无实时
 * 语义，文案省略速率段）。
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  createTokenRateSampler,
  type TokenRateSampler,
} from '@novel-master/core/format';
import {
  type AgentStreamMetricsView,
  toAgentStreamMetricsView,
} from '@/hooks/useAgentStreamMetrics';
import {useRuntime} from '@/hooks/useRuntime';
import {isSessionStreamUnitSettled} from '@/services/session-stream-unit';
import {timingLog} from '@/debug/run-timing';
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
  const samplerRef = useRef<TokenRateSampler>(createTokenRateSampler());
  const samplerRunKeyRef = useRef('');

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

  // 首帧延迟打点：agentRunning 翻真后的首次渲染时刻（React 实际画出来的时机）
  useEffect(() => {
    if (agentRunning) {
      timingLog('metrics bar rendered');
    }
  }, [agentRunning]);

  /** 采样并算速率（渲染期调用，幂等——tokens 未变不产生新样本）。 */
  const sampleRate = (
    runKey: string,
    tokens: number,
    source: string,
  ): number | null => {
    // 新 run（或数据源切换）：整体重 seed，防跨 run 差分。
    if (samplerRunKeyRef.current !== runKey) {
      samplerRunKeyRef.current = runKey;
      samplerRef.current.reset();
    }
    return samplerRef.current.sample(tokens, source, Date.now());
  };

  let metrics: AgentStreamMetricsView | null = null;
  /** 中断现场的正面标识（Step 7）：仅水合出的 interrupted 单元冻结指标携带。 */
  let interrupted = false;
  if (sessionId != null) {
    const view = manager.snapshot(sessionId);
    if (view != null && isSessionStreamUnitSettled(view.status)) {
      // 终态快照即冻结指标。事件收尾的单元 elapsedMs 已冻结；水合
      // interrupted 单元 elapsedMs 为 null，以 settledAtMs-startedAtMs
      // 近似冻结历时；全零守卫兜底极老形态（起点与字数皆无的空行）。
      // 受理即置起点后，starting 阶段被杀的水合单元带短历时（字数为零）
      // ——「已中断 · 数百 ms」比静默消失更可感知，属预期口径。
      if (
        view.startedAtMs > 0 ||
        view.metrics.textChars > 0 ||
        view.metrics.thinkingChars > 0 ||
        view.metrics.completionTokens > 0
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
        // 冻结态：token 计数照显，速率段省略（无实时语义）。
        metrics = toAgentStreamMetricsView(false, {
          elapsedMs,
          completionTokens: view.metrics.completionTokens,
          tokenSource: view.metrics.tokenSource,
        });
      }
    } else if (agentRunning && view != null && view.startedAtMs > 0) {
      // starting 阶段起点已随 begin() 置位（用户请求时刻），指标条自受理
      // 即显示（计时在走、token 为零的「准备中」形态），不等 RUN_STARTED。
      const elapsedMs = Math.max(0, Date.now() - view.startedAtMs);
      metrics = toAgentStreamMetricsView(
        true,
        {
          elapsedMs,
          completionTokens: view.metrics.completionTokens,
          tokenSource: view.metrics.tokenSource,
        },
        sampleRate(
          `${sessionId}:${view.runId ?? ''}`,
          view.metrics.completionTokens,
          view.metrics.tokenSource,
        ),
      );
    }
  }
  if (metrics == null && sessionId != null) {
    const lastRun = manager.getSettledProjection(sessionId);
    if (lastRun != null) {
      metrics = toAgentStreamMetricsView(false, {
        elapsedMs: lastRun.elapsedMs,
        completionTokens: lastRun.metrics.completionTokens,
        tokenSource: lastRun.metrics.tokenSource,
      });
    }
  }

  if (metrics == null) {
    return null;
  }

  return <ChatStreamMetricsBar metrics={metrics} interrupted={interrupted} />;
}
