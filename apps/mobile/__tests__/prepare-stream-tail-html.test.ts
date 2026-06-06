import {prepareStreamTailHtml} from '../src/components/chat/prepare-stream-tail-html';
import {RICH_CONTENT_MAX_CHARS} from '../src/components/rich-content/rich-content-limits';

describe('prepareStreamTailHtml', () => {
  it('returns undefined when richText is off', () => {
    expect(prepareStreamTailHtml('**bold**', false)).toBeUndefined();
  });

  it('returns sanitized HTML when richText is on', () => {
    const html = prepareStreamTailHtml('**bold** text', true);
    expect(html).toBeDefined();
    expect(html).toContain('<strong>');
    expect(html).toContain('bold');
  });

  it('returns undefined for empty or whitespace-only content', () => {
    expect(prepareStreamTailHtml('   ', true)).toBeUndefined();
  });

  it('returns undefined when content exceeds rich limit', () => {
    const over = 'a'.repeat(RICH_CONTENT_MAX_CHARS + 1);
    expect(prepareStreamTailHtml(over, true)).toBeUndefined();
  });
});
