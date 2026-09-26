import {describe, expect, it} from '@jest/globals';
import {buildChatStreamMetricsLine} from '@/hooks/useAgentStreamMetrics';

// 历时分段/千分位口径的单源在 core（`formatStreamElapsed` /
// `formatCharCount`），边界用例由 core 侧测试覆盖（cr-fix-spec
// core-metrics/C-2）；移动端旧 hook 的本地副本与再导出已删
//（cr-fix-spec mobile-metrics/C-3），这里只锁消费侧文案形态。
describe('buildChatStreamMetricsLine（T-M8 文案快照）', () => {
  it('生成中 · 秒 · 输出 token · 速率全段拼接（与 desktop 一致）', () => {
    const line = buildChatStreamMetricsLine({
      running: true,
      elapsedMs: 12_300,
      completionTokens: 1_234,
      tokenSource: 'usage',
      tokensPerSecond: 45,
    });
    expect(line).toBe('生成中 · 12.3s · 输出 1,234 t · 45 t/s');
  });

  it('无速率样本时省略速率段（上次生成冻结态）', () => {
    const line = buildChatStreamMetricsLine({
      running: false,
      elapsedMs: 5_000,
      completionTokens: 28,
      tokenSource: 'heuristic',
      tokensPerSecond: null,
    });
    expect(line).toBe('上次生成 · 5.0s · 输出 28 t');
  });

  it('正文/思考不再分列（token 化改版后的形态锁定）', () => {
    const line = buildChatStreamMetricsLine({
      running: true,
      elapsedMs: 3_000,
      completionTokens: 90,
      tokenSource: 'heuristic',
      tokensPerSecond: 30,
    });
    expect(line).not.toContain('正文');
    expect(line).not.toContain('思考');
    expect(line).toContain('输出 90 t');
  });
});
