import sanitizeHtml from 'sanitize-html';

const DISALLOWED_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
] as const;

/**
 * 内联 style 属性白名单：仅放行纯展示类 CSS 属性。
 * position/z-index/top/left/right/bottom/inset/transform 以及 width/height 的
 * 100%/100vw/100vh 组合等一切可布局劫持的属性均不在名单内，整体剥离——
 * 恶意 `position:fixed;inset:0` 全屏覆盖伪造 app 界面的路径由此封死。
 */
const ALLOWED_CSS_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'font-weight',
  'font-style',
  'font-size',
  'text-decoration',
  'text-align',
  'text-indent',
  'line-height',
  'letter-spacing',
]);

/**
 * 按顶层分号切分 style 声明：逐字符扫描并跟踪引号与括号深度，
 * 保证 url("a;b") 这类值内的分号/逗号/引号不会被误当声明分隔符。
 */
function splitStyleDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let depth = 0;
  for (const ch of style) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (ch === ';' && depth === 0) {
      declarations.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') {
    declarations.push(current);
  }
  return declarations;
}

/**
 * 内联 style 白名单过滤：保留名单内且安全的声明，重组为规范化串。
 * 含 CSS 注释（用注释拆分属性名可拼凑出 pos⋯ition 这类写法）或 url()
 * （background:url 可外联加载）的声明整条丢弃；全部被剥时返回 undefined，
 * 调用方删除 style 属性。
 */
export function filterInlineStyle(style: string): string | undefined {
  const kept: string[] = [];
  for (const declaration of splitStyleDeclarations(style)) {
    if (declaration.includes('/*')) {
      continue;
    }
    const colon = declaration.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (value === '' || !ALLOWED_CSS_PROPERTIES.has(property)) {
      continue;
    }
    if (/url\s*\(/i.test(value)) {
      continue;
    }
    kept.push(property + ': ' + value);
  }
  return kept.length > 0 ? kept.join('; ') : undefined;
}

/**
 * 消毒富文本 HTML：未知/禁止标签以 escape 转为实体字面量（不 discard 挖空），
 * 并剥离事件属性与危险 scheme，供 TrustedHtml / RenderHTML 使用。
 * 批注锚：显式放行 `span[data-annotate-id]`（仅靠 class 不够，默认会剥 data-*）。
 *
 * style 标签**不在** allowedTags，escape 模式下整体转实体字面量，CSS 规则不可生效；
 * 内联 style 属性走下方 CSS 属性白名单过滤，拦截 position/inset 等可全屏覆盖
 * 伪造 app 界面的布局属性。
 */
export function sanitizeRichHtml(html: string): string {
  return sanitizeHtml(html, {
    // 伪标签须可见：escape 为 &lt;tag&gt;；危险标签同样不可执行
    disallowedTagsMode: 'escape',
    // PostCSS 依赖 Node；Hermes 无法解析内联 style — 保留 style 属性原样
    parseStyleAttributes: false,
    nonTextTags: ['script', 'textarea', 'option'],
    allowedTags: sanitizeHtml.defaults.allowedTags
      .concat([
        'img',
        'div',
        'span',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ])
      .filter(
        (tag: string) =>
          !DISALLOWED_TAGS.includes(tag as (typeof DISALLOWED_TAGS)[number]),
      ),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['style', 'class', 'id'],
      // 预览锚管道：须保留 data-annotate-id，否则 closest 点击失效
      span: ['style', 'class', 'id', 'data-annotate-id'],
      // 代码块语言标签：pre[data-lang] 由 CSS 伪元素呈现（data-* 非可执行属性）
      pre: ['style', 'class', 'id', 'data-lang'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      td: ['colspan', 'rowspan', 'style', 'class'],
      th: ['colspan', 'rowspan', 'style', 'class'],
    },
    // sanitize-html：剥离不在 allowedAttributes 中的 on* 等不安全属性
    allowedSchemes: ['http', 'https', 'mailto'],
    // 内联 style 白名单过滤须在管道内做（此处拿到的是解码后的原始属性值）；
    // parseStyleAttributes:false 只关掉 sanitize-html 自带的 postcss 解析，
    // 并不会过滤 style，故以 transformTags 的 '*' 通配接管每个标签的 style。
    transformTags: {
      '*': (tagName: string, attribs: Record<string, string>) => {
        if (typeof attribs.style !== 'string') {
          return {tagName, attribs};
        }
        const next = {...attribs};
        const filtered = filterInlineStyle(next.style!);
        if (filtered === undefined) {
          delete next.style;
        } else {
          next.style = filtered;
        }
        return {tagName, attribs: next};
      },
    },
  });
}
