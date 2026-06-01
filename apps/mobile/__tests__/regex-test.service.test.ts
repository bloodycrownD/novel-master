import {
  previewRegexRule,
  regexPreviewRoleFromScope,
  validateRegexRuleDraft,
  type RegexRuleDraftFields,
} from '../src/services/regex-test.service';

describe('regex-test.service', () => {
  const baseFields: RegexRuleDraftFields = {
    name: 'secret',
    pattern: 'secret',
    flags: '',
    enabled: true,
    llmReplace: '[redacted]',
    displayReplace: null,
    startDepth: 0,
    endDepth: null,
    scopeUser: true,
    scopeAssistant: false,
  };

  it('validates missing replace channels', () => {
    const result = validateRegexRuleDraft({
      ...baseFields,
      llmReplace: null,
      displayReplace: null,
    });
    expect(result.ok).toBe(false);
  });

  it('previews llm channel replacement', () => {
    const result = previewRegexRule('my secret text', baseFields, {
      text: 'my secret text',
      channel: 'llm',
      depthFromTail: 0,
      role: regexPreviewRoleFromScope(baseFields),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('my [redacted] text');
    }
  });

  it('returns source when rule disabled', () => {
    const result = previewRegexRule('secret', {...baseFields, enabled: false}, {
      text: 'secret',
      channel: 'llm',
      depthFromTail: 0,
      role: 'user',
    });
    expect(result).toEqual({ok: true, text: 'secret'});
  });
});
