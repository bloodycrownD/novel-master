---
date: 2026-08-19
---

# 文件预览 Mermaid 图表渲染 技术规格（SPEC）

## 设计目标

markdown 富文本场景（文件预览 + 聊天消息）下，` ```mermaid ` 代码块渲染为图表；desktop（react-markdown）与 mobile（rich-document / chat-transcript 两条 WebView 管线）全场景覆盖；失败回退源码 + 失败标识；流式输出期间不闪烁；与明暗主题协调。需求来源：`docs/Iterations/markdown-preview-mermaid/prd.md`。

## 总体方案

两端均采用「**运行时渲染 + 失败回退**」策略，mermaid 以依赖形式打进各自 bundle（file:// WebView 无 CDN，禁止网络加载）。

- **desktop**：新增共享组件 `MermaidMarkdown`（封装 `<Markdown remarkPlugins={[remarkGfm]}>` + 自定义 code 渲染器），`PreviewPane.tsx` 与 `MessageList.tsx` 均改用该组件渲染 markdown（不再直引 react-markdown）。渲染器检测 `className === 'language-mermaid'`，命中则挂容器 ref，动态 `import('mermaid')` 后 `mermaid.render` 注入 SVG；失败/非 mermaid 走默认 `<code>` 渲染并附失败标识。主题：读取 `html[data-theme]`（`ThemeProvider.tsx` L51-60）选 mermaid `dark`/`default` 主题，`MutationObserver` 监听主题切换重渲染。vite 无 manualChunks，动态 import 自动分包、不拖累首屏。
- **mobile·预览**：新增 WebView 侧 runtime 模块 `webview/runtime/mermaid.ts`（无 JSX），`main.ts` 在每次 `setDocument` 视图刷新后调用：扫描 `.language-mermaid` 节点，bundle 内 mermaid 渲染 SVG **插入图表节点并将源码 `<code>` 置于 `display:none` 的保留容器**（见批注偏移风险），失败时保留源码并加失败样式。主题：`bridge.ts` `applyTheme` 已把 CSS 变量写到 `documentElement`，runtime 按 `--bg` 亮度推断 dark/default（避免扩展 HostTheme payload）。
- **desktop·聊天消息**：`MessageList.tsx` 两处（L46 `MessageBody`、L169 流式尾）与 `PreviewPane.tsx` 复用同一个渲染器（抽共享组件 `MermaidMarkdown`，内部含 code renderer）。**流式时 desktop 每帧全量重渲 react-markdown**，渲染器必须 memo：按 mermaid 源码缓存（源码不变不重渲、不重跑 mermaid.render）。memo 挡不住正在流式输出的未闭合 fence 块（源码每帧变），此时按占位样式显示源码、不触发 `mermaid.render`、不挂失败标识，fence 闭合后再正常渲染。
- **mobile·聊天消息（chat-transcript WebView，独立管线）**：流式 rich 路径每 rAF **整段替换 `.bubble-body` innerHTML**（`stream.ts` `appendStreamDeltaIncremental`），流式期不能渲图。策略：流式期间保留 `<pre class="language-mermaid">` 源码/占位样式；`streamCommit`（定稿转历史行）与历史快照路径（`sessionSnapshot`/`prependPage`/`appendTailRows`）渲染完成后，由新增的 chat-transcript 侧 mermaid runtime（懒加载 + 按源码去重 + 防抖）扫描渲染。 sanitize 白名单不含 SVG，**必须在消毒后的 WebView 侧渲染**，RN 侧不产 SVG。

## 最终项目结构

```
apps/desktop/
  renderer/components/MermaidMarkdown.tsx       # 新增：共享渲染组件（Markdown + code renderer + memo 缓存 + 主题监听）
  renderer/layout/PreviewPane.tsx                # 改：改用 MermaidMarkdown（保留 mdRootRef/preview-markdown 结构）
  renderer/features/chat/MessageList.tsx         # 改：L46/L169 两处改用 MermaidMarkdown
  renderer/styles/shell.css                       # 改：.mermaid-block / .mermaid-failed 样式（CSS 变量配色）
  test/preview-recogito-md.test.ts               # 改：L67/L68 断言改为匹配 MermaidMarkdown 引用；react-markdown/remarkGfm 契约断言转移到 MermaidMarkdown.tsx
  package.json                                    # 改：+ mermaid
apps/mobile/
  src/web/rich-document/webview/runtime/mermaid.ts  # 新增：预览 WebView 渲染 runtime
  src/web/rich-document/webview/main.ts             # 改：render 后调用 runtime
  src/web/chat-transcript/webview/runtime/mermaid.ts # 新增：聊天 WebView 渲染 runtime（懒加载+去重+防抖，streamCommit/历史路径触发）
  src/web/chat-transcript/webview/                   # 改：stream.ts / snapshot 路径渲染后触发 runtime
  src/web/shared/rich-content-styles.ts           # 改：图表/占位/失败样式（两管线 CSS 单源）
  package.json                                    # 改：+ mermaid
