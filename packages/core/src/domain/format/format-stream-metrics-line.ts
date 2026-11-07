/**
 * 流式 metrics 条文案（Mobile/Desktop 共用，stream-metrics-tokens 改版）。
 *
 * 形态：`{prefix} · {elapsed} · {body}`，正文/思考不再分列——思考期在
 * anthropic/gemini 下 usage 已含、heuristic 下随正文一并累计字符按 ceil 口径
 * 折算，天然并入输出。速率段仅在实时速率可得时并入 body（样本不足时省略，
 * 避免除零/首秒抖动）。prefix/body 为 descriptor（G3.6 四 key），由双端
 * wrapper 用 core translator 渲染后以 string 进 UI。
 *
 * @module domain/format/format-stream-metrics-line
 */

import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import { formatCharCount } from "./format-char-count.js";

/** 流式 metrics 展示切片。 */
export type StreamMetricsLineInput = {
  readonly running: boolean;
  readonly elapsedMs: number;
  /** run 级累计输出 token（usage=基线来自事件真源，读值=基线+增量；heuristic=基线为 0 的纯估算）。 */
  readonly completionTokens: number;
  /** 实时速率（token/秒，slidingTokenRate 产物）；null = 省略速率段。 */
  readonly tokensPerSecond: number | null;
};

/** metrics 条的可翻译切片：消费方按 `{prefix} · {elapsed} · {body}` 组装。 */
export interface StreamMetricsLineParts {
  readonly prefix: CoreMessageDescriptor;
  readonly elapsed: string;
  readonly body: CoreMessageDescriptor;
}

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

/** 构建 metrics 条文案切片（供 ChatStreamMetricsBar 与单测共用）。 */
export function buildStreamMetricsLine(metrics: StreamMetricsLineInput): StreamMetricsLineParts {
  const tokens = formatCharCount(metrics.completionTokens);
  if (metrics.tokensPerSecond != null) {
    // tok/s 数字格式（对齐统计页 formatTokensPerSecond 惯例：≥100 整数、否则
    // 1 位小数；整数值不带尾随 .0——与 T-M8 例文「45 tok/s」形态一致）。
    const rate = metrics.tokensPerSecond;
    return {
      prefix: { key: metrics.running ? "label.stream_metrics.running" : "label.stream_metrics.last" },
      elapsed: formatStreamElapsed(metrics.elapsedMs / 1000),
      body: { key: "label.stream_metrics.line_with_rate", params: { tokens, rate: rate >= 100 ? Math.round(rate) : Number.parseFloat(rate.toFixed(1)) } },
    };
  }
  return {
    prefix: { key: metrics.running ? "label.stream_metrics.running" : "label.stream_metrics.last" },
    elapsed: formatStreamElapsed(metrics.elapsedMs / 1000),
    body: { key: "label.stream_metrics.line", params: { tokens } },
  };
}
