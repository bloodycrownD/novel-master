import { formatCharCount } from "./format-char-count.js";

/** 流式 metrics 展示切片（Mobile/Desktop 共用）。 */
export type StreamMetricsLineInput = {
  readonly running: boolean;
  readonly elapsedMs: number;
  readonly textChars: number;
  readonly thinkingChars: number;
  readonly totalChars: number;
  readonly charsPerSecond: number;
};

function formatStreamElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

/** 构建 metrics 条文案（供 ChatStreamMetricsBar 与单测共用）。 */
export function buildStreamMetricsLine(metrics: StreamMetricsLineInput): string {
  const elapsedSec = metrics.elapsedMs / 1000;
  const elapsedLabel = formatStreamElapsed(elapsedSec);
  const rate =
    metrics.charsPerSecond >= 10
      ? Math.round(metrics.charsPerSecond)
      : Math.round(metrics.charsPerSecond * 10) / 10;

  const prefix = metrics.running ? "生成中" : "上次生成";
  const parts: string[] = [
    `${prefix} · ${elapsedLabel}`,
    `正文 ${formatCharCount(metrics.textChars)} 字`,
  ];
  if (metrics.thinkingChars > 0) {
    parts.push(`思考 ${formatCharCount(metrics.thinkingChars)} 字`);
  }
  if (metrics.totalChars > 0 && elapsedSec > 0) {
    parts.push(`${rate} 字/秒`);
  }
  return parts.join(" · ");
}
