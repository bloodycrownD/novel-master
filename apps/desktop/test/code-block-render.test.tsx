/**
 * T-CB1~T-CB5、T-CB13：markdown 代码块渲染（块级形态 + 语言标签 + 语法高亮）。
 * 静态渲染（renderToStaticMarkup 不跑 effect）断言 HTML 结构；CSS 用例走源码规则存在性断言
 * （对齐 mermaid-markdown.test.tsx 既有模式）。T-CB13 的统一样例与
 * apps/mobile/__tests__/code-block-render.test.ts 保持同文，钉死双端一致性契约。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { MermaidMarkdown } from "@/components/MermaidMarkdown";
import { normalizeFenceLang } from "@/components/code-block";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shellCssPath = path.join(
  __dirname,
  "..",
  "renderer",
  "styles",
  "shell.css",
);

/** 双端统一验收样例（spec「双端统一验收样例」13 块 + ```shell 补充块）。 */
export const UNIFIED_CODE_BLOCK_SAMPLE = [
  "```ts",
  "const greet = (name: string): string => `hi ${name}`; // comment",
  "```",
  "",
  "```python",
  "def add(a, b):",
  "    return a + b  # comment",
  "```",
  "",
  "```bash",
  'echo "hello" && ls -la',
  "```",
  "",
  "```shell",
  "echo shell-alias",
  "```",
  "",
  "```json",
  '{"name": "novel", "v": 1}',
  "```",
  "",
  "```sql",
  "SELECT id FROM chapters WHERE word_count > 1000;",
  "```",
  "",
  "```yaml",
  "name: build",
  "steps: [checkout, test]",
  "```",
  "",
  "```html",
  '<div class="x">text</div>',
  "```",
  "",
  "```css",
  ".a { color: red; }",
  "```",
  "",
  "```markdown",
  "# heading",
  "**bold**",
  "```",
  "",
  "```",
  "no language fence",
  "```",
  "",
  "```rust",
  'fn main() { println!("cold"); }',
  "```",
  "",
  "```mermaid",
  "flowchart TD",
  "A-->B",
  "```",
  "",
  "```ts",
  `const longLine = "${"x".repeat(130)}"; // long`,
  "```",
].join("\n");

/** T-CB13 契约：统一样例的 data-lang 文案集合（归一化后；shell → bash）。 */
export const UNIFIED_DATA_LANGS = [
  "typescript",
  "python",
  "bash",
  "json",
  "sql",
  "yaml",
  "html",
  "css",
  "markdown",
];

/** T-CB13 契约：统一样例的 .hljs-* token 类名并集（与 mobile 侧一致）。 */
export const UNIFIED_TOKEN_CLASSES = [
  "hljs-attr",
  "hljs-attribute",
  "hljs-built_in",
  "hljs-comment",
  "hljs-function",
  "hljs-keyword",
  "hljs-name",
  "hljs-number",
  "hljs-operator",
  "hljs-params",
  "hljs-punctuation",
  "hljs-section",
  "hljs-selector-class",
  "hljs-string",
  "hljs-strong",
  "hljs-subst",
  "hljs-tag",
  "hljs-title",
];

/** 从渲染 HTML 提取 data-lang 集合。 */
function collectDataLangs(html: string): string[] {
  return [...new Set(
    [...html.matchAll(/data-lang="([^"]*)"/g)].map((m) => m[1]!),
  )].sort();
}

/** 从渲染 HTML 提取 .hljs-* token 类名并集（剥掉空 hljs 壳类）。 */
function collectTokenClasses(html: string): string[] {
  const tokens = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const cls of m[1]!.split(/\s+/)) {
      if (cls.startsWith("hljs-")) {
        tokens.add(cls);
      }
    }
  }
  return [...tokens].sort();
}

test("T-CB1: ```ts 块 → pre[data-lang=typescript] + hljs token；行内 code 不受影响", () => {
  const html = renderToStaticMarkup(
    <MermaidMarkdown content={'正文 `inline` 尾\n\n```ts\nconst a = "x"; // c\n```'} />,
  );
  assert.match(html, /<pre data-lang="typescript">/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /hljs-string/);
  assert.match(html, /hljs-comment/);
  // 行内 code 不套 pre、无 data-lang、无 token 类；无类名形式输出
  assert.match(html, /<code>inline<\/code>/);
  const inlineBlock = html.slice(html.indexOf("<code>inline"), html.indexOf("<code>inline") + 40);
  assert.doesNotMatch(inlineBlock, /hljs/);
});

test("T-CB2: ```mermaid → MermaidBlock，extractChildCode 取纯文本（插件未改写）", () => {
  const html = renderToStaticMarkup(
    <MermaidMarkdown content={"```mermaid\nflowchart TD\nA-->B\n```"} />,
  );
  assert.match(html, /mermaid-block/);
  assert.match(html, /mermaid-block__source/);
  assert.match(html, /flowchart TD/);
  // plainText 命中在加类之前 return：mermaid code 不带 hljs 类、无 token span
  assert.doesNotMatch(html, /hljs/);
});

