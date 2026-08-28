/**
 * T-CB6、T-CB8~T-CB13（mobile 侧）：markdown 代码块渲染。
 * - prepareTranscriptRichHtml 直调断言输出 HTML（sanitize-html mock 为透传，
 *   对齐 sanitize-rich-html.test.ts 的 mock-and-assert-options 模式）；
 * - T-CB13 与 apps/desktop/test/code-block-render.test.tsx 共享统一样例契约
 *   （data-lang 文案集合 + .hljs-* token 类名并集双端一致）；
 * - T-CB12：RN 回退路径维持纯文本现状（无 RenderHTML 树，只渲染 Text）。
 */
jest.mock('sanitize-html', () => {
  const fn = jest.fn((html: string) => html);
  (fn as {defaults?: unknown}).defaults = {
    allowedTags: ['p', 'a', 'span', 'div', 'pre', 'code'],
    allowedAttributes: {
      '*': ['style', 'class', 'id'],
      a: ['href', 'name', 'target', 'rel'],
    },
  };
  return fn;
});

import React from 'react';
import {create, act} from 'react-test-renderer';
import {Text} from 'react-native';
import {prepareTranscriptRichHtml} from '../src/components/rich-content/prepare-transcript-rich-html';
import {RichContentBody} from '../src/components/rich-content/RichContentBody';
import {RICH_CONTENT_MAX_CHARS} from '../src/components/rich-content/rich-content-limits';
import {buildRichContentCssRules} from '../src/web/shared/rich-content-styles';
import {normalizeFenceLang} from '../src/components/rich-content/highlight-code';

/** 双端统一验收样例（与 desktop test/code-block-render.test.tsx 保持同文）。 */
const UNIFIED_SAMPLE = [
  '```ts',
  'const greet = (name: string): string => `hi ${name}`; // comment',
  '```',
  '',
  '```python',
  'def add(a, b):',
  '    return a + b  # comment',
  '```',
  '',
  '```bash',
  'echo "hello" && ls -la',
  '```',
  '',
  '```shell',
  'echo shell-alias',
  '```',
  '',
  '```json',
  '{"name": "novel", "v": 1}',
  '```',
  '',
  '```sql',
  'SELECT id FROM chapters WHERE word_count > 1000;',
  '```',
  '',
  '```yaml',
  'name: build',
  'steps: [checkout, test]',
  '```',
  '',
  '```html',
  '<div class="x">text</div>',
  '```',
  '',
  '```css',
  '.a { color: red; }',
  '```',
  '',
  '```markdown',
  '# heading',
  '**bold**',
  '```',
  '',
  '```mjs',
  'import { readFile } from "node:fs/promises";',
  'export const load = async (p) => readFile(p, "utf8");',
  '```',
  '',
  '```',
  'no language fence',
  '```',
  '',
  '```rust',
  'fn main() { println!("cold"); }',
  '```',
  '',
  '```mermaid',
  'flowchart TD',
  'A-->B',
  '```',
  '',
  '```ts',
  `const longLine = "${'x'.repeat(130)}"; // long`,
  '```',
].join('\n');

/** T-CB13 契约（与 desktop 相同；钉死双端类名体系一致）。 */
const UNIFIED_DATA_LANGS = [
  'bash',
  'css',
  'html',
  'json',
  'markdown',
  'python',
  'sql',
  'typescript',
  'yaml',
];
const UNIFIED_TOKEN_CLASSES = [
  'hljs-attr',
  'hljs-attribute',
  'hljs-built_in',
  'hljs-comment',
  'hljs-function',
  'hljs-keyword',
  'hljs-name',
  'hljs-number',
  'hljs-operator',
  'hljs-params',
  'hljs-punctuation',
  'hljs-section',
  'hljs-selector-class',
  'hljs-string',
  'hljs-strong',
  'hljs-subst',
  'hljs-tag',
  'hljs-title',
];

function collectDataLangs(html: string): string[] {
  return [...new Set(
    [...html.matchAll(/data-lang="([^"]*)"/g)].map((m) => m[1]!),
  )].sort();
}

