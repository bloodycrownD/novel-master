import {
  buildRichContentCssRules,
  CHAT_TRANSCRIPT_RICH_CSS,
  RICH_DOCUMENT_RICH_CSS,
} from '../src/web/shared/rich-content-styles';

describe('rich-content-styles', () => {
  it('includes list padding for shared rich rules', () => {
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('.bubble-body.rich');
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('padding-left: 1.5em');
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('list-style-position: outside');
    expect(RICH_DOCUMENT_RICH_CSS).toContain('padding-left: 1.5em');
    expect(RICH_DOCUMENT_RICH_CSS).toContain('list-style-position: outside');
  });

  it('differentiates heading sizes and nested list spacing', () => {
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('font-size: 1.15em');
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('font-size: 1.08em');
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('.bubble.rich ul ul');
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('font-weight: 600');
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('border-top: 1px solid');
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain(':first-child { margin-top: 0; }');
  });

  it('builds compound selectors for multiple roots', () => {
    const css = buildRichContentCssRules(['.a.rich', '.b.rich']);
    expect(css).toContain('.a.rich p, .b.rich p');
    expect(css).toContain('.a.rich ol, .b.rich ol, .a.rich ul, .b.rich ul');
  });

  it('soft-wraps pre code blocks in chat and document rich CSS', () => {
    for (const css of [CHAT_TRANSCRIPT_RICH_CSS, RICH_DOCUMENT_RICH_CSS]) {
      expect(css).toContain('white-space: pre-wrap');
      expect(css).toContain('overflow-wrap: anywhere');
      expect(css).toContain('overflow-x: auto');
    }
  });
});
