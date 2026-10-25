---
date: 2026-10-17
---

# mobile 输入框联想浮层移除 × 文件预览暗色白闪修复 SPEC

## 设计目标

1. **移除 composer 联想浮层（typeahead）**：聊天主输入框（`NativeChatComposer`）与全屏编辑屏（`PromptEditorScreen` composer 变体）打 `@`/`$` 触发的联想浮层整体移除。移除后：picker 引用按钮照常（选完直接落胶囊、不再弹浮层）；手输 `@`/`$` 无任何 UI 反馈（发送时 core 附件扫描行为不变，数据面不动）。
2. **修复文件预览暗色白闪**：`RichDocumentWebView` 两层白窗各堵一层——A：WebView style 主题底色（堵 Android 原生白窗）；B：`injectedJavaScriptBeforeContentLoaded` 预注入 `--bg`（堵 CSS `var(--bg,#fff)` 兜底白窗）。

需求来源：用户口述（见 `prd.md`）；探索依据：三轮 readonly 调研（2026-10-17，报告结论已归档 `docs/apm/memory/20261017-mobile-ux-brain-storm.md`）。**本文行号为探索时点（2026-10-17）快照，实现时以符号定位为准。**

## 总体方案

### Feature 1：typeahead 移除（纯 mobile UI 减法）

两条独立链路（主输入框 / 全屏编辑屏），不共享实现、只共享纯函数与插入链：

- **主输入框链**：`NativeChatComposer` 内联浮层（JSX + `typeaheadView` memo + `composerText`/`selectionStart` 镜像 state）→ 删；`native-composer/typeahead-view.ts` 整文件 → 删；`useChatComposerController` 的 `typeahead` memo、`fileRefs`/`skillRows` state、两个候选源 effect、`composerState.typeahead` → 删；`ChatConversationBridge` 的 `ConversationTypeaheadSource` 类型与 `EMPTY_CONVERSATION_TYPEAHEAD_SOURCE` → 删；`dock-style.ts` 的 `composerTypeaheadStyles` → 删；`ChatConversationPanel` 的 `handleTypeaheadSelect` 与 prop 传递 → 删。
- **全屏编辑屏链**：`AtPathTypeahead.tsx`/`SkillTypeahead.tsx`/`TypeaheadList.tsx` 三组件（全仓仅此屏消费）→ 整删；`PromptEditorScreen` 的候选源 effect、`activeAt`/`activeSkill` 派生、typeahead 提交 handler、`typeaheadDock` JSX 与样式 → 删；`canTypeahead` 收窄为 Picker 可用判据（按钮 disabled 与 Picker 挂载判据继续用）。
- **共享件**：`skill-typeahead-filter.ts`（消费方仅剩两条将删链 + 其单测）→ 同批整删；`prompt-editor-screen.test.tsx` 中 typeahead 用例删，**Picker 用例与 mock 底座保留**（防误删）。
- **保留红线（不得触碰）**：
  - `@`/`$` 引用按钮（两屏）与 `FileReferencePicker`/`SkillPicker` 及其插入链 `insertSkillToken`/`insertTokensIntoComposer`/`buildTokenInsertion`；
  - core `composer-at-path`（`findActiveAtQuery`/`filterAtPathTypeaheadCandidates`，desktop ChatComposer 与 Picker 消费）与 mobile re-export；
  - `PromptEditorScreen` 的 `onSelectionChange`/`cursor` 初值逻辑（Picker 落点依赖，capsule/B-4 测试锁定）；注意 Picker 的「半截查询替换」语义（`:258-268`）依赖 `findActiveAtQuery`——**该计算在 PromptEditorScreen 内保留**；
  - 主输入框侧 `handleSelectionChange` 对 controller 的 selection 转发保留（只删 typeahead 消费的镜像 state）。

### Feature 2：文件预览白闪 A+B（单文件两 prop）

`apps/mobile/src/components/vfs/RichDocumentWebView.tsx`：

