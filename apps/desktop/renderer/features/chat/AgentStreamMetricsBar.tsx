/**
 * Agent 流式生成计时与输出 token（不含 tool 参数）。
 *
 * stream-metrics-tokens：速率读数由 useAgentStreamMetrics 统一提供——
 * 运行中为实时滑窗值（采样序列在 hook 内维护，暂停期随 nowMs 衰减），
 * 冻结态为收尾冻结的末值（「上次生成 … · N t/s」），无样本时省略速率段。
 * 本组件只渲染，不采样。
 */
import { buildAgentStreamMetricsLabel, type AgentStreamMetricsView } from "@/hooks/useAgentStreamMetrics";

type Props = {
  metrics: AgentStreamMetricsView;
};

export function AgentStreamMetricsBar({ metrics }: Props) {
  const line = buildAgentStreamMetricsLabel(metrics);

  return (
    <div className="agent-stream-metrics-bar" aria-live="polite">
      <span className="agent-stream-metrics-bar__line">{line}</span>
    </div>
  );
}
