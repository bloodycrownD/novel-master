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

  it('T-S5: 定稿 HTML 对空伪标签不挖空', () => {
    const html = prepareStreamTailHtml(
      '表现为 <xxx></xxx> 之间没有文本',
      true,
    );
    expect(html).toBeDefined();
    expect(html).toContain('&lt;xxx&gt;');
    expect(html).toContain('&lt;/xxx&gt;');
    expect(html).not.toMatch(/表现为\s+之间没有文本/);
  });

  it('T-S5: 定稿 HTML 保留 file 伪标签结构', () => {
    const html = prepareStreamTailHtml('<file>notes.md</file>', true);
    expect(html).toBeDefined();
    expect(html).toContain('&lt;file&gt;');
    expect(html).toContain('notes.md');
    expect(html).toContain('&lt;/file&gt;');
  });
});
