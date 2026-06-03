import {
  formatCharCount,
  formatStreamElapsed,
} from '../src/hooks/useAgentStreamMetrics';

describe('useAgentStreamMetrics formatters', () => {
  it('formatStreamElapsed uses one decimal under 60s', () => {
    expect(formatStreamElapsed(12.34)).toBe('12.3s');
    expect(formatStreamElapsed(90)).toBe('90s');
  });

  it('formatCharCount uses zh-CN grouping', () => {
    expect(formatCharCount(1234)).toMatch(/1/);
    expect(formatCharCount(1234).length).toBeGreaterThan(3);
  });
});
