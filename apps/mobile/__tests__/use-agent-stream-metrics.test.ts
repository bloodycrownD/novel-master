import {describe, expect, it} from '@jest/globals';
import {
  buildChatStreamMetricsLine,
  formatCharCount,
  formatStreamElapsed,
} from '../src/hooks/useAgentStreamMetrics';

describe('useAgentStreamMetrics formatters', () => {
  it('formatStreamElapsed uses one decimal under 60s', () => {
    expect(formatStreamElapsed(12.34)).toBe('12.3s');
    expect(formatStreamElapsed(61)).toBe('61s');
  });

  it('formatCharCount uses zh-CN grouping', () => {
    expect(formatCharCount(1234)).toMatch(/1/);
  });
});

describe('buildChatStreamMetricsLine', () => {
  it('运行中显示生成中、正文、思考与速率', () => {
    const line = buildChatStreamMetricsLine({
      running: true,
      elapsedMs: 10_000,
      textChars: 5,
      thinkingChars: 100,
      totalChars: 105,
      charsPerSecond: 10.5,
    });
    expect(line).toContain('生成中');
    expect(line).toContain('正文');
    expect(line).toContain('思考');
    expect(line).not.toContain('工具');
  });

  it('结束后显示上次生成', () => {
    const line = buildChatStreamMetricsLine({
      running: false,
      elapsedMs: 5000,
      textChars: 0,
      thinkingChars: 42,
      totalChars: 42,
      charsPerSecond: 8.4,
    });
    expect(line).toContain('上次生成');
  });
});
