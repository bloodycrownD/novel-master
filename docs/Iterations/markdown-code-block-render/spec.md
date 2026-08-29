---
date: 2026-08-25
prd: Iterations/markdown-code-block-render/prd.md
dependency:
  - Iterations/markdown-preview-mermaid/prd.md
  - Iterations/annotate-source-anchor-render/spec.md
---

# markdown 代码块渲染（块级形态 + 语言标签 + 语法高亮）技术规格（SPEC）

## 设计目标

- 围栏代码块在双端四场景（desktop 预览 / desktop 聊天 / mobile `.md` 预览 / mobile 聊天 transcript）具备**独立块级形态**（背景 / 边框 / 内边距 / 圆角），与行内 `code` 视觉明确区分。
- 代码块顶部显示**语言标签**（fence 标注归一化后的语言名，如 `ts → typescript`）；未标注语言时不显示标签、无空残留；不在支持清单的语言降级为纯文本块级形态。
- **语法高亮**覆盖 PRD 语言清单：typescript / javascript / json / python / bash / shell / sql / markdown / yaml / html / css（别名归一化：ts、js、sh、yml、py 等）。高亮配色跟随应用明暗主题。
- **mobile 保留折行设计**：`pre` 维持 `white-space: pre-wrap`，禁止 `overflow-x: auto`（避免内层横向滚动抢 transcript 竖滑手势）。
- **mermaid 不回归**：` ```mermaid ` 继续走图表链路（desktop `MermaidBlock`、mobile WebView `mermaid-core.ts` 扫描 `code.language-mermaid`），不套用普通代码块高亮，全屏查看器行为不变。
- **批注不回归**：批注以渲染后 DOM 文本流为坐标基准（annotate-source-anchor-render R4）。高亮与语言标签不得改变 `textContent` 顺序与内容。
- **RN 回退路径维持纯文本现状**：`RichContentBody.tsx` 是纯文本回退组件（只渲染 `Text`，无 RenderHTML 树），`FileMarkdownPreview` 在 overLimit / 非 webview 引擎时 `html` 为 `undefined` 直走纯文本——本迭代不改动其渲染行为，仅做「行为不变」回归验证（见 C-12 / T-CB12）。
- 流式期间未闭合 fence 维持现状（轻量正则渲染），不做实时高亮；定稿后（`streamCommit` / 桌面全量重渲）自动呈现新形态。

## 总体方案

### 高亮选型（定案）

| 端 | 选型 | 理由 |
|----|------|------|
| desktop | **rehype-highlight**（lowlight 引擎）+ 自写 token CSS | react-markdown（v10）生态原生插件，一行接入现有 `MermaidMarkdown`；`languages` 显式注册清单语言（lowlight 实例仅含清单集合——缺省 common 集含 rust 等 37 语言会被意外高亮，显式注册即整体替换）、`plainText: ['mermaid']` 与 `detect: false` 保证 mermaid code 不被改写（`extractChildCode` 依赖子节点为纯文本）；ESM 与 vite 构建兼容。shiki 因体积（wasm + 双主题内联 style）与「内联 style 而非 class」被否——内联 style 不利于双端类名对齐与主题切换；lowlight 裸用等于重造 rehype-highlight。 |
| mobile | **highlight.js/lib/core 按需注册 + markdown-it fence renderer 覆盖**（RN 侧预处理） | 高亮发生在 RN 侧 `prepare-transcript-rich-html.ts`（markdown-it 已在此运行），产出 `<span class="hljs-*">` 字符串随现有 HTML 管道进 WebView——**WebView 侧零 JS 注入增量**，只新增自写 token CSS（约 1~2KB）；hljs 与 desktop rehype-highlight（同为 highlight.js 语法）输出同类名 token，双端一致性可用同一组样例直接比对；覆盖 `renderer.rules.fence` 即可达成（不挂 markdown-it `highlight` 选项，避免与 fence 覆盖双轨冗余）。markdown-it-highlightjs 被否（引全量 hljs + 维护停滞）；Prism 被否（类名体系不同，双端对齐成本高）。 |

**关键兼容性事实（已核实）**：

1. **sanitize 白名单天然放行高亮输出**：`sanitizeRichHtml`（`apps/mobile/src/components/rich-content/sanitize-rich-html.ts`）的 `allowedTags` 基于 `sanitizeHtml.defaults.allowedTags`（含 `span`/`pre`/`code`），且 `allowedAttributes['*'] = ['style', 'class', 'id']`——hljs 的 `<span class="hljs-keyword">` **无需放松任何安全基线即可通过**。唯一需补的放行：语言标签用 `pre[data-lang]` 属性承载（见下），需在 `allowedAttributes.pre` 显式加 `data-lang`。
2. **批注文本流兼容**：高亮只把 code 内单个文本节点拆为多个 `span` 子文本节点，按序拼接后 `textContent` 不变，Recogito 量测（基于 textContent / Range）坐标不变——沿用 mermaid 迭代「保留源码 display:none 节点」的不破坏文本流先例。**语言标签用 `pre` 的 `data-lang` 属性 + CSS `::before content: attr(data-lang)` 呈现**：伪元素不进 `textContent`，批注零偏移（WebView 侧已有 `pre > code.language-mermaid::before` 的同类先例）。
3. **desktop 语言标签同理**：`components.pre` 非 mermaid 分支渲染 `<pre data-lang={...}>`，CSS `pre[data-lang]::before` 显示；不引入含真实文本的 header 元素。
4. **主题跟随**：
   - desktop：`shell.css` 新增一组 `--hljs-*` 专用变量，`:root`（亮）与 `html[data-theme="dark"]` 各配一份，主题切换零 JS。
   - mobile WebView：现有主题变量仅 7 个（`--bg/--text/--text-secondary/--primary/--danger/--surface/--border`，由 RN `themeFromTokens` → `init`/`themeUpdate` 桥消息 → WebView `applyTheme` 写入 `documentElement.style`），不足以承载 10+ 种语法色。定案：`applyTheme` 时按 `background` 亮度推断 `dark|light`（复用 `mermaid-core.ts` 的 `inferMermaidThemeFromBg` 亮度算法思路，抽 shared 工具），写入 `documentElement.dataset.nmMode`；token CSS 写两套静态规则（`html[data-nm-mode="dark"]` 前缀覆盖亮色默认），不扩展 HostTheme payload。
5. **WebView 注入体积**：`build-webview.mjs` 将 `CHAT_TRANSCRIPT_RICH_CSS` / `RICH_DOCUMENT_RICH_CSS`（字符串单源 `rich-content-styles.ts`）注入 `transcript.css` / `document.css` 的 `/* __RICH_CSS__ */` 占位。本迭代只增 CSS 规则（块级形态 + token 配色两套 ≈ 1.5~2KB），无 JS 增量；hljs 库进 RN bundle（core + 10 个语言模块注册，min 后约 100KB 级、gzip 后约 30KB 级），以构建产物实测记录为准。
6. **mermaid 分流保护（三层）**：rehype-highlight@7 的真实行为是——`subset` 仅在 `detect: true` 的自动检测路径生效，显式 `language-*` 的 code 直接查注册表；插件对任何带 `language-*` 类的 code 会**先注入 `hljs` 类再查语言**，查不到只是静默跳过（`hljs` 空类已留在 code 上）；`ignoreMissing` 并非 v7 选项。因此 mermaid 保护不能依赖 subset/ignoreMissing，定案为三层：① `languages` 显式注册仅清单语言（注册表不含 mermaid，查不到不高亮）；② `plainText: ['mermaid']` 命中在加类之前 return，mermaid code 连 `hljs` 空类也不带；③ `components.pre` 特判放宽为 `className?.includes('language-mermaid')`（现实现的严格相等 `=== 'language-mermaid'` 在 className 含多个类时必失配，此为双保险兜底）。三层叠加后 `extractChildCode` 取源码不受影响；mobile RN 侧 fence renderer 对非清单语言直接走默认 escape，`code.language-mermaid` 无 span 子节点，`mermaid-core.ts` 的 `querySelectorAll('code.language-mermaid')` 与源码 `textContent` 提取不回归。
7. **清单外语言的空 `hljs` 类剥离**：desktop 侧对带 `language-*` 但不在注册表的 code（如 `rust`），插件静默跳过后仍留有 `hljs` 空类——`renderCodeBlock` 重建 `pre/code` 时对归一化表外语言剥掉该类，保证降级路径无 `.hljs` 残留。T-CB3 维持「无 `.hljs` 类」原断言（选剥类方案而非放宽断言，理由：空 `hljs` 类会让 `.hljs` 类选择器误命中降级块，样式隔离不干净）。mobile 侧 fence renderer 输出完全自控，清单外语言本就不出 `hljs` 类。

### 语言清单与归一化（双端同表）

支持清单（PRD）：`typescript / javascript / json / python / bash / shell / sql / markdown / yaml / html / css`。

别名归一化映射（双端各持一份同表，以统一验收样例钉死一致）：`ts → typescript`、`tsx → typescript`（降级为 ts 高亮）、`js / jsx → javascript`、`py → python`、`sh / shell / zsh → bash`、`yml → yaml`。语言标签显示归一化后的规范名（PRD 验收：` ```ts ` 显示 `typescript`）。不在清单且无别名的语言（如 `rust`）：不出 `data-lang`、不高亮、纯文本块级。