- **A**：WebView 组件 `style`（`:372`）改为 `style={[styles.fill, {backgroundColor: tokens.background}]}`——**只挂 WebView 本体，不挂 wrapper View**（仿 `ChatConversationWebView.tsx:1849-1853` 先例；原生控件底色不在 WebView props 白名单，只能走 style）。取值必须 `tokens.background`（暗色 `#000000`）——它是该 webview `--bg` 的映射真源（`shared/host-theme.ts:36-46` `THEME_VARS`），**不得用 `surface`（暗色 `#1C1C1E`）**（RULE #17 颜色映射陷阱）。
- **B**：新增 `injectedJavaScriptBeforeContentLoaded={buildThemeInjectScript(tokens.background)}`。`buildThemeInjectScript` 为模块级纯函数（可单测）：IIFE 内对 `document.documentElement.style.setProperty('--bg', <value>)`，`document.documentElement` null 防护 + try/catch（Android 实现是 `onPageStarted` 异步 `evaluateJavascript`、IIFE 包裹返回值丢弃，时机弱于 iOS 的 AtDocumentStart——A 已兜底，双保险）。值经 `JSON.stringify` 拼入。只注入 `--bg`（正文等 init 后才渲染，其余变量不参与首帧白窗）；后续 `applyHostTheme` 同节点同属性重写同值，覆盖无冲突。注释中点名 `shared/host-theme.ts THEME_VARS` 映射渊源（RN 侧 `'--bg'` 字面量是映射表镜像，改表不会报错）。
- **不动**：`src/web/**` 全部、`RichDocumentBridge` init/themeUpdate 链、构建链（两 prop 均 RN 侧，无需 `build:webview`，Metro 重载即生效）。
- 入口覆盖：`RichDocumentWebView` 全仓仅 `FileMarkdownPreview` 挂载（FileEditorScreen push 屏 / PromptEditorScreen 预览 / PromptTurnDetailScreen——txt 档不进 WebView），改组件内部即全覆盖，无 modal/双栏旁路。
- **CodeEditorWebView 同构对齐（建议项，独立 Step）**：`components/vfs/CodeEditorWebView.tsx:245-272` 同款无底色结构、`editor.css` 同款 `var(--bg,#fff)` 兜底，同文件预览/编辑切换会遇同款白闪；同构两 prop，token 同用 `tokens.background`。

## 最终项目结构

```text
apps/mobile/src/
  components/chat/
    NativeChatComposer.tsx                [改] 删浮层 JSX/memo/handler/镜像 state/props
    useChatComposerController.ts          [改] 删 typeahead memo/候选源/state/类型字段
    ChatConversationBridge.ts             [改] 删 ConversationTypeaheadSource 等类型
    ChatConversationPanel.tsx             [改] 删 handleTypeaheadSelect/props 传递
    dock-style.ts                         [改] 删 composerTypeaheadStyles
    native-composer/typeahead-view.ts     [删]
    AtPathTypeahead.tsx                   [删]
    SkillTypeahead.tsx                    [删]
    TypeaheadList.tsx                     [删]
    skill-typeahead-filter.ts             [删]（两链同批删除后无消费方）
  screens/stack/PromptEditorScreen.tsx    [改] 删 typeahead 链/canTypeahead 收窄/注释同步
  screens/tabs/chat-tab/ChatTabScreen.tsx [改] 注释同步（路由 scope 参数保留，Picker 仍用）
  navigation/types.ts                     [改] 注释同步
  components/vfs/
    RichDocumentWebView.tsx               [改] A+B 两 prop
    CodeEditorWebView.tsx                 [改] 同构 A+B（建议项）
apps/mobile/__tests__/
  typeahead-view.test.ts                  [删]
  skill-typeahead-filter.test.ts          [删]
  native-composer-dock.test.tsx           [改] 删 T-NC8/T-NC10 浮层段
  use-chat-composer-controller.test.tsx   [改] 删候选源 describe/state.typeahead 断言
  chat-conversation-panel.integration.test.tsx [改] 删 typeahead 传递断言
  prompt-editor-screen.test.tsx           [改] 删 typeahead 用例；保 Picker 用例与 mock 底座
  rich-document-webview-annotate-menu.test.tsx [改] 加 A+B 断言
  code-editor-webview.test.tsx            [改] 同构断言（建议项）
```

