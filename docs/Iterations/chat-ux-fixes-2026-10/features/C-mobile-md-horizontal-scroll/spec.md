---
date: 2026-10-27
iteration: chat-ux-fixes-2026-10
feature: C
scope: mobile-only
depends_on: []
---

# C · 手机端 markdown 表格/代码块横向滚动 技术规格（SPEC）

> 本 feature 即总纲中的原 F3。纯 CSS 方案，不改 HTML 结构；桌面端不动。
> 本迭代无独立 PRD——需求为用户口述，原话见「需求来源」。

## 需求来源

用户口述（2026-10-27，本会话）原话：

> 「msg 与文件预览 markdown 表格/代码块展示优化，手机屏幕小，换行展示其实还是太挤了，还是有横向 scroll 更方便一些。」

用户追加确认（2026-10-27）：三条 bug 全部只发生在 mobile 端。

路线拍板（2026-10-27，AskUserQuestion）：**纯 CSS**——只改样式单源，不做 markdown-it wrapper div。

## 设计目标

1. 聊天消息里的 markdown 代码块与表格**不再折行**，改为横向滚动。
2. 文件预览（Markdown 档 / rich 档）同样生效——两者共用同一条 WebView 管线与同一份样式单源，一处改两处生效。
3. 不抢纵向手势：横滚不破坏聊天/文档页的竖向滚动与贴底。

## 非目标

- 不做 HTML 包装 div（方案 B）——`markdown-it` 输出结构、`sanitize-rich-html.ts` 白名单、`prepare-transcript-rich-html.ts` 均不动。
- 不改桌面端（desktop 代码块本就 `overflow:auto`、表格仍 `width:100%` 折行；双端分叉为已知结果）。
- 不处理 `img`/宽图（本次只要求表格与代码块）。
- 不动行内 `code`、`streamTailPlain`、`.bubble` / `.doc-body` 容器规则、`#scroller` / `#doc` 的 `overflow-x: hidden`（外层裁切与内层横滚正交）。
- 不把复制按钮外置或改 sticky（会破坏 `pre > .code-copy` 选择器与 `code-copy.ts` 的 `btn.closest(pre)` 契约，见风险 6）。
- 不改 `overscroll-behavior` / `:has()`（Chromium 58 基线不支持，`build-webview.mjs:44-48` 注释明确 minSdk 26 对应 Chromium 58）。

## 现状实现摘要

### 渲染链路（两个场景共用一条管线）

- 聊天消息（assistant 正文 / thinking）：RN 侧 `enrich-transcript-rows.ts:19-40` 调 `prepareTranscriptRichHtml()` 预生成 HTML → WebView 内 `AssistantBubble.tsx:61-65` 用 `TrustedHtml` 注入 `.bubble-body.rich`（thinking 走 `.thinking-body.rich`）。
- 文件预览：`FileMarkdownPreview.tsx:304-313` 调**同一个** `prepareTranscriptRichHtml()`，`:472-481` 渲染 `RichDocumentWebView`；WebView 内 `DocumentApp.tsx:34-40` 注入 `.doc-body.rich`。`PromptEditorScreen` 的 Markdown 预览复用 `FileMarkdownPreview`，一并受影响。
- 用户消息不渲染 markdown（`MessageRow.tsx:50-85` 是纯文本 + ref token），工具卡片也不是 markdown——**本需求的聊天侧实际覆盖面 = assistant 正文 + thinking**。
- CSS 由**样式单源** `apps/mobile/src/web/shared/rich-content-styles.ts` 的 `buildRichContentCssRules(selectors)` 生成两份常量（`CHAT_TRANSCRIPT_RICH_CSS` / `RICH_DOCUMENT_RICH_CSS`），`scripts/build-webview.mjs:585-596` 在 `/* __RICH_CSS__ */` 占位处注入两个包的 `app.css`。

### 表格现状：没有任何 mobile 表格 CSS