**Deviation（CR-R1 MF-1，方案 b）**：上述「清单外不高亮」对 hljs 语言模块**内置别名**有一条例外——javascript 模块 aliases 含 `mjs`/`cjs`，typescript 含 `mts`/`cts`，xml 含 `xhtml`/`rss`/`atom`/`xsd`/`xsl` 等，这批别名不在双端归一化表内，但随语言模块注册进入 hljs 注册表。双端统一口径（T-CB13 钉死）：**清单外但 hljs 注册表命中的语言：双端均高亮但不出 `data-lang`（无语言标签）；注册表未命中（如 `rust`）：双端均纯文本不高亮**。desktop 侧 rehype-highlight 在 AST 层按注册表命中内置别名（`renderCodeBlock` 归一化失败后剥 `hljs` 壳类、不出 `data-lang`）；mobile 侧 `resolveHighlight` 门控为「归一化表优先、表外回退 hljs 注册表」同一判定逻辑，`data-lang` 仍仅按归一化表输出——两端别名判定同源于 hljs 注册表，行为一致。

**双端语言注册表同源**：desktop `rehypeHighlight({ languages, aliases })` 与 mobile `highlight-code.ts` 的 core 注册为**同一集合**——`typescript / javascript / json / python / bash / sql / markdown / yaml / xml / css` 共 10 个语言模块。别名注意：`html` 由 `xml` 内置别名承载（成立），但 `shell` **不在** bash 模块的内置 aliases（highlight.js@11 的 bash aliases 只有 `sh`/`zsh`）——desktop 侧 rehype-highlight 在 AST 层按 fence 原始 lang 查表（早于 renderCodeBlock 归一化），必须显式配 `aliases: { bash: ['shell'] }`（v7 选项，内部调 `lowlight.registerAlias`）；mobile 侧 fence renderer 先过 `LANG_ALIAS` 归一化（`shell → bash`）再调 `resolveHighlight`，天然覆盖。desktop `languages` 显式注册同时起到替换 lowlight 缺省 common 集（37 语言，含 rust）的作用。任一端增删语言须双端同步，否则 T-CB13 一致性断言失败。

