import {sanitizeRichHtml} from '../src/components/rich-content/sanitize-rich-html';

/** 可执行形态：未转义的危险开标签（进入 DOM 会执行）。 */
function hasExecutableOpenTag(html: string, tag: string): boolean {
  return new RegExp(`<${tag}\\b`, 'i').test(html);
}

describe('sanitizeRichHtml', () => {
  it('escapes unknown empty pseudo-tags instead of discarding', () => {
    const out = sanitizeRichHtml('<p>表现为 <xxx></xxx> 之间没有文本</p>');
    expect(out).toContain('&lt;xxx&gt;');
    expect(out).toContain('&lt;/xxx&gt;');
    expect(out).toContain('表现为');
    expect(out).toContain('之间没有文本');
    expect(out).not.toMatch(/<xxx\b/i);
  });

  it('escapes unknown tags with content (file)', () => {
    const out = sanitizeRichHtml('<file>notes.md</file>');
    expect(out).toContain('&lt;file&gt;');
    expect(out).toContain('notes.md');
    expect(out).toContain('&lt;/file&gt;');
    expect(out).not.toMatch(/<file\b/i);
  });

  it('neutralizes script without leaving executable open tags', () => {
    const out = sanitizeRichHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).toContain('ok');
    expect(hasExecutableOpenTag(out, 'script')).toBe(false);
    // escape 后允许字面量实体可见
    expect(out).toMatch(/&lt;script&gt;/i);
  });

  it('strips event handler attributes', () => {
    const out = sanitizeRichHtml('<p onclick="alert(1)">x</p>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('x');
  });

  it('neutralizes iframe without executable open tags', () => {
    const out = sanitizeRichHtml(
      '<iframe src="https://evil.test"></iframe><p>a</p>',
    );
    expect(out).toContain('a');
    expect(hasExecutableOpenTag(out, 'iframe')).toBe(false);
  });

  it('neutralizes embed and object', () => {
    const out = sanitizeRichHtml(
      '<embed src="x"><object data="y"></object><p>keep</p>',
    );
    expect(out).toContain('keep');
    expect(hasExecutableOpenTag(out, 'embed')).toBe(false);
    expect(hasExecutableOpenTag(out, 'object')).toBe(false);
  });

  it('neutralizes form controls', () => {
    const out = sanitizeRichHtml(
      '<form><input name="q"><textarea></textarea><button>go</button></form><p>z</p>',
    );
    expect(out).toContain('z');
    expect(hasExecutableOpenTag(out, 'form')).toBe(false);
    expect(hasExecutableOpenTag(out, 'input')).toBe(false);
    expect(hasExecutableOpenTag(out, 'textarea')).toBe(false);
    expect(hasExecutableOpenTag(out, 'button')).toBe(false);
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