- `prepare-transcript-rich-html.ts` 只覆盖 `fence`（`:71-98`）与 `code_block`（`:103-108`），**没有 `table_open/table_close` 覆盖**，表格走 markdown-it 默认输出。
- 样式单源**全文无 `table` / `th` / `td` 规则**；已构建的 `webview-dist/chat-transcript/app.css` 与 `rich-document/app.css` 同样检索不到表格选择器。
- 折行来自继承：`.rich` 根 `white-space: normal; overflow-wrap: anywhere`（`rich-content-styles.ts:88-89`）+ `.bubble` / `.bubble-body` / `.doc-body` 的 `word-break: break-word`。没有 `table-layout`、没有 `width: max-content`、没有单元格 `white-space: nowrap` → auto 布局把列压到最小内容宽度，叠加 `overflow-wrap: anywhere` 即逐字折行。

### 代码块现状：显式折行 + 历史禁令

- 出口是自定义 fence 渲染（`prepare-transcript-rich-html.ts:71-108`），语法高亮在 RN 侧 `highlight-code.ts` 完成；不是库内置 CodeBlock，也不是 RN 组件。
- 样式单源 `rich-content-styles.ts:128-140`（已抽查核实）：`white-space: pre-wrap; overflow-wrap: anywhere; overflow-x: visible;`，注释明写「折行后勿用 overflow-x:auto，避免内层滚动抢 transcript 竖滑」。
- 该禁令来自旧迭代：`docs/Iterations/markdown-code-block-render/spec.md:16 / :201`（T-CB10）与 `docs/Iterations/chat-rich-render/bugs/mobile-chat-codeblock-soft-wrap/spec.md:10`——**本迭代显式废止**。
- 测试钉死：`__tests__/rich-content-styles.test.ts:33-40` 断言 `not.toContain('overflow-x: auto')`；`__tests__/code-block-render.test.tsx:223-233`（T-CB10）同款。
- mermaid 特判：fence 对 mermaid 返回**裸 `<pre>`（无 `data-lang`、无复制按钮）**；WebView 内 `web/shared/mermaid-core.ts:180-209` 成功时把源码 pre 移入 `.mermaid-block` 并加上 `.mermaid-block__source`（该规则是 `display:none; margin:0; padding:0`，`:186`），失败时给 pre 加 `data-mermaid="failed"` + `mermaid-failed` class（`:206-208`）。三态都不带 `data-lang`——基底 `pre` 规则照旧给它们折行与视觉，横滚只覆盖 `pre[data-lang]`（见 D3-1 注意 1）。

## 实现方案

### D3-1 样式单源（`apps/mobile/src/web/shared/rich-content-styles.ts`）

在 `buildRichContentCssRules` 模板内，`pre` 规则位于 `:128-140`（`code` 行内规则在 `:125-127`，不动）：

```ts
/* 代码块基底：**保持现状不改**（视觉 + 默认折行） */
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
/* 普通代码块：不折行 + 横向滚动（2026-10-27 拍板，废止 T-CB10 折行禁令）。
   滚动容器落在**内层 code** 上，不是 pre 本身——pre 一旦成为滚动容器，绝对定位的
   复制按钮（pre > .code-copy）会跟着内容一起滚出视口（真机反馈）。pre 只当定位基准。
   作用域收在 pre[data-lang]：普通代码块（含无语言 fence 与缩进块）一律带 data-lang
   （prepare-transcript-rich-html.ts:86 / :97 / :105）；mermaid 三态都不带（pending 见
   同文件 :94；failed 由 mermaid-core.ts:207 只加 class + data-mermaid，不进容器；
   success 是 .mermaid-block__source）——基底规则继续给它们折行与视觉。 */
${child('pre[data-lang]')} > code {
  display: block;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
  overflow-y: hidden;              /* 禁 auto：避免嵌套纵向滚动抢 transcript 竖滑 */
  -webkit-overflow-scrolling: touch;
}
/* 表格：外框 + 行分隔线（display:block 下 border-collapse 失效，逐格四边描边会叠双线）；
   内容宽时整表横滚，单元格限宽换行，不让一格横向长到天边 */
${child('table')} {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  margin: 0.5em 0;
  border: 1px solid var(--border, #e5e5ea);
  border-radius: 6px;
}
${child('th')}, ${child('td')} {
  padding: 0.3em 0.7em;
  border-bottom: 1px solid var(--border, #e5e5ea);
  text-align: left;
  vertical-align: top;
}
${child('th')} {
  background: rgba(0,0,0,0.04);
  font-weight: 600;
  white-space: nowrap;
}
${child('td')} {
  max-width: 20em;
  white-space: normal;
  overflow-wrap: anywhere;
}
```

