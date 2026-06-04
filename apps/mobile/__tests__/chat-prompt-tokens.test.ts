import {formatPromptTokenUsageLabel} from '../src/utils/format-token-count';

describe('chat-prompt-tokens.service', () => {
  it('formatPromptTokenUsageLabel shows percentage with context window', () => {
    expect(formatPromptTokenUsageLabel(64000, 128000)).toBe('50% • 64K/128K');
  });

  it('formatPromptTokenUsageLabel marks estimated fallback', () => {
    expect(formatPromptTokenUsageLabel(1000, undefined, {estimated: true})).toBe(
      '~1K tokens (est.)',
    );
  });
});
