/**
 * WebView 富文本 CSS 规则单源（聊天气泡 + 文档预览）。
 * 构建脚本与测试从此模块读取；禁止在 assemble/build 内再嵌第二份规则。
 */

/** 按根选择器生成复合规则（如 `.bubble.rich p, .thinking-body.rich p`）。 */
export function buildRichContentCssRules(selectors: readonly string[]): string {
  const group = selectors.join(', ');
  const child = (tag: string) => selectors.map((s) => `${s} ${tag}`).join(', ');
  const mermaidBlock = selectors.map((s) => `${s} .mermaid-block`).join(', ');
  const mermaidChart = selectors
    .map((s) => `${s} .mermaid-block__chart`)
    .join(', ');
  const mermaidChartSvg = selectors
    .map((s) => `${s} .mermaid-block__chart svg`)
    .join(', ');
  const mermaidSource = selectors
    .map((s) => `${s} .mermaid-block__source`)
    .join(', ');
  // 失败态源码回退：pre 只加 mermaid-failed（不进 .mermaid-block 容器），
  // 成功态源码 pre 才带 mermaid-block__source（display:none）
  const mermaidSourceVisible = selectors
    .map((s) => `${s} pre.mermaid-failed`)
    .join(', ');
  const mermaidPending = selectors
    .map((s) => `${s} pre > code.language-mermaid`)
    .join(', ');
  const mermaidFailedCode = selectors
    .map((s) => `${s} pre.mermaid-failed > code.language-mermaid`)
    .join(', ');
  const mermaidChartActive = selectors
    .map((s) => `${s} .mermaid-block__chart:active`)
    .join(', ');
  const nestedList = selectors
    .map((s) => `${s} ul ul, ${s} ol ol, ${s} ul ol, ${s} ol ul`)
    .join(', ');
  const liAdjacent = selectors.map((s) => `${s} li + li`).join(', ');
  const liParagraph = selectors.map((s) => `${s} li > p`).join(', ');
  // 块级代码：pre 内 code 重置行内形态（透明背景/零 padding/无圆角）
  const preCode = selectors.map((s) => `${s} pre code`).join(', ');
  const preLangLabel = selectors
    .map((s) => `${s} pre[data-lang]::before`)
    .join(', ');
  // 代码块复制按钮：空 span，label 走伪元素（零 DOM 文本，批注零偏移）。
  // 伪元素选择器必须逐个带 ::after 再 join——`${list}::after` 只会给最后一项挂伪元素，
  // 其余项的 content 落在元素本身上不生效（chat 气泡因此只见到空壳小长条）。
  const preCopyBtn = selectors
    .map((s) => `${s} pre > .code-copy`)
    .join(', ');
  const preCopyBtnAfter = selectors
    .map((s) => `${s} pre > .code-copy::after`)
    .join(', ');
  const preCopyBtnCopied = selectors
    .map((s) => `${s} pre > .code-copy.copied`)
    .join(', ');
  const preCopyBtnCopiedAfter = selectors
    .map((s) => `${s} pre > .code-copy.copied::after`)
    .join(', ');
  // 高亮 token 两套配色：默认亮色，html[data-nm-mode="dark"]（bridge applyTheme 推断写入）覆盖暗色
  // 色值与 desktop shell.css 的 --hljs-* 变量一致（双端一致性）
  const hljsTokens: Array<[string, string, string]> = [
    ['hljs-keyword', '#cf222e', '#ff7b72'],
    ['hljs-string', '#0a3069', '#a5d6ff'],
    ['hljs-comment', '#6e7781', '#8b949e'],
    ['hljs-number', '#0550ae', '#79c0ff'],
    ['hljs-title', '#8250df', '#d2a8ff'],
    ['hljs-attr', '#116329', '#7ee787'],
    ['hljs-literal', '#005cc5', '#79c0ff'],
    ['hljs-built_in', '#953800', '#ffa657'],
    ['hljs-meta', '#cf222e', '#ff7b72'],
    ['hljs-tag', '#116329', '#7ee787'],
    ['hljs-symbol', '#0550ae', '#79c0ff'],
  ];
  return `
    ${group} { white-space: normal; overflow-wrap: anywhere; }
    ${child('p')} { margin: 0.35em 0; }
    ${child('p')}:first-child { margin-top: 0; }
    ${child('p')}:last-child { margin-bottom: 0; }
    /* Global reset strips list padding; indent so outside markers stay inside the content area. */
    ${child('ol')}, ${child('ul')} { margin: 0.35em 0; padding-left: 1.5em; list-style-position: outside; }
    ${nestedList} { margin-top: 0.2em; margin-bottom: 0; padding-left: 1.25em; }
    ${child('li')} { margin: 0.15em 0; }
    ${liAdjacent} { margin-top: 0.25em; }
    ${liParagraph} { margin: 0; }
    ${child('strong')}, ${child('b')} { font-weight: 600; }
    ${child('hr')} {
      border: none;
      border-top: 1px solid var(--border, #e5e5ea);
      margin: 0.5em 0;
      opacity: 0.85;
    }
    ${child('blockquote')} {
      margin: 0.35em 0; padding-left: 0.75em;
      border-left: 3px solid var(--border, #e5e5ea);
    }
    ${child('h1')} { font-size: 1.15em; font-weight: 700; margin: 0.4em 0 0.3em; }
    ${child('h2')} { font-size: 1.08em; font-weight: 700; margin: 0.38em 0 0.28em; }
    ${child('h3')} { font-size: 1em; font-weight: 700; margin: 0.35em 0; }
    ${child('code')} { font-family: ui-monospace, monospace; font-size: 0.9em; background: rgba(0,0,0,0.06); padding: 0.1em 0.25em; border-radius: 4px; }
    /* 覆盖 UA white-space:pre；折行后勿用 overflow-x:auto，避免内层滚动抢 transcript 竖滑 */
    /* 块级独立形态：背景叠层 + 边框 + padding，与行内 code（rgba 背景 + 无边框）拉开 */
    ${child('pre')} {
      position: relative;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      overflow-x: visible;
      margin: 0.35em 0;
      padding: 0.55em 0.7em;
      border: 1px solid var(--border, #e5e5ea);
      border-radius: 6px;
      background: rgba(0,0,0,0.045);
    }
    ${preCode} { background: transparent; padding: 0; border-radius: 0; }
    /* 复制按钮：常驻右上角（触屏无 hover，不藏）;文案伪元素呈现，复制成功切「已复制」 */
    ${preCopyBtn} {
      position: absolute;
      top: 4px;
      right: 4px;
      padding: 1px 8px;
      font-size: 11px;
      line-height: 18px;
      color: var(--text, #333);
      opacity: 0.55;
      background: rgba(0, 0, 0, 0.05);
      border-radius: 5px;
    }
    ${preCopyBtnAfter} { content: '复制'; }
    ${preCopyBtnCopied} { opacity: 0.9; color: #1a7f37; }
    ${preCopyBtnCopiedAfter} { content: '已复制'; }
    /* 语言标签：伪元素不进 textContent，批注文本流零偏移（同桌面端 pre[data-lang]::before） */
    ${preLangLabel} {
      content: attr(data-lang);
      display: block;
      margin-bottom: 0.35em;
      font-size: 0.78em;
      opacity: 0.65;
      text-transform: lowercase;
      letter-spacing: 0.04em;
    }
    ${hljsTokens
      .map(([cls, light, dark]) => `.${cls} { color: ${light}; }\n    html[data-nm-mode="dark"] .${cls} { color: ${dark}; }`)
      .join('\n    ')}
    ${child('a')} { color: var(--primary, #007aff); }
    /* Mermaid 图表：成功态源码 display:none 保留（批注文本流不偏移）；SVG 缩放适配宽度 */
    ${mermaidBlock} {
      margin: 0.35em 0;
      padding: 0.4em 0.2em;
      border-radius: 6px;
      background: rgba(0,0,0,0.03);
    }
    ${mermaidChart} { margin: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    ${mermaidChartSvg} { max-width: 100%; height: auto; }
    /* 全屏入口按压暗示：成功图表可点（失败态源码回退不匹配 chart 选择器，不可进） */
    ${mermaidChartActive} { opacity: 0.72; }
    ${mermaidSource} { display: none; margin: 0; padding: 0; }
    /* 失败：源码保留显示 + 失败标识 */
    ${mermaidSourceVisible} { display: block; }
    /* 流式占位：未定稿的 mermaid 源码弱化展示（预渲染，非失败） */
    ${mermaidPending}::before {
      content: "Mermaid 源码";
      display: block;
      font-size: 0.85em;
      opacity: 0.6;
    }
    ${mermaidFailedCode}::before { content: attr(data-mermaid-error, "图表渲染失败，已回退源码"); color: var(--danger, #d92d20); opacity: 0.9; }
  `.trim();
}

/** 聊天 transcript 气泡 + thinking 富文本规则。 */
export const CHAT_TRANSCRIPT_RICH_CSS = buildRichContentCssRules([
  '.bubble.rich',
  '.bubble-body.rich',
  '.thinking-body.rich',
]);

/** 文档预览正文（#doc .doc-body.rich）— 与聊天气泡同排版。 */
export const RICH_DOCUMENT_RICH_CSS = buildRichContentCssRules([
  '#doc .doc-body.rich',
]);
