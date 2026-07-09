import {deriveRegexGroupId} from '@novel-master/core/format';

describe('deriveRegexGroupId', () => {
  it('slugifies display name', () => {
    expect(deriveRegexGroupId('对话清洗', new Set())).toBe('对话清洗');
  });

  it('deduplicates when id is taken', () => {
    const taken = new Set(['dialog-clean']);
    expect(deriveRegexGroupId('Dialog Clean', taken)).toBe('dialog-clean-2');
  });
});
