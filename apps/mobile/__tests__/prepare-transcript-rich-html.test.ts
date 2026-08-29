import {prepareTranscriptRichHtml} from '../src/components/rich-content/prepare-transcript-rich-html';

/** 可执行形态：未转义的危险开标签。 */
function hasExecutableOpenTag(html: string, tag: string): boolean {
  return new RegExp(`<${tag}\\b`, 'i').test(html);
}

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

  it('T-S1: 空伪标签以实体尖括号保留，不挖空', () => {
    const html = prepareTranscriptRichHtml('表现为 <xxx></xxx> 之间没有文本');
    expect(html).toContain('&lt;xxx&gt;');
    expect(html).toContain('&lt;/xxx&gt;');
    expect(html).toContain('表现为');
    expect(html).toContain('之间没有文本');
    // 不得把伪标签挖空后拼成「表现为 之间」式断层（前后文之间仍有实体标签）
    expect(html).not.toMatch(/表现为\s+之间没有文本/);
  });

  it('T-S2: file 伪标签名与内容均可辨认', () => {
    const html = prepareTranscriptRichHtml('<file>notes.md</file>');
    expect(html).toContain('&lt;file&gt;');
    expect(html).toContain('notes.md');
    expect(html).toContain('&lt;/file&gt;');
  });

  it('T-S3: script 不可执行（允许实体字面量）', () => {
    const html = prepareTranscriptRichHtml(
      '<script>alert(1)</script><p>safe</p>',
    );
    expect(html).toContain('safe');
    expect(hasExecutableOpenTag(html, 'script')).toBe(false);
  });

  it('renders bold markdown', () => {
    const html = prepareTranscriptRichHtml('**bold** text');
    expect(html).toContain('<strong>');
    expect(html).toContain('bold');
  });

  it('MF-2: fence 语言首词含引号/尖括号/与号 → 默认路径无标签注入向量', () => {
    const html = prepareTranscriptRichHtml(
      '```ab"c onmouseover=x\ncode body\n```\n\n```a<b>&d\ncode body\n```',
    );
    expect(html).toContain('code body');
    // < > 经默认 fence renderer 转义反射，不产生新标签
    expect(html).toContain('language-a&lt;b&gt;&d');
    // info 首词之后的内容不进 class 输出：事件属性不可达
    expect(html).not.toMatch(/\son\w+\s*=/i);
    expect(hasExecutableOpenTag(html, 'b')).toBe(false);
  });
});