## 变更点清单

| # | 文件 | 改动 | 备注 |
|---|------|------|------|
| 1 | `NativeChatComposer.tsx` | 删浮层 JSX（760-812）、`typeaheadView`/`typeaheadKey`/`handleTypeaheadSelect`/`typeaheadSelectRef`（531-551）、`typeaheadSource` prop 与 `EMPTY_CONVERSATION_TYPEAHEAD_SOURCE` import（86-88/187-188/248/215/255）、`composerText`/`selectionStart` 镜像（292-294；397-398/419-420/427-431 中仅 typeahead 消费的写入） | 保留 `handleSelectionChange` 对 controller 的 selection 转发 |
| 2 | `useChatComposerController.ts` | 删 `typeahead` memo（422-427）、`fileRefs`/`skillRows` state（303-309）、候选源 effect（374-420）、`composerState.typeahead`（865/877）、`ConversationComposerState.typeahead`（103）、仅被候选源用的 imports/helpers（`toAtPathRefs`/`sameAtPathRefs`/`sameSkills`/`EMPTY_FILE_REFS`/`EMPTY_SKILLS`，194-260 一带） | `insertSkillToken`/`insertTokensIntoComposer`（786-820）保留 |
| 3 | `ChatConversationBridge.ts` | 删 `ConversationTypeaheadSource` + `EMPTY_*`（106-115） | |
| 4 | `dock-style.ts` | 删 `composerTypeaheadStyles`（162-192） | |
| 5 | `ChatConversationPanel.tsx` | 删 `handleTypeaheadSelect`（199-215）与 prop 传递（270/279） | Picker 挂载（282-293）保留 |
| 6 | `typeahead-view.ts` | 整文件删 | |
| 7 | `AtPathTypeahead.tsx`/`SkillTypeahead.tsx`/`TypeaheadList.tsx` | 整文件删（全仓仅 PromptEditorScreen 消费） | desktop 同名组件为独立实现，不受影响 |
| 8 | `PromptEditorScreen.tsx` | 删 imports（55-59/61）、`skillRows`/`typeaheadRows` state（130-132）、`atQueryActive`/`skillQueryActive`（143-144）、候选 effect（147-204）、过滤派生（206-222）、`applyTypeaheadToken`/`applySkillTypeaheadToken`（234-256）、`typeaheadDock` JSX（404-416）、`styles.typeaheadDock`（478-485）；`canTypeahead`（136-137）收窄为 Picker 判据；头注释（13-23）改写 | `findActiveAtQuery`（Picker 半截替换 258-268 依赖）、`buildTokenInsertion`、`onSelectionChange`/`cursor`（284-286）、Picker 按钮与挂载（417-471）保留 |
| 9 | `skill-typeahead-filter.ts` | 整文件删（与 #6 同批） | |
| 10 | `RichDocumentWebView.tsx` | A：WebView style（372）加 `backgroundColor: tokens.background`；B：新增 `injectedJavaScriptBeforeContentLoaded` + 模块级 `buildThemeInjectScript` | |
| 11 | `CodeEditorWebView.tsx` | 同构 A+B（建议项） | |
| 12 | 测试 6 文件 | 见最终项目结构 | |

## 详细实现步骤

**执行环境**：新建迭代 worktree 分支（仓库纪律：不得直接改主仓工作区）；实现完成后按惯例回主仓补 CHANGELOG 条目（提交由用户决定）。

