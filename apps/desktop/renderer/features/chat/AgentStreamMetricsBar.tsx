/**
 * Run 计时与流式字数（token 吞吐代理指标）。
 */
import {
  formatCharCount,
  formatStreamElapsed,
  type AgentStreamMetricsView,
} from "../../hooks/useAgentStreamMetrics";

type Props = {
  metrics: AgentStreamMetricsView;
};

export function buildAgentStreamMetricsLabel(
  metrics: AgentStreamMetricsView,
): string {
  const elapsedSec = metrics.elapsedMs / 1000;
  const elapsedLabel = formatStreamElapsed(elapsedSec);
  const rate =
    metrics.charsPerSecond >= 10
      ? Math.round(metrics.charsPerSecond)
      : Math.round(metrics.charsPerSecond * 10) / 10;

  // 思考已结束、仅工具参数增量时 streamKind 可能为 mixed，仍应显示工具调用前缀。
  const toolCallingPrefix =
    metrics.running &&
    metrics.toolUseChars > 0 &&
    metrics.textChars === 0;

  if (metrics.streamKind === "tool") {
    const prefix = metrics.running ? "工具调用生成中" : "上次生成";
    const parts = [
      `${prefix} · ${elapsedLabel}`,
      `工具参数 ${formatCharCount(metrics.toolUseChars)} 字`,
    ];
    if (metrics.toolUseChars > 0 && elapsedSec > 0) {
      parts.push(`${rate} 字/秒`);
    }
    return parts.join(" · ");
  }

  const prefix = metrics.running
    ? toolCallingPrefix
      ? "工具调用生成中"
      : "生成中"
    : "上次生成";
  const parts: string[] = [`${prefix} · ${elapsedLabel}`];

  if (metrics.streamKind === "mixed") {
    parts.push(`正文 ${formatCharCount(metrics.textChars)} 字`);
    if (metrics.thinkingChars > 0) {
      parts.push(`思考 ${formatCharCount(metrics.thinkingChars)} 字`);
    }
    parts.push(`工具参数 ${formatCharCount(metrics.toolUseChars)} 字`);
  } else {
    parts.push(`正文 ${formatCharCount(metrics.textChars)} 字`);
    if (metrics.thinkingChars > 0) {
      parts.push(`思考 ${formatCharCount(metrics.thinkingChars)} 字`);
    }
  }

  if (metrics.totalChars > 0 && elapsedSec > 0) {
    parts.push(`${rate} 字/秒`);
  }

  return parts.join(" · ");
}

export function AgentStreamMetricsBar({ metrics }: Props) {
  return (
    <div className="agent-stream-metrics-bar" aria-live="polite">
      <span className="agent-stream-metrics-bar__line">
        {buildAgentStreamMetricsLabel(metrics)}
      </span>
    </div>
  );
}