三条注意：

1. **必须拆成「基底 + 覆盖」两条规则，不能把 `pre` 整条替换成 `pre[data-lang]`**。整条替换会让 mermaid 三态同时丢掉 `border / background / padding` 与折行——失败态的长源码行还会被 `web/chat-transcript/styles/transcript.css:30` 的 `overflow-x: hidden` 直接裁掉（F-C5 只查「有无内层滚动条/破图」，抓不到裁切）；而且既有测试 `code-block-render.test.tsx:203-208`（T-CB9 断言裸 `.bubble.rich pre {` 含 border/padding/border-radius/background）与 `:253`（T-CB17 断言含 `position: relative`）会直接红。基底不动 + 只覆盖四条声明，两个问题一并消失。
2. **表格不写 `border-collapse`**：`display: block` 让 table 不再生成 table box，`border-collapse` 落到匿名表盒上不生效（默认 `separate`）。所以边框不再逐格四边描（会叠成 2px 双线，真机反馈「丑」），改为**外框 + 行分隔线**：table 一条 1px 外框，`th/td` 只留 `border-bottom`，表头加 4% 底纹。
3. **`th/td` 的 `border-bottom` / `padding` / `text-align: left` / `th` 底纹是新增视觉**（现状表格无边框无内边距，对齐随浏览器默认），属于「表格可读性」的显式设计变更，不是纯横滚副作用。
4. **单元格必须限宽**：`td { max-width: 20em; white-space: normal; overflow-wrap: anywhere }`——不设上限时一格长文本会把整表撑到天边（真机反馈第 3 条）。表头 `th` 保持 `nowrap`（短、且要当列锚点）。表格仍保留 `width: max-content; max-width: 100%` + 横滚，作为「列很多、单格都已限宽仍放不下」时的兜底。

- 选择器一律经既有 `child()` 助手拼接（`.bubble.rich` / `.bubble-body.rich` / `.thinking-body.rich` / `#doc .doc-body.rich` 四个 root 自动生效）。
- 复制按钮 `.code-copy`（`:143-157`）与语言标签 `pre[data-lang]::before`（`:159-167`）规则不动；语言标签宿主同样是 `pre[data-lang]`，与新覆盖规则共存无冲突。

### D3-2 零 HTML / 零 RN 改动确认

- `prepare-transcript-rich-html.ts`、`sanitize-rich-html.ts`、`transcript.css`、`document.css`、`enrich-transcript-rows.ts`、`FileMarkdownPreview.tsx`、`RichDocumentWebView.tsx`、`ChatConversationWebView.tsx`、`AssistantBubble.tsx`、`DocumentApp.tsx` **全部不动**。
- 安全基线不受影响：无 inline style、无 style 标签，横滚完全走 class + CSS 单源。

### D3-3 测试反转与旧禁令废止

| 项 | 动作 |
|---|---|
| `__tests__/rich-content-styles.test.ts:33-40` | 反转并改按规则块断言（见 F-C1）：删除 `not.toContain('overflow-x: auto')`；改为正则抠块后断言 `pre[data-lang]` / `table` / `th,td` 三块各自的关键声明 + 「不存在裸 `pre` 横滚规则」。`:42-48` 的既有失败态用例**保持不动**——作用域方案下失败态不再需要额外规则 |
| `__tests__/code-block-render.test.tsx` | T-CB10（`:223-234`）**改按规则块断言**：基底 `pre` 块不许含 `overflow-x: auto`（全量 `not.toContain` 会误伤新增的覆盖规则）；`pre[data-lang]` 覆盖块要含横滚。T-CB9（`:203-208`：border/padding/border-radius/background）与 T-CB17（`:251-256`：`position: absolute` 复制按钮）**保持不变**——基底规则没动 |
| `__tests__/chat-transcript-rich-styles.test.ts` | dist 级补表格/代码块断言，**两个包都覆盖**（现状只读 `chat-transcript` 的 `app.css`，需加 `rich-document`；**先 `npm run build:webview` 再测**，否则测旧产物假绿） |
| `docs/Iterations/markdown-code-block-render/spec.md` | 文首（`:16` 与 T-CB10 `:201` 附近）标注「横滚禁令已由 `chat-ux-fixes-2026-10` feature C 废止（superseded）」 |
| `docs/Iterations/chat-rich-render/bugs/mobile-chat-codeblock-soft-wrap/spec.md` | 同款标注（`:10` 附近） |