- Step 1 — phase-typeahead-remove — blocking: yes — qa: auto：主输入框链移除（变更点 #1-#6）：`NativeChatComposer` 浮层/镜像 state/props、controller memo/候选源/state 字段、Bridge 类型、dock 样式、`typeahead-view.ts` 整删；`handleSelectionChange` 转发与插入链保留。
- Step 2 — phase-typeahead-remove — blocking: yes — qa: auto：全屏编辑屏链移除（变更点 #7-#9）：三组件整删、`PromptEditorScreen` typeahead 链删与 `canTypeahead` 收窄、`skill-typeahead-filter.ts` 同批整删、头注释与 `navigation/types.ts`/`ChatTabScreen` 注释同步；Picker 链与 `findActiveAtQuery` 计算保留。
- Step 3 — phase-typeahead-remove — blocking: yes — qa: auto：测试收口（变更点 #12 前六项）：删 `typeahead-view.test.ts`/`skill-typeahead-filter.test.ts`；改 `native-composer-dock.test.tsx`（T-NC8/T-NC10 与 `TYPEAHEAD_LIMIT` import/renderDock 默认 props）、`use-chat-composer-controller.test.tsx`、`chat-conversation-panel.integration.test.tsx`、`prompt-editor-screen.test.tsx`（仅删 typeahead 用例 541-577；Picker 用例 647-713 与 mock 底座保留）；`apps/mobile` jest 全量绿（`--maxWorkers=2`，RULE：满负载假红规避）。
- Step 4 — phase-typeahead-remove — blocking: no — qa: manual_user：真机回归整链：picker 插入 skill/文件 → 胶囊落、无浮层 → 继续打字 → 发送（附件正常）；全屏编辑屏同链 + 保存回填；主输入框打 `@`/`$` 确认无任何浮层/反馈。
- Step 5 — phase-preview-flash — blocking: yes — qa: auto：`RichDocumentWebView` A+B（变更点 #10）：style 底色（token 口径见总体方案）+ `buildThemeInjectScript` 纯函数与注入 prop。
- Step 6 — phase-preview-flash — blocking: yes — qa: auto：A+B 单测：`rich-document-webview-annotate-menu.test.tsx` 现有 `mockWebViewProps` 捕获面加断言（T-PF1/T-PF2）。
- Step 7 — phase-preview-flash — blocking: no — qa: auto：`CodeEditorWebView` 同构 A+B（变更点 #11，建议项）+ `code-editor-webview.test.tsx` 同构断言；若用户确认不做则跳过。
- Step 8 — phase-preview-flash — blocking: no — qa: manual_user：真机暗色验收：进 markdown 文件预览录屏（进屏首帧无白闪；重进/换文件 `key={path}` 重挂路径覆盖）；顺带核对 `PromptEditorScreen` 预览入口。**退出预览返回白闪不在本修复验收范围**（cr2-G-1 另案）。

## 测试策略

- 单元/组件层（jest，`apps/mobile`）：浮层「不存在」断言（render 后 `queryByTestId('composer-typeahead')` 为 null、打 `@`/`$` 也不出现）；Picker 回归断言（按钮点击开 Picker、插入后 token 落文）防误删；A+B 为纯 prop 断言（style 含 token 底色；注入串含 `--bg` 与当前主题值、IIFE 结构与 null 防护）。
- 不新增 e2e（现有 e2e 无 PromptEditor/typeahead 覆盖）；真机链路走 manual_user（Step 4/8）。
- 全量门：`apps/mobile` jest 全量（`--maxWorkers=2`）+ `npx tsc --noEmit`（mobile 工程若有）双绿。

### 测试用例

