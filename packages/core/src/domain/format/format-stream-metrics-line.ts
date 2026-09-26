/**
 * 流式 metrics 条文案（Mobile/Desktop 共用，stream-metrics-tokens 改版）。
 *
 * 形态：「{prefix} · {elapsed} · 输出 {N} t · {rate} t/s」。正文/思考不再
 * 分列——思考期在 anthropic/gemini 下 usage 已含、heuristic 下随正文一并
 * 累计字符按 ceil 口径折算，天然并入输出。速率段仅在实时速率可得时拼接
 * （样本不足时省略，避免除零/首秒抖动）。
 *
 * @module domain/format/format-stream-metrics-line
 */

import {formatCharCount} from "./format-char-count.js";

/** 流式 metrics 展示切片。 */
export type StreamMetricsLineInput = {
  readonly running: boolean;
  readonly elapsedMs: number;
  /** run 级累计输出 token（usage=基线来自事件真值，读值=基线+增量；heuristic=基线为 0 的纯估算）。 */
  readonly completionTokens: number;
  /** 实时速率（token/秒，slidingTokenRate 产物）；null = 省略速率段。 */
  readonly tokensPerSecond: number | null;
};

/**
 * 历经秒数 → 展示文案：60s 内一位小数（`12.3s`）、60s 起取整（`61s`）。
 *
 * core 单点实现，双端 hook（mobile / desktop）直接引用，不再各自维护副本
 * ——口径漂移会让两端文案不一致。
 */
export function formatStreamElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

/**
 * t/s 数字格式（对齐统计页 formatTokensPerSecond 惯例：≥100 整数、否则
 * 1 位小数；整数值不带尾随 .0——与 T-M8 例文「45 t/s」形态一致）。
 */
function formatTokensPerSecondValue(rate: number): string {
  if (rate >= 100) {
    return `${Math.round(rate)}`;
  }
  return `${Number.parseFloat(rate.toFixed(1))}`;
}

/** 构建 metrics 条文案（供 ChatStreamMetricsBar 与单测共用）。 */
export function buildStreamMetricsLine(
  metrics: StreamMetricsLineInput,
): string {
  const elapsedSec = metrics.elapsedMs / 1000;
  const elapsedLabel = formatStreamElapsed(elapsedSec);
  const prefix = metrics.running ? "生成中" : "上次生成";
  const parts: string[] = [
    `${prefix} · ${elapsedLabel}`,
    `输出 ${formatCharCount(metrics.completionTokens)} t`,
  ];
  if (metrics.tokensPerSecond != null) {
    parts.push(`${formatTokensPerSecondValue(metrics.tokensPerSecond)} t/s`);
  }
  return parts.join(" · ");
}
