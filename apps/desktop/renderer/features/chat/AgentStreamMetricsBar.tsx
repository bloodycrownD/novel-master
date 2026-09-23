/**
 * Agent 流式生成计时与输出 token（不含 tool 参数）。
 *
 * stream-metrics-tokens：实时速率由本组件采样喂滑窗——父级
 * （useAgentStreamMetrics 的 250ms tick）驱动的每次重渲染把「当前累计
 * token」交给共用采样器（core 的 createTokenRateSampler：token 变化才记
 * 样本、heuristic→usage 校正点重 seed）。冻结态（running=false 的「上次
 * 生成」）不喂速率，文案省略速率段。
 */
import { useRef } from "react";
import { createTokenRateSampler, type TokenRateSampler } from "@shared/logic/format";
import { buildAgentStreamMetricsLabel, type AgentStreamMetricsView } from "@/hooks/useAgentStreamMetrics";

type Props = {
  metrics: AgentStreamMetricsView;
};

export function AgentStreamMetricsBar({ metrics }: Props) {
  const samplerRef = useRef<TokenRateSampler>(createTokenRateSampler());

  /** 采样并算速率（渲染期调用，幂等——tokens 未变不产生新样本）。 */
  const sampleRate = (tokens: number, source: string): number | null =>
    samplerRef.current.sample(tokens, source, Date.now());

  const tokensPerSecond = metrics.running
    ? sampleRate(metrics.completionTokens, metrics.tokenSource)
    : null;
  const line = buildAgentStreamMetricsLabel({ ...metrics, tokensPerSecond });

  return (
    <div className="agent-stream-metrics-bar" aria-live="polite">
      <span className="agent-stream-metrics-bar__line">{line}</span>
    </div>
  );
}
