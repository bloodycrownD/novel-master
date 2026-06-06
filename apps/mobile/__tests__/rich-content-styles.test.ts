import {
  buildRichContentCssRules,
  CHAT_TRANSCRIPT_RICH_CSS,
  RICH_DOCUMENT_RICH_CSS,
} from '../src/web/rich-content-styles';

describe('rich-content-styles', () => {
  it('includes list padding for shared rich rules', () => {
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('padding-left: 1.35em');
    expect(RICH_DOCUMENT_RICH_CSS).toContain('padding-left: 1.35em');
  });

  it('builds compound selectors for multiple roots', () => {
    const css = buildRichContentCssRules(['.a.rich', '.b.rich']);
    expect(css).toContain('.a.rich p, .b.rich p');
    expect(css).toContain('.a.rich ol, .b.rich ol, .a.rich ul, .b.rich ul');
  });
});