- T-TR1 — blocking: yes — 主输入框打 `$`/`@` 与插入后均不渲染 `composer-typeahead`（改自 T-NC8 段）→ Step 1/3
- T-TR2 — blocking: yes — controller 候选源 describe 删除、`composerState.typeahead` 断言清理后 `use-chat-composer-controller.test.tsx` 绿 → Step 1/3
- T-TR3 — blocking: yes — 全屏编辑屏无浮层渲染、候选源 effect 移除后 `prompt-editor-screen.test.tsx` 绿 → Step 2/3
- T-TR4 — blocking: yes — 两屏 `@`/`$` 按钮与 Picker 插入链回归（capsule/B-4、capsule/G-3 既有用例保持绿，防误删红线）→ Step 2/3
- T-TR5 — blocking: yes — `typeahead-view.ts`/`skill-typeahead-filter.ts` 及其测试文件物理删除后全量套件绿 → Step 3
- T-TR6 — blocking: no — 真机整链回归（picker→打字→发送；全屏编辑保存回填）→ Step 4
- T-PF1 — blocking: yes — `RichDocumentWebView` WebView style 含 `backgroundColor: tokens.background`（mock useTheme 断言）→ Step 5/6
- T-PF2 — blocking: yes — 注入串含 `--bg` 与当前主题值；IIFE + `document.documentElement` null 防护结构 → Step 5/6
- T-PF3 — blocking: no — `CodeEditorWebView` 同构两 prop 断言 → Step 7
- T-PF4 — blocking: no — 真机暗色录屏验收（进屏/重进/换文件无白闪）→ Step 8

## 风险与回滚方案

- **风险 1｜删除面误伤 Picker 链**：`prompt-editor-screen.test.tsx` 的 mock 底座（`mockEffectiveSkills`/`mockRuntime`）被 Picker 用例共用，清理时勿一刀切；主输入框 controller 的 `findActiveAtQuery` import 若 Picker 半截替换仍消费则保留（实现时以符号级 grep 复核，两轮报告未覆盖主输入框侧 Picker 的半截替换细节）。
- **风险 2｜镜像 state 残留死代码**：`composerText`/`selectionStart` 删除后须确认无其他读者（controller 转发、草稿水化链不动）。
- **风险 3｜Android 注入时机弱于 iOS**：B 在 Android 是 `onPageStarted` 异步注入，理论存在极窄 CSS 白窗；A 已把原生窗底堵成主题色，双保险可接受。若真机仍见极短白帧，回退/增强方向为 C 方案（透明底模式，需 web 重建，非本轮）。
- **风险 4｜`--bg` 字面量双写漂移**：B 脚本镜像 `THEME_VARS` 映射，未来改映射表不会报错——注释点名渊源 + T-PF2 锁当前值。
- **回滚**：纯 UI/prop 改动、零数据面、零 web 资产变更——迭代分支单 `git revert` 即整体回滚；A/B 两 prop 独立可单独回退。
- **明确不在验收范围**（防误判）：退出预览返回白闪（cr2-G-1）、picker 插入后继续打字首字符紧贴胶囊（尾空格库层问题）。

## Context Bundle

```yaml
iteration_name: composer-typeahead-remove-preview-flash-2026-10
requirement_path: 用户口述（docs/Iterations/composer-typeahead-remove-preview-flash-2026-10/prd.md）
spec_path: docs/Iterations/composer-typeahead-remove-preview-flash-2026-10/spec.md
explore_summary: 三轮 brain-storm 根因调研 + 两轮 spec 补充探索（全屏编辑屏移除面 / 白闪 A+B 落点），机制链实锤至库原生层
impact_files: [NativeChatComposer.tsx, useChatComposerController.ts, ChatConversationBridge.ts, ChatConversationPanel.tsx, dock-style.ts, typeahead-view.ts(删), AtPathTypeahead.tsx(删), SkillTypeahead.tsx(删), TypeaheadList.tsx(删), skill-typeahead-filter.ts(删), PromptEditorScreen.tsx, RichDocumentWebView.tsx, CodeEditorWebView.tsx(建议), 测试6文件]
constraints: [保留 Picker/按钮/core 纯函数/插入链红线, tokens.background 非 surface(RULE#17), 不动 src/web/**, worktree 分支执行, jest --maxWorkers=2]
blocking_steps: [1, 2, 3, 5, 6]
```

