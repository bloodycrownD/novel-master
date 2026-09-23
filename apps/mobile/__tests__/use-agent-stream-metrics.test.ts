import {describe, expect, it} from '@jest/globals';
import {
  buildChatStreamMetricsLine,
  formatCharCount,
  formatStreamElapsed,
} from '@/hooks/useAgentStreamMetrics';

describe('useAgentStreamMetrics formatters', () => {
  it('formatStreamElapsed uses one decimal under 60s', () => {
    expect(formatStreamElapsed(12.34)).toBe('12.3s');
    expect(formatStreamElapsed(61)).toBe('61s');
  });

  it('formatCharCount uses zh-CN grouping', () => {
    expect(formatCharCount(1234)).toMatch(/1/);
  });
});

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
