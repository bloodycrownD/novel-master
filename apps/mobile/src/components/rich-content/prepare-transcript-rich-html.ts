import MarkdownIt from 'markdown-it';
import {
  decodeAfterSanitize,
  decodeForMarkdownInput,
} from './decode-literal-html-entities';
import {normalizeFenceLang, resolveHighlight} from './highlight-code';
import {sanitizeRichHtml} from './sanitize-rich-html';

const markdown = new MarkdownIt({html: true, linkify: true});

// 代码块唯一高亮出口：覆盖 renderer.rules.fence（不挂 markdown-it highlight 选项，
// fence 被覆盖后该选项不再被 fence 路径消费，双轨冗余）。
// 清单内语言出 pre[data-lang] + hljs 类；无语言/不支持（含 mermaid）走默认 fence
// escape，不出 data-lang、不出 hljs 类，mermaid-core 扫描 language-mermaid 不回归。
const defaultFence = markdown.renderer.rules.fence!;
markdown.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const rawLang = token.info.trim().split(/\s+/)[0] || '';
  const normalized = normalizeFenceLang(rawLang);
  // 高亮判定在 resolveHighlight 内统一（归一化表 + hljs 注册表内置别名，与 desktop 同一逻辑）；
  // data-lang 仅归一化表内语言输出——表外内置别名（mjs/cjs 等）高亮但不出语言标签（MF-1 双端一致）。
  const highlighted = resolveHighlight(token.content, rawLang);
  if (highlighted) {
    const label = normalized ? ` data-lang="${normalized}"` : '';
    // rawLang 来自 fence info 首词，未经归一化表约束：拼接前必须转义，
    // 避免未来表 key 引入特殊字符时打开属性注入面（MF-2）
    const langClass = markdown.utils.escapeHtml(rawLang);
    return `<pre${label}><code class="language-${langClass} hljs">${highlighted}</code></pre>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

/**
 * Markdown → 消毒 HTML，供 WebView transcript 气泡（browser innerHTML）。
 * 顺序：入口完整 decode → markdown-it → sanitize(escape) → 出口 decode（保留 &lt;/&gt;）。
 * 安全规则与 prepare-rich-html 对齐；不做 RN RenderHTML 的 class 物化。
 */
export function prepareTranscriptRichHtml(content: string): string {
  const normalized = decodeForMarkdownInput(content);
  const sanitized = sanitizeRichHtml(markdown.render(normalized));
  // sanitize-html 可能把 markdown-it 的 &quot; 变成 &amp;quot; — 出口仍解 quot/amp
  return decodeAfterSanitize(sanitized);
}
