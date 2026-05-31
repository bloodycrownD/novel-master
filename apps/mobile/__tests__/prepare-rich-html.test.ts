import {prepareRichHtml} from '../src/components/rich-content/prepare-rich-html';

describe('prepareRichHtml', () => {
  it('renders markdown headings', () => {
    const {html} = prepareRichHtml('# Title\n\nBody');
    expect(html.toLowerCase()).toMatch(/<h1[^>]*>/);
    expect(html).toContain('Title');
    expect(html).toContain('Body');
  });

  it('preserves sanitized inline style on div', () => {
    const {html} = prepareRichHtml('<div style="color:red">x</div>');
    expect(html).toMatch(/color:\s*red/i);
    expect(html).toContain('x');
  });

  it('strips script in markdown html block', () => {
    const {html} = prepareRichHtml('<script>alert(1)</script><p>safe</p>');
    expect(html).not.toMatch(/script/i);
    expect(html).toContain('safe');
  });

  it('extracts style block into classesStyles', () => {
    const {html, classesStyles} = prepareRichHtml(
      '<style>.note { color: green; }</style>\n\n<p class="note">x</p>',
    );
    expect(html).not.toMatch(/<style/i);
    expect(classesStyles.note).toMatchObject({color: 'green'});
    expect(html).toContain('class="note"');
  });
});
