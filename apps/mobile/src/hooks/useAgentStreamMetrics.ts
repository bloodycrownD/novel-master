/**
 * 指标条 View 构造与文案（stream-metrics-tokens 起 hook 本体退役——
 * 数据源已由 SessionStreamUnitManager 投影承担，本模块只保留被
 * ChatStreamMetricsBar / ChatStreamMetricsBarLive 复用的纯函数与类型）。
 */
import {
  buildStreamMetricsLine,
  formatCharCount,
} from '@novel-master/core/format';

export {formatCharCount};

/** token 计数来源：usage=事件真值（run 级累计）；heuristic=字符折算兜底。 */
export type AgentStreamTokenSource = 'usage' | 'heuristic';

/** 指标快照：历时与 token 计数（文案消费的最小集）。 */
export type AgentStreamMetricsSnapshot = {
  readonly elapsedMs: number;
  readonly completionTokens: number;
  readonly tokenSource: AgentStreamTokenSource;
};

export type AgentStreamMetricsView = AgentStreamMetricsSnapshot & {
  readonly running: boolean;
  /** 实时速率（token/秒，slidingTokenRate 产物）；null = 省略速率段。 */
  readonly tokensPerSecond: number | null;
};

/** 快照 → 展示 View（冻结态不喂速率，tokensPerSecond 缺省 null）。 */
export function toAgentStreamMetricsView(
  running: boolean,
  snap: AgentStreamMetricsSnapshot,
  tokensPerSecond: number | null = null,
): AgentStreamMetricsView {
  return {...snap, running, tokensPerSecond};
}

/** 格式化秒数（60s 内一位小数，否则整数）。 */
export function formatStreamElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

/** 构建 metrics 条文案（供 ChatStreamMetricsBar 与单测共用）。 */
export function buildChatStreamMetricsLine(
  metrics: AgentStreamMetricsView,
): string {
  return buildStreamMetricsLine(metrics);
}