### D3-4 影响面清单

| 文件 | 类型 |
|---|---|
| `apps/mobile/src/web/shared/rich-content-styles.ts` | 改：**基底 `pre` 规则不动**，新增 `pre[data-lang]` 覆盖规则 + `table` / `th,td` 两条（**唯一实现改动**） |
| `apps/mobile/webview-dist/{chat-transcript,rich-document}/app.css` | 构建产物，不手改（`npm run build:webview`） |
| `apps/mobile/android/app/src/main/assets/webview/`、`apps/mobile/ios/NovelMaster/WebViewDist/` | 真机/APK 用 `npm run build:webview:native` |
| 测试：`rich-content-styles.test.ts`、`code-block-render.test.tsx`、`chat-transcript-rich-styles.test.ts` | 改/补 |
| 旧文档：`markdown-code-block-render/spec.md`、`chat-rich-render/bugs/mobile-chat-codeblock-soft-wrap/spec.md` | 加 superseded 标注 |

## 验收清单

牙齿判据：具体可执行、实现错则红、实现对则绿。

- **F-C1**：**按规则块断言，禁止全量 `toContain`**——`white-space: pre` 是 `pre-wrap` 的前缀、`overflow-x: auto` 会被 table 规则满足、`display: block` 会被语言标签规则满足，全量匹配会假绿。抠块有坑：`CHAT_TRANSCRIPT_RICH_CSS` 是多 root 逗号连接（`.bubble.rich pre[data-lang] > code, .bubble-body.rich pre[data-lang] > code, … {`），`th, td` 还是两组 `child()` 拼在一起，照抄 `code-block-render.test.tsx` 的单 root 正则抠不到。做法：对 `buildRichContentCssRules(['.bubble.rich'])` 的产物用局部 `cssBlock(css, selector)` 助手抠块断言，另用 `toContain` 检查两份最终 CSS 都含 `pre[data-lang] > code` 与 `max-width: 20em`。断言五条：① 基底 `pre` 块仍含 `white-space: pre-wrap` + `overflow-x: visible`，且**不含** `overflow-x: auto`；② `pre[data-lang] > code` 块含 `white-space: pre;`（带分号）、`overflow-x: auto`、`overflow-y: hidden`，且**不含** `pre-wrap`；③ `table` 块含 `display: block` + `width: max-content` + `overflow-x: auto`；④ `td` 块含 `max-width: 20em` + `white-space: normal`；⑤ `th` 块含 `white-space: nowrap`。牙齿：把横滚写进裸 `pre` 规则 → ①红；把滚动容器改回 `pre[data-lang]`（复制按钮会跟着滚）→ ②红；删掉 `td` 限宽 → ④红。
- **F-C2**：dist 产物同款断言，**两个包都要覆盖**（`readWebViewDistFile('chat-transcript','app.css')` 与 `('rich-document','app.css')`）。注意假绿方向：不 build 时新断言是**假红**（测的是旧产物）、旧的 list 断言才假绿——所以必须先 `npm run build:webview` 再判红绿；只测 chat-transcript 则文档预览侧漏检。
- **F-C3**（真机，替代旧 T-CB10 的手势禁令）：单指竖向拖动经过代码块/表格区域，聊天与文档页仍正常纵向滚动（横滚不抢竖滑）；横向拖动才滚动内层；复制按钮在**横向滚动后仍钉在右上角**可见可点（滚动容器已下移到内层 `code`，按钮不再是滚动内容）。
- **F-C4**（真机）：超宽表格（≥6 列长文本）与超长代码行（>200 字符单行）在**文件预览与聊天消息两处**都出现横向滚动且不折行。
- **F-C5**：mermaid 块（含渲染失败回退源码态）不出现内层横向滚动条、不破图（回归 T-MV1/T-MV2）。
- **F-C6**：既有流式与窗口化无回归——流式输出、贴底、行窗口卸载重挂后页面纵向滚动正常（真机）。