## 补篇：C′+E 增强（2026-10-18 拍板）

> A+B（变更点 #10）已落 `6a262ad52`，用户真机测试**仍闪**——B 在 Android 上输给了首绘，本补篇为升级方案；既有章节内容不改写，以本节为准（含对既有「不动 `src/web/**`」约束的例外：允许改 `rich-document/index.html`）。

### 根因（实证）

- Android 上 B（`injectedJavaScriptBeforeContentLoaded`）的实现是 `onPageStarted` 里异步 `evaluateJavascript`（react-native-webview #3377/#1609）；本地 `file://` 页首绘只要几毫秒，注入输给首绘。
- 首绘帧画的是 `src/web/rich-document/styles/document.css` 里 `html,body { background: var(--bg, #fff) }` 的**白色兜底**，盖在 A 的深色原生底之上——A 堵的是原生控件层，堵不到 CSS 首绘层。

### C′：head 内联 bootstrap + URI 参数（确定性通道）

- `index.html` `<head>` 在 stylesheet `<link>` **之前**加同步内联 script：从 `location.search + location.hash` 匹配 `bg=` 参数，`decodeURIComponent` 后写 `document.documentElement.style.setProperty('--bg', ...)`。内联 head 脚本在解析期同步执行、物理上先于首绘，零竞态。
- RN 侧 `RichDocumentWebView` 的 `source.uri` 追加 `?bg=<encodeURIComponent(tokens.background)>`。
- B **保留不动**（iOS 的主通道 + Android 双保险）；二者写同节点同属性同值，覆盖无冲突。

### E：ready 前遮罩层

- `webReady` 为 false 期间，wrapper View 内 WebView 之上渲染 `StyleSheet.absoluteFill` 纯色 View（`backgroundColor: tokens.background`，`pointerEvents="none"`）；收到 web `ready` 消息（现有 handleMessage 已 `setWebReady(true)`）后不再渲染。无动画、无 spinner。
- 作用：通杀任何残余首帧白（CSS 兜底 / 内核合成 / 窗口层）；上层 `key={path}` 重挂时遮罩随之重新盖起，属预期。

### 变更点（续 #12）

| # | 文件 | 改动 | 备注 |
|---|------|------|------|
| 13 | `src/web/rich-document/index.html` | `<head>` stylesheet 前插入同步内联 bootstrap script（带中文注释） | 动 web 资产，须重建产物（`build:webview:native`） |
| 14 | `RichDocumentWebView.tsx` | `source.uri` 追加 `?bg=` + `encodeURIComponent(tokens.background)`；B 保留不动 | `shouldStartLoadWithRequest` 前缀判定与 `originWhitelist` 对带 query URI 仍放行（分析+测试核对） |
| 15 | `RichDocumentWebView.tsx` | `!webReady` 时渲染 `testID="rich-document-flash-cover"` 遮罩（absoluteFill、主题底色、`pointerEvents="none"`） | ready 后摘除；`key={path}` 重挂重新生效 |

### 测试用例（续 T-PF4）

- T-PF5 — blocking: yes — `rich-document-webview-annotate-menu.test.tsx`：WebView `source.uri` 以 `?bg=` + `encodeURIComponent(tokens.background)` 结尾（mock 断言，同 T-PF1 口径排除 surface）→ 变更点 #14
- T-PF6 — blocking: yes — 同文件：初始渲染存在 `rich-document-flash-cover` 遮罩（底色为 tokens.background）；模拟 web 发 `ready` 消息后遮罩消失 → 变更点 #15

### 风险

- **iOS `file://` query 丢弃**：若 iOS WebView 丢弃 URI query，C′ 失效——由 B（iOS 走 AtDocumentStart 同步注入，本就在首绘前）兜底；E 再把任何缝隙盖上。
- **动 web 资产需全链重建**：index.html 属 web 资产，构建产出（webview-dist + android assets + ios WebViewDist 三根）必须重建，否则真机跑的是旧 `index.html`；jest 的 webview-asset-guard 也会核对三根产物。
- **颜色口径**：C′/E 一律 `tokens.background`（RULE #17），严禁 surface。