test("T-CB3: 无语言 fence 与未知语言 → 无 data-lang、无 .hljs 类、无标签残留", () => {
  const html = renderToStaticMarkup(
    <MermaidMarkdown
      content={"```\nno language fence\n```\n\n```rust\nfn main() {}\n```"}
    />,
  );
  // 无 data-lang（无语言与 rust 均不出）
  assert.doesNotMatch(html, /data-lang/);
  // 插件静默跳过后注入的空 hljs 类已被 renderCodeBlock 剥除
  assert.doesNotMatch(html, /hljs/);
  assert.match(html, /no language fence/);
  assert.match(html, /fn main\(\)/);
  // 裸 <pre>（不带属性）
  assert.match(html, /<pre><code>/);
});

test("T-CB4: shell.css 含两套 --hljs-* 变量、.hljs-* 规则与 pre[data-lang]::before", () => {
  const css = readFileSync(shellCssPath, "utf8");
  const rootBlock = css.slice(0, css.indexOf('html[data-theme="dark"] {'));
  const darkBlock = css.slice(css.indexOf('html[data-theme="dark"] {'));
  const tokenVars = [
    "--hljs-keyword",
    "--hljs-string",
    "--hljs-comment",
    "--hljs-number",
    "--hljs-title",
    "--hljs-attr",
    "--hljs-literal",
    "--hljs-built_in",
    "--hljs-meta",
    "--hljs-tag",
    "--hljs-symbol",
  ];
  for (const v of tokenVars) {
    assert.ok(rootBlock.includes(v), `:root 须含 ${v}`);
    assert.ok(darkBlock.includes(v), `html[data-theme="dark"] 须含 ${v}`);
  }
  for (const cls of tokenVars) {
    const dot = `.${cls.slice(2)}`;
    assert.ok(css.includes(dot), `须存在 token 规则 ${dot}`);
  }
  assert.match(css, /pre\[data-lang\]::before/);
  assert.match(css, /content:\s*attr\(data-lang\)/);
});

test("T-CB5: 用户气泡覆盖同步——pre 用 --surface-inset、行内 code 用 --background", () => {
  const css = readFileSync(shellCssPath, "utf8");
  const userPre = css.match(
    /\.chat-message--user \.chat-message__markdown pre \{[^}]*\}/,
  )?.[0];
  const userCode = css.match(
    /\.chat-message--user \.chat-message__markdown code \{[^}]*\}/,
  )?.[0];
  assert.ok(userPre, "用户气泡 pre 覆盖规则须存在");
  assert.ok(userCode, "用户气泡 code 覆盖规则须存在");
  assert.match(userPre, /var\(--surface-inset\)/);
  assert.doesNotMatch(userPre, /var\(--surface\)/);
  assert.match(userCode, /var\(--background\)/);
  assert.match(userCode, /var\(--accent-user-border\)/);
});

test("T-CB13: normalizeFenceLang 归一化表（双端同表契约）", () => {
  assert.equal(normalizeFenceLang("ts"), "typescript");
  assert.equal(normalizeFenceLang("tsx"), "typescript");
  assert.equal(normalizeFenceLang("js"), "javascript");
  assert.equal(normalizeFenceLang("jsx"), "javascript");
  assert.equal(normalizeFenceLang("py"), "python");
  assert.equal(normalizeFenceLang("sh"), "bash");
  assert.equal(normalizeFenceLang("shell"), "bash");
  assert.equal(normalizeFenceLang("zsh"), "bash");
  assert.equal(normalizeFenceLang("yml"), "yaml");
  assert.equal(normalizeFenceLang("html"), "html");
  assert.equal(normalizeFenceLang("TypeScript"), "typescript");
  assert.equal(normalizeFenceLang("rust"), null);
  assert.equal(normalizeFenceLang(""), null);
  assert.equal(normalizeFenceLang(null), null);
});

test("T-CB13: 统一样例 → data-lang 集合与 token 类名并集与 mobile 契约一致", () => {
  const html = renderToStaticMarkup(
    <MermaidMarkdown content={UNIFIED_CODE_BLOCK_SAMPLE} />,
  );
  assert.deepEqual(collectDataLangs(html), [...UNIFIED_DATA_LANGS].sort());
  assert.deepEqual(collectTokenClasses(html), [...UNIFIED_TOKEN_CLASSES].sort());
  // shell 块经 aliases 显式注册高亮为 bash（不缺失）
  assert.match(html, /data-lang="bash"/);
  // mermaid 走图表链路（统一样例内含一个 mermaid 块）
  assert.match(html, /mermaid-block__source/);
});
