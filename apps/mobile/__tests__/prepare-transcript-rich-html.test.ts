import {prepareTranscriptRichHtml} from '../src/components/rich-content/prepare-transcript-rich-html';

describe('prepareTranscriptRichHtml', () => {
  it('renders markdown headings', () => {
    const html = prepareTranscriptRichHtml('# Title\n\nBody');
    expect(html.toLowerCase()).toMatch(/<h1[^>]*>/);
    expect(html).toContain('Title');
    expect(html).toContain('Body');
  });

  it('preserves sanitized inline style on div', () => {
    const html = prepareTranscriptRichHtml('<div style="color:red">x</div>');
    expect(html).toContain('color:red');
    expect(html).toContain('x');
  });

  it('strips script in markdown html block', () => {
    const html = prepareTranscriptRichHtml('<script>alert(1)</script><p>safe</p>');
    expect(html).not.toMatch(/script/i);
    expect(html).toContain('safe');
  });

  it('renders bold markdown', () => {
    const html = prepareTranscriptRichHtml('**bold** text');
    expect(html).toContain('<strong>');
    expect(html).toContain('bold');
  });
});
