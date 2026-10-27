import {
  buildRichContentCssRules,
  CHAT_TRANSCRIPT_RICH_CSS,
  RICH_DOCUMENT_RICH_CSS,
} from '@/web/shared/rich-content-styles';

/** 抠出选择器**独占整行开头**的规则声明体；命中同名前缀（如 `th, td` 里含 `td`）时跳过。 */
function cssBlock(css: string, selector: string): string {
  const head = `${selector} {`;
  for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + 1)) {
    if (css.slice(css.lastIndexOf('\n', at) + 1, at).trim() !== '') {
      continue;
    }
    const from = at + head.length;
    return css.slice(from, css.indexOf('}', from));
  }
  return '';
}

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
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain(
      ':first-child { margin-top: 0; }',
    );
  });

  it('builds compound selectors for multiple roots', () => {
    const css = buildRichContentCssRules(['.a.rich', '.b.rich']);
    expect(css).toContain('.a.rich p, .b.rich p');
    expect(css).toContain('.a.rich ol, .b.rich ol, .a.rich ul, .b.rich ul');
  });

  it('soft-wraps pre code blocks without nested horizontal scrollport', () => {
    const css = buildRichContentCssRules(['.bubble.rich']);
    const preRule = cssBlock(css, '.bubble.rich pre');
    expect(preRule).toContain('white-space: pre-wrap');
    expect(preRule).toContain('overflow-wrap: anywhere');
    expect(preRule).toContain('overflow-x: visible');
    expect(preRule).not.toContain('overflow-x: auto');
  });

  it('横向滚动落在内层 code 上，pre 只当定位基准（复制按钮不随内容滚走）', () => {
    const css = buildRichContentCssRules(['.bubble.rich']);
    const rule = cssBlock(css, '.bubble.rich pre[data-lang] > code');
    // 带分号：white-space: pre 是 pre-wrap 的前缀，不带分号会假绿
    expect(rule).toContain('white-space: pre;');
    expect(rule).toContain('overflow-x: auto');
    expect(rule).toContain('overflow-y: hidden');
    expect(rule).not.toContain('pre-wrap');
    expect(cssBlock(css, '.bubble.rich pre')).toContain('overflow-x: visible');
  });

  it('表格：外壳 ≤ 气泡宽负责横滚，列宽 = min(单行自然宽, 72vw)', () => {
    const css = buildRichContentCssRules(['.bubble.rich']);
    const wrapRule = cssBlock(css, '.bubble.rich .table-wrap');
    expect(wrapRule).toContain('max-width: 100%');
    expect(wrapRule).toContain('overflow-x: auto');
    // 表自己只管铺开：宽 max-content，不承担滚动（否则盒子与内容同宽、没有可滚的溢出）
    const tableRule = cssBlock(css, '.bubble.rich .table-wrap > table');
    expect(tableRule).toContain('width: max-content');
    expect(tableRule).not.toContain('overflow');
    const cellRule = cssBlock(css, '.bubble.rich th, .bubble.rich td');
    expect(cellRule).toContain('max-width: 72vw');
    expect(cellRule).toContain('white-space: normal');
  });

  it('两份最终 CSS 各自带本端 root 的 data-lang 覆盖与表格规则', () => {
    // 逐 root 挂后缀：chat 的 root 是 .bubble-body.rich，文档是 #doc .doc-body.rich
    expect(CHAT_TRANSCRIPT_RICH_CSS).toContain('.bubble-body.rich pre[data-lang] > code');
    expect(RICH_DOCUMENT_RICH_CSS).toContain('#doc .doc-body.rich pre[data-lang] > code');
    for (const css of [CHAT_TRANSCRIPT_RICH_CSS, RICH_DOCUMENT_RICH_CSS]) {
      expect(css).toContain('max-width: 72vw');
      expect(css).toContain('.table-wrap');
    }
  });

  it('失败态源码回退只走 pre.mermaid-failed，不含不可达的 .mermaid-block 组合', () => {
    for (const css of [CHAT_TRANSCRIPT_RICH_CSS, RICH_DOCUMENT_RICH_CSS]) {
      expect(css).toContain('pre.mermaid-failed');
      // 失败态 pre 不进 .mermaid-block 容器，组合选择器不可达
      expect(css).not.toContain('.mermaid-block.mermaid-failed');
    }
  });
});
