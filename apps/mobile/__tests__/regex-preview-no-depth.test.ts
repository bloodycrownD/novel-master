import {
  previewRegexReplacementOnly,
  previewRegexRule,
  type RegexRuleDraftFields,
} from '../src/services/regex-test.service';

describe('previewRegexReplacementOnly', () => {
  const baseFields: RegexRuleDraftFields = {
    name: 'secret',
    pattern: 'secret',
    flags: '',
    enabled: true,
    llmReplace: '[redacted]',
    displayReplace: '***',
    startDepth: 999,
    endDepth: 999,
    scopeUser: false,
    scopeAssistant: false,
  };

  it('忽略 depth/role，仍执行所选通道替换', () => {
    const result = previewRegexReplacementOnly('my secret text', baseFields, 'llm');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('my [redacted] text');
    }
  });

  it('display 通道使用 displayReplace', () => {
    const result = previewRegexReplacementOnly('my secret text', baseFields, 'display');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('my *** text');
    }
  });

  it('与 previewRegexRule 不同：role 不匹配时 full 预览跳过替换', () => {
    const roleScopedFields: RegexRuleDraftFields = {
      ...baseFields,
      startDepth: 0,
      endDepth: null,
      scopeUser: false,
      scopeAssistant: true,
    };
    const full = previewRegexRule('my secret text', roleScopedFields, {
      text: 'my secret text',
      channel: 'llm',
      depthFromTail: 0,
      role: 'user',
    });
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(full.text).toBe('my secret text');
    }

    const replacementOnly = previewRegexReplacementOnly(
      'my secret text',
      roleScopedFields,
      'llm',
    );
    expect(replacementOnly.ok).toBe(true);
    if (replacementOnly.ok) {
      expect(replacementOnly.text).toBe('my [redacted] text');
    }
  });

  it('规则禁用时返回原文', () => {
    const result = previewRegexReplacementOnly(
      'secret',
      {...baseFields, enabled: false},
      'llm',
    );
    expect(result).toEqual({ok: true, text: 'secret'});
  });
});