## 补篇 2：fix-D（2026-10-18 二轮取证后）

> C′+E（补篇 1，commit `67b49c1a6`）真机验收**仍闪**；用户完成二轮取证（scrcpy 录屏 + ffmpeg signalstats 逐帧量化），根因改判，本补篇为修正轮方案。补篇 1 中仍有效的内容：rich-document 的 E 遮罩保留不动；其余按本节执行。

### 根因改判（2026-10-18，已定案）

- 白闪 = **会话屏消息内容区（y670-1670）近白 228/255、持续 ~350-400ms**，顶栏/页签/底栏深色不变；闪帧里会话 chrome 全在、消息区空白。
- 定性：**chat-transcript 宿主 webview（`ChatConversationWebView`）冷挂载白窗**——它只有 A（style 底色），source 是裸 `getChatTranscriptUri()`，无 B/C′/E。白窗 = 页面 CSS `var(--bg,#fff)` 兜底从首绘持续到 ready→init→applyHostTheme 完成。「msg 列表加载更是」「退出预览返白（cr2-G-1）」同在这条链上。
- 另一处隐患修正：file:// + query 在部分 WebView 实现会被丢弃 → C′ 参数形态从 `?bg=` 改 **`#bg=`**（hash 全平台保留）；bootstrap 脚本本就同时解析 search+hash，web 侧解析逻辑无需改。
- 无关层（已排除）：DayNight 窗口层（RN 各根容器已有 tokens.background：ChatTabScreen:208、根栈 contentStyle:216）、原生转场动画。

### fix-D 变更点（续 #15）

| # | 文件 | 改动 | 备注 |
|---|------|------|------|
| 16 | `src/web/chat-transcript/index.html` | head stylesheet 前插入同步内联 bootstrap（search+hash 解析，写 `--bg`） | 会话屏白窗的确定性堵法 |
| 17 | `ChatConversationWebView.tsx` | source 追加 `#bg=` + `encodeURIComponent(tokens.background)`；新增 B（`injectedJavaScriptBeforeContentLoaded`，用共享 `buildThemeInjectScript`） | `onShouldStartLoadWithRequest` 前缀判定/originWhitelist 核对通过（prefix + scheme 不变） |
| 18 | `src/web/code-editor/index.html` | 同款 bootstrap，**同时写 `--bg` 与 `--editor-bg`（同值）** | editor.css 背景 `var(--editor-bg, var(--bg, #fff))`；映射真源 host-theme.ts `THEME_VARS`（background→--bg）+ code-editor `runtime/theme.ts` `extraVars.background=['--editor-bg']` |
| 19 | `CodeEditorWebView.tsx` | source 追加 `#bg=`；本地 `buildThemeInjectScript` 改共享导入（B 原已有） | 与 rich-document 同构 |
| 20 | `src/webview-host/webview-theme-inject.ts`（新） | `buildThemeInjectScript` 单源化（rich-document / chat-transcript / code-editor 三宿主共用） | fix-D 前是两份同构镜像 |
| 21 | `RichDocumentWebView.tsx` | source 参数 `?bg=` → `#bg=`（T-PF5 同步更新）；E 遮罩保留不动 | C′ 生效后页面首帧即深色，E 只剩兜底 |
| — | composer-input | 不动 | composer 已原生化，该包已退役挂载 |

### 测试用例（续 T-PF6）

- T-PF7 — blocking: yes — 三宿主 source 均带 `#bg=` + `encodeURIComponent(tokens.background)`；chat-transcript / code-editor 的 B 注入存在（`webview-uri-load.test.tsx` props 矩阵；chat 侧另有 `chat-conversation-webview.test.tsx` 同步断言）
- T-PF8 — blocking: yes — 三包 dist `index.html` 内联 bootstrap 物理先于 stylesheet、search+hash 双形态；code-editor 双变量（`--bg` + `--editor-bg`）（三个 boot-script 契约测各一条）