**双端注册机制差异说明**：desktop 的别名高亮随 `languages` 显式注册一并进入 lowlight 注册表（含上文内置别名，AST 层命中）；mobile 为 core 按需注册 + `resolveHighlight` 内「归一化表优先、表外回退 hljs 注册表」的门控——两端高亮判定最终都落在同一 hljs 注册表上，差异仅在桌面端多一层 AST 插件介入。

### 双端统一验收样例（一致性基准）

````markdown
```ts
const greet = (name: string): string => `hi ${name}`; // comment
```

```python
def add(a, b):
    return a + b  # comment
```

```bash
echo "hello" && ls -la
```

```json
{"name": "novel", "v": 1}
```

```sql
SELECT id FROM chapters WHERE word_count > 1000;
```

```yaml
name: build
steps: [checkout, test]
```

```html
<div class="x">text</div>
```

```css
.a { color: red; }
```

```markdown
# heading
**bold**
```

```mjs
import { readFile } from "node:fs/promises";
export const load = async (p) => readFile(p, "utf8");
```

```
no language fence
```

```rust
fn main() { println!("cold"); }
```

```mermaid
flowchart TD
A-->B
```

（另含一条 >120 字符长行的 ts 代码块，验证 mobile 折行）
````

验收时双端分别渲染同一样例：块级形态一致（平台微调允许）、语言标签文案一致（归一化后）、mermaid 均走图表、`rust` 与无语言块均为纯文本块级且无标签残留；`mjs` 块（内置别名代表）双端均高亮但无语言标签（MF-1 deviation 行为钉死）。

## 最终项目结构

```
apps/desktop/
  renderer/components/MermaidMarkdown.tsx        # 改：挂 rehype-highlight；components.pre 非 mermaid 分支渲染 CodeBlock（data-lang）
  renderer/components/code-block.tsx（新增或并入 MermaidMarkdown.tsx）# 语言归一化 + pre[data-lang] 渲染
  renderer/styles/shell.css                      # 改：块级形态强化 + --hljs-* 双主题 + pre[data-lang]::before
  test/mermaid-markdown.test.tsx                 # 改：既有 mermaid 用例回归
  test/code-block-render.test.tsx（新增）        # T-CB1~T-CB5、T-CB13
apps/mobile/
  src/components/rich-content/
    highlight-code.ts（新增）                    # hljs core 注册 + resolveHighlight + LANG_ALIAS 表（注册表与 desktop languages 同源）
    prepare-transcript-rich-html.ts              # 改：覆盖 renderer.rules.fence（内部直调 resolveHighlight，出 pre[data-lang]）
    sanitize-rich-html.ts                        # 改：allowedAttributes.pre 放行 data-lang
  src/web/shared/
    rich-content-styles.ts                       # 改：pre 块级形态 + pre code 重置 + data-lang::before + hljs token 两套配色
    theme-mode.ts（新增）                        # inferThemeModeFromBg（自 mermaid-core 亮度算法抽出复用）
    mermaid-core.ts                              # 改：亮度推断改引 theme-mode.ts（行为不变）
  src/web/chat-transcript/webview/runtime/bridge/bridge.ts   # 改：applyTheme 写 documentElement.dataset.nmMode
  src/web/rich-document/webview/（同构 applyTheme 挂点）      # 改：同样写 nmMode（实现时以 bridge 目录实际文件为准）
  __tests__/code-block-render.test.ts（新增）    # T-CB6~T-CB12、T-CB13
  __tests__/sanitize-rich-html.test.ts           # 改：补 data-lang / hljs span 用例
docs/Iterations/markdown-code-block-render/spec.md
```