```

> 若两条 WebView 管线的 runtime 逻辑高度重合，可下沉共享模块到 `web/shared/`（由实现时判断，不强约束）。

## 变更点清单

见上「最终项目结构」标注的 新增/改动。约束（来自既有测试与管线，探索确认）：

- `PreviewPane.tsx` 改用 `MermaidMarkdown` 后不再直引 react-markdown（根 `tsconfig.base.json` 开 `noUnusedLocals: true`，死导入会编译报错，必须移除）；仍须保留：不引 rehype-raw、`mdRootRef`/`preview-markdown`（`preview-recogito-md.test.ts` L62/L95 断言）。L67 的 `react-markdown` 断言与 L68 的精确 JSX 断言改为匹配 `MermaidMarkdown` 引用；react-markdown/remarkGfm 的契约断言转移到 `MermaidMarkdown.tsx` 上。`MessageList.tsx` 两处无测试锁写法（`message-list-stream.test.tsx` 未断言 JSX）。
- mobile `sanitize-rich-html.ts` 的白名单已保留 `pre/code` 与 `class` 属性，**消毒管线零改动**；白名单不含 SVG，SVG 只能在 WebView 内生成。
- WebView runtime 禁 JSX、禁 RN 组件树；样式只能进 `rich-content-styles.ts` 单源（CHAT_TRANSCRIPT_RICH_CSS 与 RICH_DOCUMENT_RICH_CSS 同源注入，`build-webview.mjs` 三 entry：chat-transcript / rich-document / code-editor）。
- chat-transcript 流式增量岛（`StreamTail.tsx` `StreamBodyHost.shouldComponentUpdate=false`）不可被图表渲染破坏：runtime 只操作 mermaid 节点自身，不重排周边 DOM。

## 详细实现步骤

- Step 1 — phase-mermaid-deps — blocking: yes — qa: auto：desktop 与 mobile `package.json` 加 `mermaid` 依赖并安装（版本取当前稳定版）。
- Step 2 — phase-mermaid-desktop — blocking: yes — qa: auto：新增 `MermaidMarkdown.tsx` 共享组件：封装 `<Markdown remarkPlugins={[remarkGfm]}>` + mermaid code renderer（动态 import、`mermaid.render` 注入、失败回退源码 + `.mermaid-failed` 标识、`data-theme` 监听重渲染）；**按 mermaid 源码 memo 缓存**，源码不变不重跑渲染（流式场景每帧重渲由 memo 挡住）；**流式期未闭合 fence**（memo 失效、源码每帧变）按占位样式显示源码、不触发 `mermaid.render`、不挂失败标识，fence 闭合后再正常渲染；每次 `mermaid.render` 使用唯一 id（自增或随机），避免主题切换重渲与多条消息并发渲染共用固定 id 报错。实现注：未闭合 fence 的判定不能在 code renderer 层做（remark 解析后会把文末未闭合围栏当成正常 code 块，「是否闭合」信息已丢失），需在 `MermaidMarkdown` 组件层对原始 `content` 做围栏配对检测后传给渲染器；动态 `import('mermaid')` 与 `mermaid.render` 只能放 `useEffect`（`message-list-stream.test.tsx` 用 renderToStaticMarkup 静态渲染不跑副作用，render 期间做会挂测试）。
- Step 3 — phase-mermaid-desktop — blocking: yes — qa: auto：`PreviewPane.tsx` 改用 `MermaidMarkdown`（移除 react-markdown 直引，保留 `mdRootRef`/`.preview-markdown` DOM 结构）；同步更新 `preview-recogito-md.test.ts` L67/L68 断言为匹配 `MermaidMarkdown` 引用，react-markdown/remarkGfm 契约断言转移到 `MermaidMarkdown.tsx`；跑既有 preview 测试全绿（T-MD1~T-MD3）。
- Step 3a — phase-mermaid-desktop — blocking: yes — qa: auto：`MessageList.tsx` L46 / L169 两处改用 `MermaidMarkdown`；跑 `message-list-stream.test.tsx` 等既有消息测试（T-MD4）。
- Step 4 — phase-mermaid-mobile — blocking: yes — qa: auto：新增 `webview/runtime/mermaid.ts`（扫描、渲染、源码 `display:none` 保留、失败标识、`--bg` 亮度推断主题）；`main.ts` render 后挂接；`rich-content-styles.ts` 加样式（T-MV1~T-MV3 的可自动部分）。
- Step 5 — phase-mermaid-mobile — blocking: yes — qa: auto：`npm run build:webview` 重新生成 `webview-dist`；确认 bundle 含 mermaid、体积增幅记录到发布说明素材。
- Step 5a — phase-mermaid-chat — blocking: yes — qa: auto：新增 `chat-transcript/webview/runtime/mermaid.ts`（懒加载 + 按源码去重 + 防抖）；挂接点：`sessionSnapshot`/`prependPage`/`appendTailRows` 历史行渲染后与 `streamCommit` 定稿后触发；流式期（streamDelta/streamBatch）不渲染，保留源码占位样式（T-MT1~T-MT3）。
- Step 5b — phase-mermaid-chat — blocking: yes — qa: auto：`rich-content-styles.ts` 补聊天管线的占位样式（流式期源码块弱化展示，避免用户误以为渲染失败）；重建 webview bundle；回归聊天相关既有测试。
- Step 6 — phase-mermaid-regression — blocking: yes — qa: auto：批注回归：desktop 跑 `preview-annotate*.test.ts`、`preview-recogito-md.test.ts`；mobile 跑 `annotate-recogito-preview.test.tsx`、`file-markdown-preview-annotate.test.tsx`（T-MV4）。
- Step 7 — phase-mermaid-qa — blocking: no — qa: manual_user：双端真机/录屏验收 PRD 用例 #1-#10（含聊天流式→定稿呈现图表、历史消息直接呈现）。

## 测试策略

### 测试用例

- T-MD1 — blocking: yes — desktop 源码契约：`PreviewPane.tsx` 使用共享 Mermaid 渲染组件（匹配 `MermaidMarkdown` 引用），且不出现 `rehype-raw`、保留 `mdRootRef`/`preview-markdown`；`MermaidMarkdown.tsx` 承接 react-markdown/remarkGfm 契约断言（映射 Step 2/3）
- T-MD2 — blocking: yes — desktop 渲染器单测：mermaid 源码 → 容器注入 SVG；语法错误 → 回退源码 + 失败标识；同源码重复渲染命中 memo 不重跑；未闭合 fence → 占位源码、不触发渲染、无失败标识（映射 Step 2）
- T-MD3 — blocking: yes — desktop：主题切换（data-theme 变更）触发重渲染、清理 observer（映射 Step 2）
- T-MD4 — blocking: yes — desktop：`MessageList.tsx` 两处（MessageBody 与流式尾）均使用共享组件；既有消息/流式测试全绿（映射 Step 3a）
- T-MV1 — blocking: yes — mobile 源码契约：`main.ts` 挂接 mermaid runtime；`rich-content-styles.ts` 含图表样式（映射 Step 4）
- T-MV2 — blocking: yes — mobile runtime 单测（可 jsdom）：`.language-mermaid` 节点被替换为图表且源码保留隐藏；非法源码保留显示 + 失败类名（映射 Step 4）
- T-MV3 — blocking: yes — mobile：`sanitizeRichHtml` 输出保留 `language-mermaid` class（钉死消毒不改动的约束）（映射 Step 4）
- T-MV4 — blocking: yes — 批注回归测试全绿（映射 Step 6）
- T-MT1 — blocking: yes — mobile chat-transcript：历史行（sessionSnapshot/appendTailRows）渲染后 mermaid 块被 runtime 处理为图表（映射 Step 5a）
- T-MT2 — blocking: yes — mobile chat-transcript：流式 delta 期间不触发 mermaid 渲染（源码占位）；`streamCommit` 后触发（映射 Step 5a）
- T-MT3 — blocking: yes — mobile chat-transcript：同一源码多次触发只渲染一次（去重）；非法源码保留显示 + 失败标识（映射 Step 5a）

## 风险与回滚方案

- **最大风险·批注偏移**：批注 renderStart/End 基于渲染后 DOM 文本流，mermaid 成功渲染会移除源码文本、移动后续偏移。方案：成功态将源码 `<code>` 置于 `display:none` 容器保留（textContent 不变），desktop 同理在容器内保留隐藏源码；Step 6 全量回归批注测试。若仍有偏移，回退方案为「预览区暂不渲染图表、仅失败标识样式提示」，独立 revert 不影响其他功能。
- **流式闪烁（新）**：mobile chat-transcript 每 rAF 整段替换 innerHTML，desktop 流式每帧全量重渲——方案为「流式期占位 + commit/memo 后渲染」，Step 5a/T-MT2 与 T-MD2 钉死；若真机仍有闪烁，回退为聊天场景仅显示源码（预览场景保留图表）。
- **流式轻量路径**：无 html 的流式走 `stream-markdown.ts` 轻量渲染（不认 fence），mermaid 源码会以纯文本段落显示约 350ms——接受，占位样式兑底（Step 5b）。
- **包体**：mobile 两个 WebView bundle（IIFE 无分包）各增约 1MB 级；若两 runtime 下沉共享仍无法接受体积，可评估仅 rich-document 打包、chat-transcript 运行时复用同文件的方案（实现时决策）；接受则发布说明注明。
- **主题**：desktop SVG 渲染后不随 CSS 变量自动变，靠 MutationObserver 重渲染；mobile 每次文档刷新重渲染天然覆盖。**已知限制**：mobile 两个 bridge（rich-document / chat-transcript）的 `themeUpdate` 消息只调 `applyTheme` 写 CSS 变量、不重扫已渲染图表，主题切换后已渲染 SVG 配色会陈旧至下次快照/重新进入对应视图；接受该限制，本期不做 themeUpdate 重扫钩子。
- **回滚**：desktop 侧移除 `components` prop 即回退；mobile 侧 `main.ts` 去掉 runtime 挂接一行即回退；均无数据与协议变更。
