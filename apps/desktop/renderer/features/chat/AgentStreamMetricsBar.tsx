/**
 * Agent 流式生成计时与输出 token（不含 tool 参数）。
 *
 * stream-metrics-tokens：速率读数由 useAgentStreamMetrics 统一提供——
 * 运行中为实时滑窗值（采样序列在 hook 内维护，暂停期随 nowMs 衰减），
 * 冻结态为收尾冻结的末值（「上次生成 … · N t/s」），无样本时省略速率段。
 * 本组件只渲染，不采样。
 *
 * metric-detail-sheet：根节点 button 化（语义点击入口 + aria-live 保留），
 * onClick 由父层 ConversationPanel 传入（弹 MetricsDetailPopover）。
 */
import { buildAgentStreamMetricsLabel, type AgentStreamMetricsView } from "@/hooks/useAgentStreamMetrics";

type Props = {
  metrics: AgentStreamMetricsView;
  /** 点击指标条打开用量详情弹窗（metric-detail-sheet）；不传仍可聚焦播报。 */
  onClick?: () => void;
  /** 锚定弹窗用：按钮 DOM 引用透传给父层（MetricsDetailPopover 定位锚点）。 */
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
};

export function AgentStreamMetricsBar({ metrics, onClick, buttonRef }: Props) {
  const line = buildAgentStreamMetricsLabel(metrics);

  return (
    <button
      type="button"
      ref={buttonRef}
      className="agent-stream-metrics-bar"
      aria-live="polite"
      aria-label={`流式指标：${line}`}
      onClick={onClick}
    >
      <span className="agent-stream-metrics-bar__line">{line}</span>
    </button>
  );
}
