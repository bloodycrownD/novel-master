import {decodeLiteralHtmlEntities} from '../src/components/rich-content/decode-literal-html-entities';
import {prepareTranscriptRichHtml} from '../src/components/rich-content/prepare-transcript-rich-html';

function bootEscapeHtml(text: string): string {
  const decoded = decodeLiteralHtmlEntities(text);
  return decoded
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

describe('quot display paths', () => {
  it('rich html path produces parseable quotes', () => {
    const html = prepareTranscriptRichHtml(
      '- 得到了一个&quot;重新做人&quot;的机会\n- **有意思**',
    );
    expect(html).toContain('"重新做人"');
    expect(html).not.toMatch(/&quot;/);
  });

  it('plain escapeHtml path produces single-encoded entities', () => {
    const escaped = bootEscapeHtml(
      '- 得到了一个&quot;重新做人&quot;的机会',
    );
    expect(escaped).toContain('&quot;重新做人&quot;');
    expect(escaped).not.toContain('&amp;quot;');
  });
});