### 风险

- **hash 保留性**：hash 全平台保留（本改动理由）；若某平台连 hash 都丢，B 仍在兜底、rich-document 的 E 仍盖底。
- **动 web 资产需全链重建**：chat-transcript / code-editor / rich-document 三个 index.html 均属 web 资产，三根产物必须重建（同补篇 1 风险，已按 `build:webview:native` 执行）。
- **颜色口径**：一律 `tokens.background`（RULE #17），严禁 surface。

## 补篇 3：fix-E（2026-10-18 三轮取证：转场混合白帧）

> fix-D（`3c8a89c80`）后用户复测：md 预览进/退仍有「一帧」白闪。第三轮取证定位到 native-stack 转场混合层，本补篇为 **JS-only** 修正轮（不涉 webview 资产、不动 gradle）。

### 根因（2026-10-18 三轮取证，已定案）

- 5 轮进/退循环录屏 + 逐帧跳变检测（阈值 |ΔYAVG|>15，此前 >100 绝对阈值漏掉了它）：**进预览 3-4 帧整屏均匀抬亮（全帧均值 92-94）**、退预览 2 帧较轻（51-62）；列条带与行条带量化均为全屏均匀、无亮竖条。
- 定性：native-stack 转场对新屏做 alpha 过渡，混合底是 ScreenStack 容器——`@react-navigation/native-stack` v7.16 的 `<ScreenStack style={styles.container}>` 只有 `flex:1`（透明），往下透过 RN 根直到窗口背景 = AppTheme DayNight（系统浅色→白）。深色屏对白底 alpha 混合 = 均匀灰白帧。
- 官方依据：`react-native-screens` 4.25 `ScreenStackViewManager.kt:85-87` 注释——Android 上 ScreenStack 即容器，其 `style.backgroundColor` 等价 `nativeContainerBackgroundColor`；但 @react-navigation 未透传该 style，故走容器外衬底色方案。

### fix-E 变更点（续 #21）

| # | 文件 | 改动 | 备注 |
|---|------|------|------|
| 22 | `src/navigation/RootNavigator.tsx` | NavigationContainer 外包一层 `navHost` View（`flex:1` + `backgroundColor: tokens.background`） | 主修：ScreenStack 容器透明，转场混合底变主题色；只包 NavigationContainer（HeaderProvider 在其内，不动） |
| 23 | 同文件 | NavigationContainer 加 `theme` prop：spread（`mode==='dark' ? DarkTheme : DefaultTheme`）+ 覆写 `colors.background = tokens.background` | 次修（防御）——ThemeProvider 暴露 `mode: 'light'\|'dark'`，此项**已做成** |
| 24 | `src/navigation/StackScreenLayout.tsx` | 屏根 View 加 `backgroundColor: tokens.background`（引 useTheme） | 防御：每屏 RN 根不透明，双保险 |

### 风险

- **透明 modal/overlay 不受影响**：包的是 NavigationContainer 外衬层，容器内部的透明层（modal/header 等）语义不变。
- 纯 JS 改动：metro 热更即生效，不涉 webview 资产与 gradle（commit 即可真机复测）。

> **CR 轮修补记录**（2026-10-18）：本迭代 CR（fix-spec round2）8 条 P2 全零行为面修补落地——注释/措辞 7 条 + 导航转场白闪防线回归测 1 条（T-PF9/T-PF10，`apps/mobile/__tests__/navigation-flash-fix.test.tsx`）；逐条改法与验收见 `docs/Iterations/composer-typeahead-remove-preview-flash-2026-10/cr-fix-spec.md`。K 节（CHANGELOG 条目 / lint-format / 本行）随修补轮闭合。
