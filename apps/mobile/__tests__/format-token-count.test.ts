import {
  formatPromptTokenUsageLabel,
  formatTokenCount,
} from '../src/utils/format-token-count';

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

describe('formatPromptTokenUsageLabel', () => {
  it('shows percent and ratio against max tokens', () => {
    expect(formatPromptTokenUsageLabel(327, 128_000)).toBe('0% • 327/128K');
  });

  it('falls back to count only without max', () => {
    expect(formatPromptTokenUsageLabel(327)).toBe('327 tokens');
  });
});