## 变更点清单

| # | 文件 / 符号 | 变更 |
|---|-------------|------|
| C-1 | `apps/desktop/package.json` dependencies | 新增 `rehype-highlight`（^7）；并新增 `highlight.js`（^11.12.0）直接依赖——`languages` 选项需直接 import `highlight.js/lib/languages/*` 语言子模块传入，插件侧不 re-export（CR 第一轮后补记，与实际依赖对齐） |
| C-2 | `apps/mobile/package.json` dependencies | 新增 `highlight.js`（^11，仅用 `highlight.js/lib/core` + 按需语言子模块） |
| C-3 | `apps/desktop/renderer/components/MermaidMarkdown.tsx` `MermaidMarkdown` | `Markdown` 挂 `rehypePlugins: [rehypeHighlight({ languages: { 10 语言模块显式注册 }, aliases: { bash: ['shell'] }, plainText: ['mermaid'], detect: false })]`（v7 无 `ignoreMissing` 选项、`subset` 对显式 `language-*` 无效，见兼容性事实 6/7；`shell` 非 bash 内置别名，须显式注册，见语言清单节）；`components.pre` mermaid 特判放宽为 `className?.includes("language-mermaid")`（原严格相等 `===` 在多类名时失配），非 mermaid 分支改为 `renderCodeBlock`（解析子 code 的 `language-*`，归一化后输出 `<pre data-lang={norm}>`；未知/无语言输出裸 `<pre>`，且剥掉插件注入的空 `hljs` 类） |
| C-4 | `apps/desktop/renderer/styles/shell.css` `.preview-markdown pre` / `.chat-message__markdown pre`（L4778-4791、L5863-5878） | 背景改独立观感（`var(--surface-inset)`），与行内 code（`--background` + `--border-light`）拉开；`pre[data-lang]::before` 语言标签样式；`.chat-message--user .chat-message__markdown code/pre` 用户气泡覆盖规则同步（现 L5914-5922）：`pre` 覆盖改 `var(--surface-inset)`、行内 `code` 覆盖改 `var(--background)`（边框仍 `--accent-user-border`），与新块级形态的变量分工一致（块级 `--surface-inset` / 行内 `--background`）——现状两者同为 `--surface`，新形态下若不改会趋同不可区分 |
| C-5 | `apps/desktop/renderer/styles/shell.css` `:root` / `html[data-theme="dark"]` | 新增 `--hljs-keyword/-string/-comment/-number/-title/-attr/-literal/-built_in/-meta/-tag/-symbol` 双主题变量 + `.hljs-*` 类规则 |
| C-6 | `apps/mobile/src/components/rich-content/highlight-code.ts`（新增） | `registerHighlightLanguages()`（core 注册 10 语言模块，`html` 由 `xml` 别名、`shell` 由 `bash` 别名承载，与 desktop `languages` 注册表同源）、`LANG_ALIAS` 表、`normalizeFenceLang(lang)`、`resolveHighlight(code, lang): string`（不支持返回 `''`） |
| C-7 | `apps/mobile/src/components/rich-content/prepare-transcript-rich-html.ts` | 覆盖 `renderer.rules.fence` 作为单一高亮出口（内部直调 `resolveHighlight`；**不挂** markdown-it `highlight` 选项——fence 被覆盖后该选项不再被 fence 路径消费，双轨冗余）：清单内语言输出 `<pre data-lang="{norm}"><code class="language-{raw} hljs">{highlighted}</code></pre>`；无语言 / 不支持时走默认 escape，不出 `data-lang`、不出 `hljs` 类 |
| C-8 | `apps/mobile/src/components/rich-content/sanitize-rich-html.ts` `allowedAttributes` | `pre: ['style', 'class', 'id', 'data-lang']`（其余基线不动） |
| C-9 | `apps/mobile/src/web/shared/rich-content-styles.ts` `buildRichContentCssRules` | `pre` 增背景（`var(--bg, #fff)` 弱对比或 `rgba` 叠层）/ 边框 / padding / 圆角，保留 `white-space: pre-wrap; overflow-wrap: anywhere; overflow-x: visible`；新增 `${child('pre')} ${child('code')}` 重置（透明背景、零 padding、无圆角）；`pre[data-lang]::before { content: attr(data-lang) }` 标签样式（居弱化小字号）；`.hljs-*` token 规则两套（默认亮色 + `html[data-nm-mode="dark"]` 暗色覆盖） |
| C-10 | `apps/mobile/src/web/shared/theme-mode.ts`（新增） | `inferThemeModeFromBg(bg): 'dark' | 'light'`（亮度阈值 0.5，算法与 `mermaid-core.ts` `inferMermaidThemeFromBg` 一致）；`mermaid-core.ts` 改为复用 |
| C-11 | `apps/mobile/src/web/chat-transcript/webview/runtime/bridge/bridge.ts` `applyTheme` 及 rich-document 同构挂点 | `applyTheme` 末尾按 `theme.background` 推断并写 `documentElement.dataset.nmMode` |
| C-12 | RN 回退路径（**无代码改动**） | `RichContentBody.tsx` 已是纯文本回退组件（只渲染 `Text`，无 RenderHTML 树），`FileMarkdownPreview` overLimit / 非 webview 引擎时 `html` 为 `undefined` 直走纯文本——原 classesStyles 方案无实现载体，撤销。RN 回退维持纯文本现状，仅以 T-CB12 钉死「回退行为不变」回归断言 |
| C-13 | `apps/desktop/test/code-block-render.test.tsx`（新增）、`apps/mobile/__tests__/code-block-render.test.ts`（新增）、`apps/mobile/__tests__/sanitize-rich-html.test.ts`、`apps/desktop/test/mermaid-markdown.test.tsx` | 见测试策略 |
| C-14 | `apps/desktop/renderer/components/code-block.tsx`、`apps/desktop/renderer/styles/shell.css` | （追认，cr-fix MF-2）复制按钮（desktop）：`renderCodeBlock` 在 pre 首位注入 `CodeCopyButton`（SVG 图标零文本节点、`aria-label="复制代码"`、copied 对勾反馈；clipboard promise `.catch` 与卸载定时器清理见 cr-fix MF-10）；`shell.css` 新增 `.code-copy-btn` 系列规则（常驻显示、`pre:hover` 提亮、`--copied` 态、用户气泡 `pre[data-lang]` 定位微调） |
| C-15 | `apps/mobile/src/web/shared/code-copy.ts`（新增）、`bind-shell-events.ts`、`rich-document/webview/main.ts`、`ChatTranscriptBridge.ts` / `RichDocumentBridge.ts`、`ChatTranscriptWebView.tsx` / `RichDocumentWebView.tsx` | （追认，cr-fix MF-2）复制点击链路（mobile）：`attachCodeCopyDelegation` document 捕获阶段委托 + `stopPropagation`（防嵌套 `[data-action]` 双触发）+ `textContent` 收集 + `copied` 态超时，chat-transcript / rich-document 两宿主挂接；`copyCode` 桥消息（`BridgeEnvelope<'copyCode', {code}>`）由 RN 宿主 `handleMessage` 落 `Clipboard.setString`（WebView 不碰 clipboard API，iOS WKWebView 不可用） |
| C-16 | `apps/mobile/src/components/rich-content/prepare-transcript-rich-html.ts` | （追认，cr-fix MF-2）fence renderer 在 pre 首位注入空 `span.code-copy`（label 走 CSS 伪元素、零 DOM 文本，批注文本流零偏移）——**mermaid fence 除外**（mermaid 不是普通代码块，不插按钮，与 desktop MermaidBlock 无按钮口径对齐，cr-fix MF-11）；sanitize 白名单本就放行 span+class，无新增放行项 |
| C-17 | `apps/mobile/src/web/shared/rich-content-styles.ts` | （追认，cr-fix MF-2）复制按钮 CSS（mobile）：pre 定位容器（`position: relative`）、`.code-copy` 绝对定位、`::after` 伪元素 label（「复制」/「已复制」）、`.copied` 态；对应用例见测试表 T-CB16/T-CB17 |

