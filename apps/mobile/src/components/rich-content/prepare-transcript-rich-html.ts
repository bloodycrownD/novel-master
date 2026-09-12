import MarkdownIt from 'markdown-it';
import {
  decodeAfterSanitize,
  decodeForMarkdownInput,
} from './decode-literal-html-entities';
import {normalizeFenceLang, resolveHighlight} from './highlight-code';
import {sanitizeRichHtml} from './sanitize-rich-html';

const markdown = new MarkdownIt({html: true, linkify: true});

// 裸文件名（如 xxx.md）会被 linkify 的无协议裸域推断（match.schema 为空串、
// 自动补 http://）链接化，点击后经聊天链接路由外跳浏览器，与 PRD「裸路径
// 渲染为纯文本」口径相悖（.md 是摩尔多瓦 TLD，其余为同类撞车扩展）。注：
// linkify-it 5 的 tlds() 增删 API 语义破碎（单调用禁不动目标 TLD 反伤 com，
// 批量禁用需手工重植全表），故改在 match 层过滤：仅丢弃「无协议推断 +
// 无路径 + 撞车 TLD」的匹配；显式 http(s) URL 与真裸域名（www/github 等）
// 不受影响。
const FILE_EXTENSION_LOOKALIKE_TLDS = new Set([
  'md',
  'zip',
  'sh',
  'py',
  'rs',
  'pl',
  'pm',
  'ai',
  'app',
  'page',
  'link',
  'file',
  'mov',
  'so',
]);
const originalLinkifyMatch = markdown.linkify.match.bind(markdown.linkify);
markdown.linkify.match = (text: string) =>
  (originalLinkifyMatch(text) ?? []).filter(match => {
    if (match.schema !== '') {
      return true; // 显式带协议的 URL 一律保留
    }
    if (!/^https?:\/\/[^/]+$/.test(match.url)) {
      return true; // 非无路径形态不动
    }
    const host = match.url.replace(/^https?:\/\//, '').toLowerCase();
    return !FILE_EXTENSION_LOOKALIKE_TLDS.has(
      host.slice(host.lastIndexOf('.') + 1),
    );
  });

// 代码块唯一高亮出口：覆盖 renderer.rules.fence（不挂 markdown-it highlight 选项，
// fence 被覆盖后该选项不再被 fence 路径消费，双轨冗余）。
// 清单内语言出 pre[data-lang] + hljs 类；无语言/不支持（含 mermaid）等价默认 fence
// escape（转义同源），不出 data-lang、不出 hljs 类，mermaid-core 扫描 language-mermaid 不回归。
// 普通代码块前插复制按钮：空 span.code-copy，label 走 CSS 伪元素，零 DOM 文本
// （批注文本流零偏移）；点击由 webview runtime 事件委托处理（@web/shared/code-copy）。
// mermaid fence 除外：mermaid 不是普通代码块（走图表链路），不插按钮，
// 与 desktop MermaidBlock 无按钮口径对齐（cr-fix MF-11）。
markdown.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]!;
  const rawLang = token.info.trim().split(/\s+/)[0] || '';
  const normalized = normalizeFenceLang(rawLang);
  // 高亮判定在 resolveHighlight 内统一（归一化表 + hljs 注册表内置别名，与 desktop 同一逻辑）；
  // data-lang 仅归一化表内语言输出——表外内置别名（mjs/cjs 等）高亮但不出语言标签（MF-1 双端一致）。
  const highlighted = resolveHighlight(token.content, rawLang);
  // mermaid 不插复制按钮：与 desktop MermaidBlock（图表渲染、无按钮）口径对齐（MF-11）
  const copyBtn =
    rawLang === 'mermaid' ? '' : '<span class="code-copy"></span>';
  // rawLang 来自 fence info 首词，未经归一化表约束：拼接前必须转义，
  // 避免未来表 key 引入特殊字符时打开属性注入面（MF-2）
  const langClass = markdown.utils.escapeHtml(rawLang);
  if (highlighted) {
    const label = normalized ? ` data-lang="${normalized}"` : '';
    return `<pre${label}>${copyBtn}<code class="language-${langClass} hljs">${highlighted}</code></pre>\n`;
  }
  // 等价 markdown-it 默认 fence 输出（escapeHtml 同源）+ 复制按钮
  const cls = rawLang ? ` class="language-${langClass}"` : '';
  return `<pre>${copyBtn}<code${cls}>${markdown.utils.escapeHtml(
    token.content,
  )}</code></pre>\n`;
};

/**
 * Markdown → 消毒 HTML，供 WebView transcript 气泡（browser innerHTML）。
 * 顺序：入口完整 decode → markdown-it → sanitize(escape) → 出口 decode（保留 &lt;/&gt;）。
 * 安全规则由共享的 sanitizeRichHtml 统一（各富文本管线同源）；不做 RN RenderHTML 的 class 物化。
 */
export function prepareTranscriptRichHtml(content: string): string {
  const normalized = decodeForMarkdownInput(content);
  const sanitized = sanitizeRichHtml(markdown.render(normalized));
  // sanitize-html 可能把 markdown-it 的 &quot; 变成 &amp;quot; — 出口仍解 quot/amp
  return decodeAfterSanitize(sanitized);
}
