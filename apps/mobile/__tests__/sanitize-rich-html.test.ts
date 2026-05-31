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

  it('removes embed and object', () => {
    const out = sanitizeRichHtml(
      '<embed src="x"><object data="y"></object><p>keep</p>',
    );
    expect(out).not.toMatch(/embed|object/i);
    expect(out).toContain('keep');
  });

  it('removes form controls', () => {
    const out = sanitizeRichHtml(
      '<form><input name="q"><textarea></textarea><button>go</button></form><p>z</p>',
    );
    expect(out).not.toMatch(/form|input|textarea|button/i);
    expect(out).toContain('z');
  });

  it('preserves inline style when parseStyleAttributes is off', () => {
    const out = sanitizeRichHtml('<p style="color:red">x</p>');
    expect(out).toMatch(/color:\s*red/i);
  });

  it('strips javascript: href', () => {
    const out = sanitizeRichHtml('<a href="javascript:alert(1)">link</a>');
    expect(out).not.toMatch(/javascript:/i);
  });
});