## 风险点

1. **手势冲突是历史否决理由的显式反转**：旧迭代禁横滚正是怕抢竖滑。F-C3 不达标即回退——回退方案是 HTML 包装 div（本 SPEC 不做），需另立迭代。
2. **Chromium 58 基线**：`display: block` 改 table 盒模型 + `-webkit-overflow-scrolling: touch` 在 minSdk 26 旧内核的表现需真机覆盖（荣耀真机即旧内核档）。若表现不稳（列宽塌陷、无滚动条），改用包装 div 路线。
3. **复制按钮与语言标签**：`.code-copy` 是 `pre` 内绝对定位、`pre[data-lang]::before` 同理。**滚动容器下移到内层 `code` 后两者都不随内容滚动**（`pre` 不再是 scrollport，仍是定位基准）——这是真机反馈第 1 条的直接修复；语言标签仍留在 `pre::before`，位置不变。
4. **mermaid 回归面**：基底 `pre` 规则**原样保留**，mermaid 三态（pending / failed / success，都不带 `data-lang`）的折行、`border` / `background` / `padding` 逐字不变——这是选「基底 + 覆盖」而非「整条替换」的核心原因；横滚选择器收在 `pre[data-lang] > code`，mermaid 的裸 `pre > code` 不在作用域。剩余风险只在图表宽度与全屏查看，由 F-C5 真机回归。
5. **行高变化连锁**：不折行后消息高度下降，`row-windowing.ts` 的行高测量会重测、贴底与 `overflow-anchor: none` 锚点行为需真机回归。
6. **横向 scrollLeft 不保留**：流式每帧整段替换、行窗口卸载重挂后内层 scrollLeft 归零。接受并披露。
7. **批注（Recogito）**：纯 CSS 不改 DOM，textContent 与偏移理论上零影响；但横滚容器内的划词、选区与高亮层定位无现成测试覆盖，需真机回归。
8. **测试与构建陷阱**：`chat-transcript-rich-styles.test.ts` 直读 dist，只跑 `npx jest` 不 `build:webview` 会得到假绿；`pretest` 会自动 build，单跑 jest 不会。
9. **`td` 限宽在旧内核的落点**：`max-width: 20em` 在 `display: block` 表格的匿名表盒里由实现决定是否生效。生效的正常表现是「超长单元格在该宽度处折行、整表可横滚」；若荣耀机的 Chromium 内核忽略它，退路是给 `td` 加 `width: 20em`（配合 `table-layout` 语义）或改回包装 div 路线。这一条已由真机反馈触发，属**本轮修复的观察项**而非接受项。
10. **表格视觉变更已披露**：正从「无边框」变成「外框 + 行分隔线 + 表头底纹 + 内边距」，是用户明确要求「样式优化」的结果，不再按副作用处理。

## 待确认问题

1. 桌面端表格是否也要同步横滚——默认不做（桌面表格 `width:100%` 折行是现状，改则双端回归另开迭代）。
2. ~~复制按钮随横滚移出视口是否接受~~ **已决（2026-10-28 真机反馈）**：不接受，滚动容器已下移到内层 `code`，按钮钉住不动。

## 落地

1. 按 RULE 开迭代 worktree 分支后动代码；本 SPEC 已落主仓 `docs/Iterations/`，提交由用户决定。
2. 实现前先 `git grep` 复核本文行号（基于 2026-10-27 main）。
3. 验收命令（**先 build core**——mobile jest 把 `@novel-master/core/*` 映射到 `packages/core/dist`，干净 worktree 不 build 会 module-not-found；再重建 WebView，dist 级测试读的是产物）：

```
cd /d D:\Dev\Js\novel-master && npm run build -w @novel-master/core
cd apps/mobile && npm run build:webview && npx jest \
  __tests__/rich-content-styles.test.ts __tests__/code-block-render.test.tsx \
  __tests__/chat-transcript-rich-styles.test.ts --maxWorkers=2
```

4. 真机验收：先 `npm run build:webview:native` 再打包含入 assets（按 RULE 的 Metro 流程启动，荣耀真机 `DSLDU20407006179` 需用户在场确认安装）。
5. 收口后 changelog 走 `novel-master-changelog` skill 的 Unreleased 段（一条）。