## 详细实现步骤

- Step 1 — phase-deps — blocking: yes — qa: auto：C-1 / C-2 依赖安装；`npm ls rehype-highlight highlight.js` 验证版本；desktop `npm run typecheck`、mobile `npm run typecheck` 通过（此时未使用新 API，仅确认依赖可解析）。
- Step 2 — phase-desktop-render — blocking: yes — qa: auto：C-3。`MermaidMarkdown.tsx` 挂 `rehype-highlight`（`languages` 显式注册清单 10 语言模块、`plainText: ['mermaid']`、`detect: false`——v7 中 `subset` 仅作用于 detect 路径，显式 `language-*` 直接查注册表，故以 `languages` + `plainText` 达成限定）；`components.pre` mermaid 特判保持首位并放宽为 `className?.includes("language-mermaid")`，非 mermaid 分支走 `renderCodeBlock`（归一化 → `<pre data-lang>`；归一化表外语言剥掉插件注入的空 `hljs` 类）。确认 `extractChildCode` 对 mermaid 仍取到纯文本字符串（前提：`plainText` 命中在加类之前 return 且注册表不含 mermaid，Step 4 测试钉死）。
- Step 3 — phase-desktop-css — blocking: yes — qa: auto：C-4 / C-5。`shell.css` 两处 `pre` 块级形态强化、`pre[data-lang]::before` 标签、`--hljs-*` 双主题变量与 `.hljs-*` 规则、`.chat-message--user` 覆盖同步。明暗两主题各截图一轮（人工过目，blocking 判定以 CSS 规则存在性测试为准）。
- Step 4 — phase-desktop-tests — blocking: yes — qa: auto：C-13 桌面部分。新增 `test/code-block-render.test.tsx`（node:test + `renderToStaticMarkup`，对齐既有 `mermaid-markdown.test.tsx` 风格）：T-CB1、T-CB2、T-CB3、T-CB4、T-CB5、T-CB13（桌面侧）；`test/mermaid-markdown.test.tsx` 既有用例零改动跑通（mermaid 回归）。
- Step 5 — phase-mobile-render — blocking: yes — qa: auto：C-6 / C-7。新增 `highlight-code.ts`（core 按需注册 + 归一化 + `resolveHighlight`）；`prepare-transcript-rich-html.ts` 覆盖 `renderer.rules.fence` 作为单一高亮出口（内部直调 `resolveHighlight`，不挂 markdown-it `highlight` 选项——fence 被覆盖后该选项不被消费）；清单内语言输出 `data-lang` + `hljs` 类 + 高亮 HTML，不支持语言与无语言走默认 escape（仅缺 `data-lang`，无 `hljs` 类）。
- Step 6 — phase-mobile-sanitize — blocking: yes — qa: auto：C-8。`allowedAttributes.pre` 加 `data-lang`；`sanitize-rich-html.test.ts` 补用例：`<span class="hljs-keyword">` 与 `pre data-lang` 消毒后保留、`onclick` 仍剥离（基线不放松）。
- Step 7 — phase-mobile-css — blocking: yes — qa: auto：C-9 / C-10 / C-11。`rich-content-styles.ts` 块级形态 + `pre code` 重置 + `data-lang::before` + `.hljs-*` 两套；新增 `shared/theme-mode.ts`，两个 WebView 的 `applyTheme` 写 `dataset.nmMode`；`mermaid-core.ts` 改引共享推断（行为不变，其既有测试通过）。
- Step 8 — phase-mobile-tests — blocking: yes — qa: auto：C-13 mobile 部分。新增 `__tests__/code-block-render.test.ts`（jest）：T-CB6、T-CB7、T-CB8、T-CB9、T-CB10、T-CB11、T-CB13（mobile 侧）；既有 `mermaid-webview.test.ts`、`chat-transcript-webview.test.tsx` 相关用例零改动跑通。跑 `npm run build:webview` 门禁（占位符注入成功），记录 `webview-dist/*/app.css` 体积增量（预期 < 3KB/包；超预算回风险项处理）。
- Step 9 — phase-rn-fallback — blocking: no — qa: auto：C-12（无代码改动）。RN 回退维持纯文本现状：`RichContentBody` 只渲染 `Text`（无 RenderHTML 树），不做形态/高亮改动；新增 T-CB12 回归断言「超长 / `rn` 引擎路径纯文本行为不变」。
- Step 10 — phase-manual-acceptance — blocking: yes — qa: manual_user：双端真机/桌面人工验收：统一样例（上文）在 desktop 预览+聊天、mobile 预览+聊天四场景；明暗主题各一轮；含代码块 `.md` 划词批注→保存→重开回显（T-CB14）；流式输出中已闭合代码块定稿后新形态、未闭合块维持现状不崩溃（T-CB15）；mermaid 图表 + 全屏入口；mobile 长行折行、聊天竖滑不受影响。
- Step 11 — phase-changelog — blocking: no — qa: auto：`CHANGELOG.md` Unreleased 记录本迭代（含 WebView CSS 与 RN bundle 体积影响说明，对齐 novel-master-changelog skill 约定）。

