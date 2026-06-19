/**
 * Agent 流式生成计时与正/思考字数（不含 tool 参数）。
 */
import {
  buildAgentStreamMetricsLabel,
  type AgentStreamMetricsView,
} from "@/hooks/useAgentStreamMetrics";

export { buildAgentStreamMetricsLabel };

type Props = {
  metrics: AgentStreamMetricsView;
};

export function AgentStreamMetricsBar({ metrics }: Props) {
  return (
    <div className="agent-stream-metrics-bar" aria-live="polite">
      <span className="agent-stream-metrics-bar__line">
        {buildAgentStreamMetricsLabel(metrics)}
      </span>
    </div>
  );
}
