/**
 * 指标条 View 构造与文案（stream-metrics-tokens 起 hook 本体退役——
 * 数据源已由 SessionStreamUnitManager 投影承担，本模块只保留被
 * ChatStreamMetricsBar / ChatStreamMetricsBarLive 复用的纯函数与类型）。
 *
 * 历时分段格式（60s 内一位小数、否则整数）与千分位口径的单源在 core：
 * 本模块不再持有本地实现，文案统一经 core 的 `buildStreamMetricsLine`
 * （内部调用 core 的 `formatStreamElapsed`）生成。
 */
import {
  buildStreamMetricsLine,
  type StreamTokenSource,
} from '@novel-master/core/format';

/**
 * token 计数来源：usage=事件真值（run 级累计）；heuristic=字符折算兜底。
 *
 * 复用 core 的中立类型（别名，不再本地重声明联合字面量）——新增来源时
 * 单点改 core，消费端不会漏改。
 */
export type AgentStreamTokenSource = StreamTokenSource;

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

/** 构建 metrics 条文案（供 ChatStreamMetricsBar 与单测共用）。 */
export function buildChatStreamMetricsLine(
  metrics: AgentStreamMetricsView,
): string {
  return buildStreamMetricsLine(metrics);
}