## 测试策略

- 桌面：node:test（`npm test`，`scripts/run-tests.mjs`），`renderToStaticMarkup` 静态渲染断言 HTML 结构（对齐 `mermaid-markdown.test.tsx` 既有模式，静态渲染不跑 effect）。
- mobile：jest（`npm test`），`sanitizeRichHtml` 相关用例沿用既有 mock 配置（`sanitize-rich-html.test.ts` 的 mock-and-assert-options 模式）；`prepareTranscriptRichHtml` 直调断言输出 HTML。
- 一致性：T-CB13 双端各自断言同一组样例产出相同的 token 类名集合（`hljs-keyword` 等）与相同 `data-lang` 文案，钉死双端类名体系一致。
- 人工验收：Step 10（manual_user）。

### 测试用例

| id | 用例 | 映射 Step | blocking |
|----|------|-----------|----------|
| T-CB1 | desktop：` ```ts ` 块 → `pre[data-lang="typescript"]` + 内含 `span.hljs-*`；行内 `` `code` `` 不受影响 | Step 4 | yes |
| T-CB2 | desktop：` ```mermaid ` 块 → 仍渲染 `MermaidBlock`，`extractChildCode` 取到纯文本源码（rehype-highlight 未改写 mermaid code），既有 mermaid 测试零改动通过 | Step 4 | yes |
| T-CB3 | desktop：无语言 fence 与未知语言（rust）→ 无 `data-lang`、无 `.hljs` 类（插件静默跳过后注入的空 `hljs` 类由 `renderCodeBlock` 剥除）、无标签残留、不报错 | Step 4 | yes |
| T-CB4 | desktop：`shell.css` 含 `:root` 与 `html[data-theme="dark"]` 两套 `--hljs-*` 变量及 `.hljs-*` 规则；`pre[data-lang]::before` 规则存在 | Step 4 | yes |
| T-CB5 | desktop：`.chat-message--user .chat-message__markdown pre/code` 覆盖规则已同步新形态，且 `pre` 用 `var(--surface-inset)`、行内 `code` 用 `var(--background)`（用户气泡内块级与行内仍可区分） | Step 4 | yes |
| T-CB6 | mobile：`prepareTranscriptRichHtml('```ts …')` → 输出含 `pre data-lang="typescript"`、`code.language-ts hljs`、`span.hljs-keyword` 等高亮 span | Step 8 | yes |
| T-CB7 | mobile sanitize：`<span class="hljs-keyword">x</span>` 消毒后保留 span 与 class；`<pre data-lang="ts">` 保留；`onclick` / `script` 仍剥离（安全基线不放松） | Step 8 | yes |
| T-CB8 | mobile：` ```mermaid ` → `language-mermaid` class 保留、code 内无 hljs span（mermaid 扫描与源码提取不回归） | Step 8 | yes |
| T-CB9 | mobile CSS：`buildRichContentCssRules` 输出含 pre 块级规则（背景/边框/padding/圆角）、`pre code` 重置（透明背景零 padding）、`pre[data-lang]::before`、两套 `.hljs-*`（`html[data-nm-mode="dark"]` 覆盖存在） | Step 8 | yes |
| T-CB10 | mobile CSS：`pre` 规则不含 `overflow-x: auto`（折行约束钉死，防回归） | Step 8 | yes |
| T-CB11 | mobile：无语言 / 未知语言 → 纯文本块级（无 `data-lang`、无 `hljs` 类），fence renderer 内 `resolveHighlight` 对不支持语言走默认 escape（不挂 `highlight` 选项） | Step 8 | yes |
| T-CB12 | RN 回退：`RichContentBody` 对超长内容 / `rn` 引擎路径仍渲染纯文本 `Text`（源码原样展示、含「内容过长」提示），不引入 pre/code/HTML 渲染——纯文本回退行为不变 | Step 9 | no |
| T-CB13 | 双端一致性：统一样例（上文 13 块，另补 ` ```shell ` 块）在双端产出相同 `data-lang` 文案集合（含 `shell → bash` 归一化）与 `.hljs-*` token 类名并集——` ```shell ` 双端均高亮为 bash，钉死别名显式注册不缺失 | Step 4 / Step 8 | yes |
| T-CB14 | 真机批注回归：含代码块 `.md` 预览划词批注 → 保存 → 重开，定位与回显正确；含高亮 span 的代码内划词同样正确 | Step 10 | yes |
| T-CB15 | 流式：定稿后已闭合代码块按新形态渲染、无闪烁；未闭合 fence 期间维持现状不崩溃 | Step 10 | yes |
| T-CB16 | 复制按钮渲染（追认，cr-fix MF-2）：desktop `renderCodeBlock` 注入 `CodeCopyButton`（`code-copy-btn`，SVG 零文本节点，批注偏移零污染）；mobile fence 注入空 `span.code-copy`（零 DOM 文本，label 走 CSS 伪元素）——**mermaid fence 除外**（mermaid 不是普通代码块，与 desktop MermaidBlock 无按钮口径对齐，cr-fix MF-11） | 追认（cr-fix MF-2/MF-11） | yes |
| T-CB17 | 复制按钮 CSS（追认，cr-fix MF-2）：desktop `shell.css` `.code-copy-btn` 规则（`pre:hover > .code-copy-btn` 显示、copied 态）；mobile `rich-content-styles.ts` `.code-copy` 定位（pre 相对定位容器 + 按钮绝对定位）、`::after` 伪元素 label 与 `.copied::after` 已复制态 | 追认（cr-fix MF-2） | yes |
| T-CB18 | desktop：复制按钮 promise/定时器源码级断言（cr-fix MF-10——静态渲染跑不了 effect，验收降级为源码级：`writeText` 链含 `.catch`、卸载路径 `clearTimeout` 清理） | cr-fix MF-10 | yes |
| T-CB19 | mobile：code-copy 源码契约——document 捕获阶段 click 委托、`.code-copy` closest 命中、stopPropagation 拦冒泡（cr-fix MF-12，RN 环境无 jsdom 按「读源码 + dist」惯例） | cr-fix MF-12 | yes |
| T-CB20 | mobile：copyCode 负载（pre>code textContent）与 copied 反馈（1500ms 复位）、attached 幂等守卫 | cr-fix MF-12 | yes |
| T-CB21 | mobile：dist 契约——chat-transcript / rich-document 两包 app.js 均含 code-copy 委托标记 | cr-fix MF-12 | yes |
| T-CB22 | mobile：双宿主 handleMessage copyCode → Clipboard.setString；双 Bridge copyCode 消息类型 | cr-fix MF-12 | yes |
| T-CB23 | mobile：bind-shell-events 与 rich-document main.ts 的 attachCodeCopyDelegation 挂接契约 | cr-fix MF-12 | yes |

## 风险与回滚方案

| 风险 | 影响 | 缓解 / 回滚 |
|------|------|-------------|
| **批注回归**（高亮向文本内插入 span、语言标签引入新内容） | 划词批注错位、回显偏移 | 设计层规避：高亮 span 不改 `textContent` 拼接；语言标签走 `data-lang` + 伪元素（不进文本流），沿用 mermaid「源码保留节点」先例。T-CB14 真机 manual_user 验收为 blocking 门禁。回滚：revert C-7/C-9 的 `data-lang` 与 hljs 相关改动即可恢复纯文本（块级形态可独立保留）。 |
| **sanitize 白名单** | `data-lang` 若被剥离则 mobile 语言标签失效；放松过头则降低安全基线 | 仅加 `pre` 的 `data-lang`（`data-*` 非可执行属性，风险极低）；T-CB7 同时钉死「放行 data-lang」与「onclick/script 仍剥离」双向断言。回滚：C-8 单点 revert。 |
| **高亮库体积** | RN bundle 增长（hljs core + 10 语言模块）；WebView app.css 增量；长文档多代码块的 HTML 膨胀 | 只引 `highlight.js/lib/core` + 按需语言子模块，禁全量 `highlight.js` import（lint 口头约定 + code review）；`RICH_CONTENT_MAX_CHARS` 12k 阈值判断基于源文本 length，不受 HTML 膨胀影响；Step 8 记录构建产物体积，app.css 增量超 3KB/包 或 RN bundle 增长异常时回到选型重评（可减语言清单）。回滚：C-2 + C-6/C-7 revert，高亮整体退场，块级形态与语言标签（纯 CSS）不受影响。 |
| **双端一致性**（rehype-highlight 与 hljs 版本/语法差异导致 token 类名不同） | 验收「同一内容双端一致高亮」不达标 | 双端 pin 同主版本 highlight.js 系（lowlight 与 hljs 同源语法）+ 语言注册表同源（desktop `languages` 选项与 mobile core 注册同一集合，见语言清单节）；T-CB13 以统一样例对 token 类名并集做契约断言；差异出现时以 mobile（RN 侧 hljs）输出为基准调整 desktop `languages` 注册表/版本。 |
| **mermaid 回归**（rehype-highlight 改写 code 子节点 / fence renderer 破坏 `language-mermaid`） | 图表链路失效 | 三层保护：`languages` 注册表不含 mermaid + `plainText: ['mermaid']`（加类前 return）+ 特判 `includes` 宽匹配，另 `detect: false`；fence renderer 保持 `language-mermaid` 原样输出；T-CB2 / T-CB8 双端钉死；既有 `mermaid-markdown.test.tsx`、`mermaid-webview.test.ts` 零改动跑通作为回归门禁。 |
| **mobile 主题切换**（`data-nm-mode` 推断错误或未随 themeUpdate 更新） | 暗色主题下高亮配色刺眼 / 不可读 | 推断挂 `applyTheme` 内，`init` 与 `themeUpdate` 两条路径都会走；算法与 mermaid 主题推断同源（已上线验证）。回滚：token 规则退回仅用现有 7 个主题变量的降级配色（C-9 内部降级，不动结构）。 |
| **desktop 用户气泡覆盖遗漏** | 用户消息内代码块仍是旧观感 | T-CB5 钉死 `.chat-message--user` 覆盖规则同步；样式类改动 revert C-4/C-5 即整体回滚（纯 CSS，无结构影响）。 |
