import {
  isRichContentOverLimit,
  RICH_CONTENT_MAX_CHARS,
} from '../src/components/rich-content/rich-content-limits';

describe('rich-content-limits', () => {
  it('treats content at max length as within limit', () => {
    expect(isRichContentOverLimit('a'.repeat(RICH_CONTENT_MAX_CHARS))).toBe(false);
  });

  it('treats content over max as over limit', () => {
    expect(isRichContentOverLimit('a'.repeat(RICH_CONTENT_MAX_CHARS + 1))).toBe(
      true,
    );
  });
});
