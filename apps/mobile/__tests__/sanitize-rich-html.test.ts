import {sanitizeRichHtml} from '../src/components/rich-content/sanitize-rich-html';

describe('sanitizeRichHtml', () => {
  it('removes script tags', () => {
    const out = sanitizeRichHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).not.toMatch(/script/i);
    expect(out).toContain('ok');
  });

  it('strips event handler attributes', () => {
    const out = sanitizeRichHtml('<p onclick="alert(1)">x</p>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('x');
  });

  it('removes iframe', () => {
    const out = sanitizeRichHtml('<iframe src="https://evil.test"></iframe><p>a</p>');
    expect(out).not.toMatch(/iframe/i);
    expect(out).toContain('a');
  });
});