function collectTokenClasses(html: string): string[] {
  const tokens = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const cls of m[1]!.split(/\s+/)) {
      if (cls.startsWith('hljs-')) {
        tokens.add(cls);
      }
    }
  }
  return [...tokens].sort();
}

describe('code block render (mobile)', () => {
  it('T-CB6: ```ts → pre[data-lang=typescript] + code.language-ts hljs + 高亮 span', () => {
    const html = prepareTranscriptRichHtml(
      '```ts\nconst greet = (name: string): string => `hi ${name}`; // comment\n```',
    );
    expect(html).toContain('<pre data-lang="typescript">');
    expect(html).toContain('class="language-ts hljs"');
    expect(html).toMatch(/<span class="hljs-keyword">/);
    expect(html).toMatch(/<span class="hljs-string">/);
    expect(html).toMatch(/<span class="hljs-comment">/);
  });

  it('T-CB8: ```mermaid → language-mermaid 保留、code 内无 hljs span（扫描链路不回归）', () => {
    const html = prepareTranscriptRichHtml(
      '```mermaid\nflowchart TD\nA-->B\n```',
    );
    expect(html).toContain('language-mermaid');
    expect(html).toContain('flowchart TD');
    expect(html).not.toContain('hljs');
    expect(html).not.toContain('data-lang');
  });

  it('T-CB11: 无语言 / 未知语言 → 默认 escape 纯文本块级（无 data-lang、无 hljs 类）', () => {
    const html = prepareTranscriptRichHtml(
      '```\nno language fence\n```\n\n```rust\nfn main() {}\n```',
    );
    expect(html).not.toContain('data-lang');
    expect(html).not.toContain('hljs');
    expect(html).toContain('no language fence');
    // rust fence 走默认 renderer：language-rust 类原样、无 hljs 附加
    expect(html).toContain('language-rust');
  });

  it('T-CB9: CSS 含 pre 块级 / pre code 重置 / data-lang::before / 两套 .hljs-*', () => {
    const css = buildRichContentCssRules(['.bubble.rich']);
    expect(css).toMatch(/\.bubble\.rich pre \{[^}]*border:/s);
    expect(css).toMatch(/\.bubble\.rich pre \{[^}]*padding:/s);
    expect(css).toMatch(/\.bubble\.rich pre \{[^}]*border-radius:/s);
    expect(css).toMatch(/\.bubble\.rich pre \{[^}]*background:/s);
    // pre code 重置：透明背景、零 padding
    expect(css).toMatch(
      /\.bubble\.rich pre code \{[^}]*background: transparent;[^}]*padding: 0;/s,
    );
    expect(css).toContain('pre[data-lang]::before');
    expect(css).toContain('content: attr(data-lang)');
    // 两套 token：默认亮色 + html[data-nm-mode="dark"] 暗色覆盖
    expect(css).toMatch(/^\s*\.hljs-keyword \{ color: #cf222e; \}/m);
    expect(css).toMatch(
      /^\s*html\[data-nm-mode="dark"\] \.hljs-keyword \{ color: #ff7b72; \}/m,
    );
    expect(css.match(/html\[data-nm-mode="dark"\] \.hljs-/g)?.length).toBe(11);
  });

  it('T-CB10: pre 规则不含 overflow-x: auto（折行约束钉死）', () => {
    // 剥掉注释后断言规则本体（注释含「勿用 overflow-x:auto」提醒，会误伤 not.toContain）
    const css = buildRichContentCssRules(['.bubble.rich']).replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(css).not.toContain('overflow-x: auto');
    expect(css).not.toContain('overflow-x:auto');
    const preRule = css.match(/\.bubble\.rich pre \{[^}]*\}/s)?.[0] ?? '';
    expect(preRule).toContain('white-space: pre-wrap');
    expect(preRule).toContain('overflow-x: visible');
  });

  it('T-CB13: normalizeFenceLang 归一化表（双端同表契约）', () => {
    expect(normalizeFenceLang('ts')).toBe('typescript');
    expect(normalizeFenceLang('tsx')).toBe('typescript');
    expect(normalizeFenceLang('js')).toBe('javascript');
    expect(normalizeFenceLang('jsx')).toBe('javascript');
    expect(normalizeFenceLang('py')).toBe('python');
    expect(normalizeFenceLang('sh')).toBe('bash');
    expect(normalizeFenceLang('shell')).toBe('bash');
    expect(normalizeFenceLang('zsh')).toBe('bash');
    expect(normalizeFenceLang('yml')).toBe('yaml');
    expect(normalizeFenceLang('html')).toBe('html');
    expect(normalizeFenceLang('TypeScript')).toBe('typescript');
    expect(normalizeFenceLang('rust')).toBeNull();
    expect(normalizeFenceLang('')).toBeNull();
    expect(normalizeFenceLang(null)).toBeNull();
  });

  it('T-CB13: 统一样例 → data-lang 集合与 token 类名并集与 desktop 一致', () => {
    const html = prepareTranscriptRichHtml(UNIFIED_SAMPLE);
    expect(collectDataLangs(html)).toEqual(UNIFIED_DATA_LANGS);
    expect(collectTokenClasses(html)).toEqual(UNIFIED_TOKEN_CLASSES);
    // shell 块经 LANG_ALIAS 归一化高亮为 bash
    expect(html).toContain('data-lang="bash"');
    // mermaid 块 class 保留、无高亮污染
    expect(html).toContain('language-mermaid');
  });

  it('T-CB13: 表外内置别名 mjs/cjs → 高亮但无 data-lang（MF-1 双端一致，与 desktop 同一判定）', () => {
    const html = prepareTranscriptRichHtml(
      '```mjs\nimport { readFile } from "node:fs/promises";\n```\n\n```cjs\nconst { readFile } = require("node:fs");\n```',
    );
    // hljs 语言模块内置别名随注册进入注册表：命中即高亮（与 desktop rehype-highlight 同源）
    expect(html).toContain('language-mjs');
    expect(html).toContain('language-cjs');
    expect(html).toMatch(/<span class="hljs-keyword">/);
    expect(html).toMatch(/<span class="hljs-string">/);
    // 表外语言不出语言标签（data-lang 仅归一化表内语言输出）
    expect(html).not.toContain('data-lang');
  });

  it('T-CB12: RN 回退路径维持纯文本——超长/rn 引擎只渲染 Text，无 pre/code/HTML', () => {
    const tokens = {text: '#111', textSecondary: '#666'};
    const long = 'a'.repeat(RICH_CONTENT_MAX_CHARS + 1);
    let renderer: React.ReactTestRenderer;
    act(() => {
      renderer = create(
        <RichContentBody content={long} tokens={tokens as never} />,
      );
    });
    const json = renderer!.toJSON()!;
    const texts: string[] = [];
    const nodeTypes = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === 'object') {
        const n = node as {type?: string; children?: unknown[]};
        if (n.type) {
          nodeTypes.add(n.type);
        }
        if (n.type === 'Text' && Array.isArray(n.children)) {
          texts.push(n.children.join(''));
        }
        walk(n.children);
      }
    };
    walk(json);
    // 只允许 View 容器 + Text 内容：无 pre/code/HTML 渲染载体
    expect([...nodeTypes].sort()).toEqual(['Text', 'View']);
    // 源码原样展示 + 超长提示
    expect(texts[0]).toBe(long);
    expect(texts.some((t) => t.includes('内容过长'))).toBe(true);

    // 普通长度：仅源码 Text，无提示
    let plain: React.ReactTestRenderer;
    act(() => {
      plain = create(
        <RichContentBody content={'```ts\nconst a = 1;\n```'} tokens={tokens as never} />,
      );
    });
    const plainJson = plain!.toJSON()!;
    const plainTexts: string[] = [];
    const walkPlain = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walkPlain);
        return;
      }
      if (node && typeof node === 'object') {
        const n = node as {type?: string; children?: unknown[]};
        if (n.type === 'Text' && Array.isArray(n.children)) {
          plainTexts.push(n.children.join(''));
        }
        walkPlain(n.children);
      }
    };
    walkPlain(plainJson);
    expect(plainTexts).toEqual(['```ts\nconst a = 1;\n```']);
    expect(plainTexts.join('')).not.toContain('内容过长');
  });
});
