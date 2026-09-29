import {
  formatContextUsageLabel,
  formatPromptTokenUsageLabel,
  formatTokenCount,
  formatTokenSourceBadge,
} from '@novel-master/core/common';

describe('formatTokenCount', () => {
  it('formats small counts as integers', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokenCount(2500)).toBe('2.5K');
    expect(formatTokenCount(12000)).toBe('12K');
  });
});

describe('formatPromptTokenUsageLabel（token-source-label 新形态：badge 参数，无 ~ / estimated）', () => {
  it('shows count and ratio with percent against max tokens（2026-09-29 格式）', () => {
    expect(formatPromptTokenUsageLabel(327, 128_000)).toBe('327 / 128k (0%)');
  });

  it('falls back to count only without max', () => {
    expect(formatPromptTokenUsageLabel(327)).toBe('327 tokens');
  });

  it('prepends badge mark and connector when provided', () => {
    expect(
      formatPromptTokenUsageLabel(64_000, 128_000, {
        mark: '远程',
        connector: '=',
      }),
    ).toBe('远程 = 64k / 128k (50%)');
    expect(
      formatPromptTokenUsageLabel(2_345, undefined, {
        mark: 'gpt',
        connector: '≈',
      }),
    ).toBe('gpt ≈ 2.3k tokens');
  });

  it('非法 count 显示 —（不再输出 ~ 或 tokens (est.)）', () => {
    expect(formatPromptTokenUsageLabel(Number.NaN, 128_000)).toBe('—');
    expect(
      formatPromptTokenUsageLabel(-1, undefined, {
        mark: '远程',
        connector: '=',
      }),
    ).toBe('远程 = —');
  });

  it('与 formatContextUsageLabel 是同一实现（兼容名，单源）', () => {
    expect(formatPromptTokenUsageLabel).toBe(formatContextUsageLabel);
    expect(formatTokenSourceBadge('api', 'api', false)).toEqual({
      mark: '远程',
      connector: '=',
    });
  });
});
