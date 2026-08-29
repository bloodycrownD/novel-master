/**
 * RN 侧代码块语法高亮（markdown 代码块渲染迭代）。
 *
 * - 只引 highlight.js/lib/core + 按需语言子模块，禁全量 import（bundle 体积约束）；
 * - 注册表与 desktop MermaidMarkdown 的 rehype-highlight languages 选项同源
 *   （同一集合 10 语言模块），任一端增删语言须双端同步（T-CB13 一致性契约）；
 * - html 由 xml 模块内置别名承载；shell 不在 bash 模块内置 aliases（仅 sh/zsh），
 *   由 LANG_ALIAS 归一化（shell → bash）覆盖；
 * - 高亮发生在 RN 侧（markdown-it fence 覆盖内直调），产出 span.hljs-* 字符串
 *   随现有 HTML 管道进 WebView，WebView 侧零 JS 注入增量。
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdownLang from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/** fence 别名归一化表（与 desktop code-block.tsx 的 FENCE_LANG_ALIAS 同表）。 */
export const LANG_ALIAS: Record<string, string> = {
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  python: 'python',
  py: 'python',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  sql: 'sql',
  markdown: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  css: 'css',
  json: 'json',
};

let registered = false;

/** core 按需注册 10 语言模块（幂等；html 由 xml 别名承载）。 */
export function registerHighlightLanguages(): void {
  if (registered) {
    return;
  }
  registered = true;
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('markdown', markdownLang);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('css', css);
}

/** fence 原始语言名 → 规范名；不在清单（如 rust/mermaid）或无语言返回 null。 */
export function normalizeFenceLang(
  lang: string | null | undefined,
): string | null {
  if (!lang) {
    return null;
  }
  return LANG_ALIAS[lang.toLowerCase()] ?? null;
}

/**
 * 表外回退：按小写查 hljs 注册表（语言模块内置别名 mjs/cjs/mts/cts/xhtml 等随注册进入）。
 * 与 desktop rehype-highlight 的 AST 层判定同一注册表、同一逻辑（MF-1 双端统一）。
 */
function lookupRegisteredLang(lang: string): string | null {
  const lower = lang.toLowerCase();
  return hljs.getLanguage(lower) ? lower : null;
}

/**
 * 源码 → 高亮 HTML（hljs 自带转义）；不支持的语言返回 ''（调用方走默认 escape）。
 *
 * 高亮语言判定：归一化表命中用规范名；表外回退 hljs 注册表查原始 lang
 * （内置别名命中即高亮，与 desktop rehype-highlight 行为一致）。语言标签
 * （data-lang）由调用方按归一化表单独决定——表外语言高亮但不出标签。
 */
export function resolveHighlight(code: string, lang: string): string {
  registerHighlightLanguages();
  const target = normalizeFenceLang(lang) ?? lookupRegisteredLang(lang);
  if (!target || !hljs.getLanguage(target)) {
    return '';
  }
  try {
    return hljs.highlight(code, {
      language: target,
      ignoreIllegals: true,
    }).value;
  } catch {
    return '';
  }
}
