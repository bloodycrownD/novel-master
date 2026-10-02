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
// 不受影响。清单事实：linkify-it 5 默认 TLD 表 = 16 项通用 + 两字符国别码
// 全表 + xn--，清单只盯可达撞车项（md/sh/py/rs/pl/pm/so 与 tf/cc/ml/in/
// cl/sc/st/as 等国别码）；zip/app/page/link/file/mov 在当前依赖下不可达、
// 属前向防御。
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
  // 两字符国别码撞车扩展（round 3 CR 补，实测可达）
  'tf',
  'cc',
  'ml',
  'in',
  'cl',
  'sc',
  'st',
  'as',
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
// 清单内语言出 pre[data-lang=<规范名>] + hljs 类；其余（无语言、表外语言含 mjs/cjs 等
// 被 hljs 内置别名高亮但归一化为 null 的）统一出 pre[data-lang="plain"]——MF-1 契约已由
// 「表外语言故意无标签」修订为「统一 plain 标」，高亮行为不受影响。
// mermaid 除外：维持裸 pre（无 data-lang、无复制按钮），mermaid-core 扫描 language-mermaid 不回归。
// 普通代码块前插复制按钮：空 span.code-copy，label 走 CSS 伪元素，零 DOM 文本
// （批注文本流零偏移）；点击由 webview runtime 事件委托处理（@web/shared/code-copy）。
// mermaid fence 除外：mermaid 不是普通代码块（走图表链路），不插按钮，
// 与 desktop MermaidBlock 无按钮口径对齐（cr-fix MF-11）。
markdown.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]!;
  const rawLang = token.info.trim().split(/\s+/)[0] || '';
  const normalized = normalizeFenceLang(rawLang);
  // 高亮判定在 resolveHighlight 内统一（归一化表 + hljs 注册表内置别名，与 desktop 同一逻辑）；
  // 语言标分流按 normalizeFenceLang 返回值走，与高亮与否解耦（MF-1 修订）。
  const highlighted = resolveHighlight(token.content, rawLang);
  // mermaid 不插复制按钮：与 desktop MermaidBlock（图表渲染、无按钮）口径对齐（MF-11）
  const isMermaid = rawLang === 'mermaid';
  const copyBtn = isMermaid ? '' : '<span class="code-copy"></span>';
  // rawLang 来自 fence info 首词，未经归一化表约束：拼接前必须转义，
  // 避免未来表 key 引入特殊字符时打开属性注入面（MF-2）
  const langClass = markdown.utils.escapeHtml(rawLang);
  if (highlighted) {
    const label = normalized ? ` data-lang="${normalized}"` : ' data-lang="plain"';
    return `<pre${label}>${copyBtn}<code class="language-${langClass} hljs">${highlighted}</code></pre>\n`;
  }
  // 等价 markdown-it 默认 fence 输出（escapeHtml 同源）+ 复制按钮
  const cls = rawLang ? ` class="language-${langClass}"` : '';
  const escaped = markdown.utils.escapeHtml(token.content);
  // mermaid 走图表链路：裸 pre、无语言标、无复制按钮（desktop 同口径）
  if (isMermaid) {
    return `<pre><code${cls}>${escaped}</code></pre>\n`;
  }
  // 未命中归一化表（无语言 / 表外语言）统一 plain 标
  return `<pre data-lang="plain">${copyBtn}<code${cls}>${escaped}</code></pre>\n`;
};

// 缩进代码块（4 空格 / tab）出口：token 无 info 串，不走 normalizeFenceLang，
// 与「无语言 fence」同归 plain 标；同时补上复制按钮（默认 renderer 只出裸 pre>code，
// 双端缩进块形态由此对齐）。
markdown.renderer.rules.code_block = (tokens, idx) => {
  const token = tokens[idx]!;
  return `<pre data-lang="plain"><span class="code-copy"></span><code>${markdown.utils.escapeHtml(
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
