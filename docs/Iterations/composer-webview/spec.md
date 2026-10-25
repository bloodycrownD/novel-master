---
date: 2026-09-29
---

# 移动端输入框 WebView 化 技术规格（SPEC）

需求来源：`docs/Iterations/composer-webview/prd.md`（用户口述 2026-09-29 拍板 + 同日两轮补充：键盘高低版本约束、宏链一并迁移与 chat 全屏编辑）。前置依赖 PRD：`docs/Iterations/composer-overlay/prd.md`（overlay 终态的行为验收口径）。

## 设计目标

按 PRD 五目标落地：根治滚动分层（单引擎）、不回归打字闪/回车闪、两条输入链对外契约零变更、键盘链路兼容高低版本安卓、chat 全屏编辑。行为底线：composer-overlay 已达成的 A1–A7 验收口径全部保持；IME 组合态不丢字（1.5.9 底线）、打字不降级 tag（1.5.10 底线）以 jest 组合态序列继续守护。

## 基线与分支

- **基线**：main @ `dbd6789b`（v1.5.26 已发布代码，发版后仅 docs 变更）——**用户拍板（2026-09-29 第三轮）**：overlay 是未修好的中间态、其组件实现将被整体替换，不合入不继承，基线取已发布实现，git 历史只含本次真实变更；回滚锚点即 main（webview 不合入，main 保持现状）。
- **分支**：worktree `D:\Dev\nm-worktree\composer-overlay` 内 `git checkout -b feat/composer-webview main`（main 已被主仓 worktree 占用，不能直接 checkout，拉新分支不冲突；切换前 `git status` 确认 worktree 干净，切换后 `npm install` 对齐依赖——main 仍依赖 `react-native-controlled-mentions`，overlay 分支的 lockfile 没有它）。
- **从 overlay 分支 cherry-pick 的纯函数资产**（5dfbf87f，带各自测试，否则需新写）：
  - `apps/mobile/src/components/chat/composer-highlight.ts` + `__tests__/composer-highlight.test.ts`（`splitComposerTokenSegments` / `composerTokenRanges`，main 无此文件）
  - `apps/mobile/src/components/common/atomic-range-delete.ts` + `__tests__/atomic-range-delete.test.ts`（`tryAtomicRangeDelete` 泛化版；main 的 `prompt-macro-input.ts` 是区间内建版 `tryAtomicMacroDelete`，保持不动即可——web bundle 用泛化版 + `findWhitelistMacroRanges`（main 已有））
  - `apps/mobile/src/components/chat/composer-token-insert.ts`（`buildTokenInsertion`；实现时核对 main 是否已有同名实现，有则复用不摘）
  - **不摘**：`OverlayTextInputStack`、主从反转/DOM 前后位、overlay 版 `PromptMacroTextInput`、`replaceCommittedText` 契约改造——组件全部基于 main 版直接重写为 webview 宿主壳。
- **随基线并入本迭代的原 overlay 变更**（webview 架构天然绕不开）：ChatComposer typeahead 单路径化（`replaceActiveAt` 分支删除，点选统一 `replaceCommittedText`）；`react-native-controlled-mentions` 依赖摘除；main 的 children span 断言测试体系（`hasMentionSpan`/markup 对账）换成桥协议断言。
- `feat/composer-overlay` 分支长期保留（纯函数 cherry-pick 源 + 打字闪诊断历史 + 「胶囊-only overlay / 纯色字」备选实验线），不参与合并。
- **范围**：chat 链 + 宏链一起迁（单包双模式，见下）；chat 全屏编辑新增；宏链既有全屏（ExpandablePromptInput ⛶ → PromptEditorScreen/CodeEditorWebView）不动。迁移完成后 `react-native-controlled-mentions` 依赖与 main 版两个输入组件的旧实现一并移除（overlay 双层 `overlay-input.tsx` 仅存在于 overlay 分支，main 无需清理）。

## 总体方案

**架构**：把「透明 TextInput + RN 高亮层」换成「WebView 内单引擎 overlay」——web 侧是桌面同构的 `透明 textarea（absolute 上层）+ 高亮层 div（流内定尺寸）`，高亮渲染、滚动同步、高度测量全部发生在同一浏览器引擎内（桌面已长期运行验证）；RN 侧是**一个可复用的通用宿主** + 两条链各自的薄壳。

```
ComposerInputWebView（新增：通用 WebView 宿主，两处复用）
  props: mode（'composer-token' | 'prompt-macro'）, value, onChangeText, onSelectionChange,
         metrics, theme, placeholder, selection?, testID
         【修订 2026-09-30 CR】onHeight 已删（容器高度宿主自管、无外部消费方）；
         原「onBlurRequest prop」落地为 handle.blur()（imperative，当前无调用方，留作发送后收键盘等未来需求）
  ├─ chat 内联：ComposerAtPathInput（壳，props 面不变）      mode=composer-token
  └─ 宏内联：  PromptMacroTextInput（壳，props 面不变）      mode=prompt-macro（chips/表单外壳仍是 RN）
      【修订 2026-09-29】原第三处消费方「chat 全屏屏」已删（全屏改走 PromptEditor/CodeEditorWebView）；
      maxHeight=null 不限高分支保留为协议能力，当前无生产消费方（勿当死代码删）
      └─ WebView → file:///android_asset/webview/composer-input/index.html
          · 高亮层 div（流内，min/max-height 由 metrics 驱动，overflow auto）  ← 下层
          · textarea（absolute inset:0，color transparent，caret-color 显式）    ← 上层
          · 滚动同步 = 同引擎 DOM 属性赋值（hl.scrollTop = ta.scrollTop），零跨引擎时序差
          · 高度自适应 = web 内测量 scrollHeight → heightChange 上报 → RN 容器高度跟随
```

### 核心决策（均有探索证据）

1. **复用 code-editor 的受控桥模式**（`CodeEditorWebView.tsx` + `web/code-editor/webview/runtime/editor.ts`，仓库唯一「可编辑 WebView」生产先例）：
   - **web 自持真源**：打字时 web 侧 input 事件 → 原子删拦截 → `post('change', {text})` 上报；RN 收 change 只更新 state/草稿，**不回写 setText**——不存在「回写打断 IME composition」路径（v1.5.9 的 WebView 版防线）。
   - **setText 仅外部变化下发**：草稿水化、typeahead 点选（`replaceCommittedText`）、chips 插入（宏链 `insertTextAtSelection`）、发送清空；web 侧 `suppressChange` 包裹 + 内容相同短路（照抄 `suppressChange` 先例）防回环。
   - 焦点策略：用户触摸 WebView 直达 web DOM 聚焦（code-editor 已验证，`keyboardDisplayRequiresUserAction={false}`）；**不做程序化 focus**（react-native-webview#1172：Android 程序化 focus 不弹键盘；两链现状均无 `.focus()` 调用，规避该坑）。发送后不 blur，焦点自然保持。
2. **单包双模式**：一个 webview 包，`init.mode` 决定高亮分段来源——`composer-token` 用 `splitComposerTokenSegments`（`@/components/chat/composer-highlight`）、`prompt-macro` 用 `findWhitelistMacroRanges`（`@/components/agent/prompt-macro-input`）。RN 侧纯函数进 web bundle 的机制已配好（`build-webview.mjs` 的 webAlias 与 `src/web/tsconfig.json` paths 均含 `@`；既有先例：web 目录相对路径引 `webview-host` 纯函数（`snapshot.ts`/`menu.ts`）与 `@novel-master/core/chat` 直接进 bundle（`row-logic.ts`））。两套纯函数依赖极轻（后者仅 import core 白名单常量），打进同一 bundle 体积可忽略。**RN 侧纯函数 import 路径全部不动、既有测试零改动**（单源复用的直接验证）。
3. **高亮渲染桌面同构**：`renderHighlightHtml(text, mode)` = `escapeHtml` 非 token 段 + 高亮段 `<span class="composer-input__token">` + 末尾 `\n` 补 `<br/>` + 空串零宽空格兜底（桌面 `renderComposerAtPathHighlightHtml` / `renderPromptMacroHighlightHtml` 逐项照搬，双模式仅分段来源不同）。
4. **胶囊 CSS 桌面手法**：`padding: 1px 4px; margin: 0 -4px`（负 margin 抵消，光标零错位）+ `box-decoration-break: clone`（跨行胶囊两端完整）。Chromium 130+ 才支持无前缀写法，旧 WebView 降级为断口（纯视觉，风险表有预案）。
5. **原子删在 web 侧**：input 事件里 `tryAtomicRangeDelete(prev, next, ranges)`（chat 传 `composerTokenRanges(prev)`、宏传 `findWhitelistMacroRanges(prev)`）命中则改写 DOM value 并以拦截后文本上报——RN 侧零变换逻辑随架构消失（单源仍是 `common/atomic-range-delete.ts`）。
6. **高度自适应走上报**：web 侧 ResizeObserver + rAF 测量内容高度，`heightChange{height}` 上报，RN 容器按 metrics 的 minHeight/maxHeight clamp 跟随；封顶后 textarea 自身 `overflow: auto` 内滚。全屏模式 metrics 下发 `maxHeight: null`（css `max-height: none`，容器 flex:1 全高）。高度所有权在 web 引擎内（同引擎重排无 RN overlay「主从反转」要解决的时序差问题）。
7. **键盘链路零新增**（用户补充约束的落点）：现状范式 A —— `KeyboardProvider` → `useReanimatedKeyboardAnimation` → 聊天页 `AndroidKeyboardClipBody` / 表单页 `AndroidKeyboardFormBody`（ScreenFormLayout）/ 编辑屏 `EditorScreenShell` + composer dock paddingBottom 归零——全部监听 window insets，**与输入框类型解耦**。高版本安卓（Android 15+，targetSdk 36 强制 edge-to-edge，Manifest `adjustResize` 不可靠——提交 5555455c/63475cd6 定案）与低版本（adjustResize 原生收缩 + insets 动画双轨并存，真机已验证无双重收缩）均无需改动。**CodeEditorWebView 已在同一 targetSdk 36 环境生产验证「WebView focus 弹 IME + ClipBody 收缩」完整链路**。**光标可见实现注（实测落位）**：web 侧用 visualViewport resize/scroll 监听 + rAF 的**保守策略**（仅在「输入区仍聚焦 + 高度刚变化 + scrollTop 被内核归零」三条件同真时复原 scrollTop，不抢内核自身的插入符可见性维护）——spike 双轨已验光标始终可见；未照搬 code-editor 的 `scrollIntoView`（textarea 无对应光标 API，强行滚动反而会打断内核行为）。
8. **chat 全屏编辑**（用户第二轮补充；**【修订 2026-09-29 真机轮反馈后】**用户四问改道：按钮风格与同排不一致 / 全屏页键盘顶起没处理 / 为何自写一套且没有预览 / 为何要保存。最终形态：**不再自写全屏屏**，改用智能体配置那套编辑屏 `PromptEditorScreen` 的 **composer 变体**——同一个 `CodeEditorWebView`，**无保存概念、退出即回填**。**【修订 2026-09-29 深夜定案】纯编辑态**：不传 toggle/segmented/preview，预览与档位条整体移除（用户原话「移除预览，这样就只有编辑模式了，这样就足够了」）。**【修订 2026-09-30 tag 胶囊】**用户拍板不换引擎，编辑区仍 `CodeEditorWebView` 但走伪路径 `composer.md` 激活胶囊扩展——@/$ tag 高亮 + CM 原生 atomicRanges 原子删 + 手输 typeahead + 底排 @/$ 选择器（与内联同源 `buildTokenInsertion`/`findActiveAtQuery`；当时「胶囊让位」的取舍由此翻页，内联与全屏两侧都有胶囊了）：
   - 入口：ChatComposer 工具栏（@/$ 同排）加 ⛶ icon。**【修订】**改与 @ / $ 同款 36 圆钮 + hairline 描边（原 28 无边框小触达，同排风格不一致——真机截图实锤），字形保留 fontSize 20；**【修订 2026-09-30 CR】scope 未就绪时经 ChatConversationPanel 传 undefined、⛶ 走既有 disabled 通路（不再是死按钮）**。
   - 全屏屏：`PromptEditor` 路由加 `variant?: 'form' | 'composer'`（缺省 form = 提示词字段原语义；composer = chat 输入框全屏，**纯编辑态**：不传 `EditorScreenShell` 的 save/toggle/segmented/preview/title，toolbar 整行不渲染——导航栏已有「编辑消息」，页内再叠即重复标题）、`useUnsavedGuard` 关闭、卸载（header 返回/手势）时以当拍草稿发回填回调。
   - 数据通道：初始文本走路由参数（纯数据，**2026-09-30 起另带 `projectId`/`sessionId`** 供 @/$ typeahead 与选择器取候选源；缺参降级——胶囊高亮仍在、插入链禁用）；回填回调沿用 `prompt-editor-callback.ts`（模块级 set/take），`composer-editor-callback.ts` 随自写屏一并删除。code-editor 桥配套两条新消息：web 上报 `selectionChange`（typeahead 判活跃查询需光标）、`setDocument` 载荷可选 `selectionStart/End`（token 插入一次落位）。
   - 导航通道照 `onOpenSessionDetail` 先例（chat-tab 零导航依赖、父层注入回调）：ChatTabScreen → ChatConversationPanel → ChatComposer 的 `onOpenComposerFullscreen` prop 链。
9. **不引框架**：composer-input webview 用纯 TS + 原生 DOM（不学 chat-transcript 上 preact）——输入框逻辑是线性 DOM 操作，bundle 更小、与桌面版心智一致。

## 桥协议（v=1，信封 `{v:1, type, payload}` 对齐三域先例）

| 方向 | 消息 | payload | 说明 |
|---|---|---|---|
| Host→Web | `init` | `{mode, disabled, theme, metrics, placeholder}` | ready 后一次；mode = `'composer-token' \| 'prompt-macro'`；disabled = 初始禁用态（chat 链 running/无模型/末条纯文本时 true；宏链只读详情 true）；metrics = `{fontSize, lineHeight, paddingH, paddingV, minHeight, maxHeight: number \| null}`（chat 56/160、宏 88/176、全屏 `null`）；theme 见下 |
| Host→Web | `themeUpdate` | `{theme}` | 亮暗切换 |
| Host→Web | `setDisabled` | `{disabled}` | 运行态切换（running 起止等）；web 侧 textarea.readOnly + 容器 opacity 0.55 灰显（对齐 FormTextInput 口径） |
| Host→Web | `setText` | `{text, selectionStart?, selectionEnd?}` | **仅外部变化**：水化 / typeahead 点选 / chips 插入 / 发送清空 / 全屏保存回填；web 侧 suppressChange 包裹 |
| Host→Web | `setSelection` | `{start, end}` | 纯光标设置（宏链 ExpandablePromptInput 挂载置顶 `{0,0}` 一拍；value 不动） |
| Host→Web | `blur` | `{}` | 照 code-editor（外部要求失焦） |
| Web→Host | `ready` | `{version}` | DOMContentLoaded 后，宿主 webReady 门控一切下行 |
| Web→Host | `change` | `{text}` | 打字/原子删后上报（web 自持真源，RN 不回写） |
| Web→Host | `selectionChange` | `{start, end}` | 驱动 typeahead 开合（宿主合成 onSelectionChange） |
| Web→Host | `focus` / `blur` | `{}` | 键盘态联动观察用 |
| Web→Host | `heightChange` | `{height}` | 内容高度（rAF 节流，>0.5px 变化才发；ready 后首发一次；全屏模式不下发或宿主忽略） |

theme 字段：`{background, text, textSecondary, primary, primaryMuted, selection}`（对齐 `TranscriptTheme` 裁剪版；胶囊 = `color: primary; background: primaryMuted`，mobile 侧 `primaryMuted = ${primary}22` 由宿主拼好下发，web 不做颜色计算）。chat 壳用 useTheme 组装、宏壳用 props.tokens 组装（现有双通道语义保留）。

禁用态职责划分：web 侧只管输入区（textarea.readOnly + 灰显，经 init.disabled / setDisabled 驱动）；宏链的 chip 禁点与灰显由 RN 壳处理（disabled 时壳直接置灰，不下发 web）；chat 链 `editable={!inputDisabled}` 传参零改动。

死消息警示：不照抄 transcript 的 `log` / `messagePatch`（全仓无生产者/消费者的声明即死先例）。

## 最终项目结构

```
apps/mobile/
  src/web/composer-input/                    [新增 webview 包]
    index.html                               （viewport user-scalable=no，短壳照 code-editor）
    styles/composer-input.css                （stack/token/textarea/placeholder/::selection）
    webview/main.ts                          （启动：桥接线 + editor 装配）
    webview/runtime/model.ts                 （消息类型 + BRIDGE_V + mode 联合）
    webview/runtime/bridge.ts                （matchHostMessage/ready 上报）
    webview/runtime/editor.ts                （textarea+高亮层 DOM、双模式分段、事件、原子删、高度上报、suppressChange）
  src/webview-host/composer-input/uri.ts     [新增]（薄包装照 code-editor/uri.ts）
  src/webview-host/webview-asset-uri.ts      [改] WebViewAssetPackageId 加 'composer-input'
  src/components/chat/
    ComposerInputWebView.tsx                 [新增] 通用 WebView 宿主（mode/metrics/selection 参数化；props 照 ChatTranscriptWebView:1810-1832 抄）
    ComposerInputBridge.ts                   [新增] 信封编解码（照 CodeEditorBridge）
    ComposerAtPathInput.tsx                  [重写] chat 壳：props 面不变，内部换 ComposerInputWebView
    ChatComposer.tsx                         [改] inputRef 清理 + ⛶ 全屏入口 + 跳转/回填接线
  src/components/agent/
    PromptMacroTextInput.tsx                  [重写] 宏壳：props 面不变（chips 行/表单外壳仍是 RN），内部换 ComposerInputWebView
  src/components/common/
    atomic-range-delete.ts                    [cherry-pick 自 overlay 分支]（web bundle 单源引用）
  src/screens/stack/
    PromptEditorScreen.tsx                   [改·修订] 加 composer 变体（原「新增 ChatComposerEditorScreen」作废，见变更点 11/12）
  src/navigation/                            [改] PromptEditor 路由加 variant 参数（路由表无新增；callback 统一 prompt-editor-callback.ts）
  scripts/build-webview.mjs                  [改] PACKAGES 加条目
  android/app/build.gradle                   [改] checkWebViewAssets packages 列表（GBK 编码，字节级替换！）
  src/web/tsconfig.json                      [改] include 加 composer-input
  __tests__/
    composer-input-bridge.test.ts            [新增]
    composer-input-dom.test.ts               [新增] renderHighlightHtml 双模式直测
    composer-input-webview.integration.test.tsx [新增] ChatComposer + mock WebView 协议测试
    composer-fullscreen.test.tsx             [新增] 全屏屏（callback 回填/拦截/进入携带文本）
    composer-highlight.test.ts               [cherry-pick 自 overlay 分支]
    atomic-range-delete.test.ts              [cherry-pick 自 overlay 分支]
    chat-composer.integration.test.tsx       [迁移] 输入驱动改消息协议（main 版 children 断言体系退役）
    composer-at-path.test.tsx                [迁移] markup 对账/hasMentionSpan 断言换协议断言；纯函数用例保留
    prompt-macro-text-input.test.tsx         [重写] 宏壳协议断言（main 版 children 守门退役）
  e2e/pageobjects/chat-transcript.page.ts    [改] composer 四方法切 WEBVIEW context
  e2e/pageobjects/app.page.ts                [改] 输入探测适配
```

不动：`prompt-macro-input.ts`（main 版 13 用例守护 `findWhitelistMacroRanges`/`tryAtomicMacroDelete`，web bundle 引 `findWhitelistMacroRanges` 即可）、`composer-token-insert.ts`（main 已有 `buildTokenInsertion`，核对后直接复用）、`ExpandablePromptInput.tsx`（renderInline ctx 的 props 面不变零适配）、`DynamicBlocksCard.tsx`、`PromptLayoutSection.tsx`（**【修订】**`PromptEditorScreen.tsx` 与其 callback **本轮有改动**——加 composer 变体共用，form 变体语义与既有断言零变化）、`AndroidKeyboardClipBody`、`ScreenFormLayout`、`EditorScreenShell`（**【修订 2026-09-30 CR 校正】**改动不止 `save`：`title`/`titleDanger`/`segmented`/`previewMode`/`preview` 五 prop 一并改可选，并加 `hasToolbar` 守卫（save/title/titlePress/toggle 全空则 toolbar 整行不渲染，toolbar View 挂 testID="editor-screen-toolbar"）；既有调用点 FileEditorScreen 恒传必填组、渲染不变）、`ChatConversationPanel`（**【修订】**scope 未就绪时 ⛶ 回调传 undefined，一行）、gradle.properties / AndroidManifest / 原生侧全部、`jest.config.js`（react-native-webview mock 映射与 `@web/*` 映射均已就位）。

## 变更点清单

| # | 文件 | 变更 |
|---|---|---|
| 1 | `src/web/composer-input/`（6 文件） | 新增包：index.html / css / main.ts / runtime 三件。editor.ts 核心：高亮层 div（流内）+ textarea（absolute、color transparent、caret-color var(--text)、fontSize 16 防 iOS 聚焦缩放）+ 双模式分段（init.mode）+ `renderHighlightHtml`（import `@/` 纯函数）+ input/select/keyup/click 事件 + `tryAtomicRangeDelete` 拦截 + onScroll scrollTop 同步（同引擎）+ ResizeObserver 高度上报（maxHeight=null 时跳过）+ suppressChange + visualViewport 光标可见（照 `bindCaretRevealOnResize`） |
| 2 | `src/webview-host/composer-input/uri.ts` + `webview-asset-uri.ts` | 新增薄包装；联合类型加 `'composer-input'` |
| 3 | `scripts/build-webview.mjs` | PACKAGES 加 composer-input（entry/css/html 三路径） |
| 4 | `android/app/build.gradle` | checkWebViewAssets packages 加 `'composer-input'`。**实测（实现轮）：该文件实为 UTF-8（非 main 时记的 GBK）**；仍按字节级替换执行（Buffer 定位拼接，非 ASCII 字节零改动，`git diff --numstat` 核对 1 行级改动） |
| 5 | `src/web/tsconfig.json` | include 按现有形态补两条：`composer-input/webview/**/*.ts` + `composer-input/webview/**/*.tsx`（进 `npm run typecheck` 链） |
| 6 | `src/components/chat/ComposerInputBridge.ts` | 信封类型（含 mode/setSelection）+ encode/decode + 校验（照 CodeEditorBridge：decode 异常静默丢弃） |
| 7 | `src/components/chat/ComposerInputWebView.tsx` | 通用宿主：webReady 门控、init（mode/disabled/metrics/theme/placeholder 组装）/themeUpdate/setText/setSelection/setDisabled/blur 下行 effect、onMessage 分发（change/selectionChange/focus/blur/heightChange → 回调）、selection 与 disabled props 受控（外部变化 → 对应消息下发）、`keyboardDisplayRequiresUserAction={false}`、`scrollEnabled={false}`、导航守卫照抄（仅放行包目录 file://） |
| 8 | `src/components/chat/ComposerAtPathInput.tsx` | 重写为 chat 壳（覆盖 main 版 controlled-mentions 实现：`useMentions`/nativeTruthRef 对账/promotePlainMentions 全链随重写消失）：props 面 `value/onChangeText/cursor/onSelectionChange/**editable**/placeholder/testID/style` 保持——**`editable` 保留**（main 的 ChatComposer:585 传 `editable={!inputDisabled}`，running/无模型/末条纯文本只读是现网行为，映射 disabled 通道：初始经 init.disabled、变化经 setDisabled）；metrics 组装 16/22/4×6/56–160（style 白名单覆盖合入）；`onSelectionChange` 合成 `{nativeEvent:{selection:{start,end}}}` 形状（ChatComposer `setCursor` 链不断裂）；ref 方法从 main 的 `replaceActiveAt` 收敛为 `replaceCommittedText(text, cursor?)` → `setText{text, selection}`（手输即时高亮后无「提升」概念，纯文本写入+光标合成，行为等价——原 overlay 变更 4 的契约演进并入）；外部 value 差分（lastValueRef）对齐光标；失效 props 仅删 `inputRef: RefObject<TextInput>` 与 `placeholderTextColor`（实现时 grep 复核无消费再删）；testID 挂 WebView 容器 View |
| 9 | `src/components/agent/PromptMacroTextInput.tsx` | 重写为宏壳：props 面 `tokens/value/onChangeText/placeholder/style/selection/onSelectionChange/**disabled**` 全保持——**`disabled` 是现网 prop**（main 版「只读详情：输入框不可编辑、宏 chip 禁点并灰显」，消费方 DynamicBlocksCard:193 / PromptLayoutSection:282 传 `disabled={readOnly}`），映射 disabled 通道（输入区 readOnly+灰显走 web，chip 禁点灰显留 RN 壳）；`selection={pendingSelection ?? selection}` 合并语义保留（合并结果 → 宿主 selection prop → setSelection 下发）；chips 行（`PROMPT_INSERTABLE_MACROS` + `insertTextAtSelection` + setPendingSelection）与表单外壳（hairline 边框/圆角 12/bgSecondary）仍是 RN 渲染；metrics 组装 16/22/14×12/88 + maxHeight 从透传 style 提取（Expandable 传 176）；chip 点击 → `setText{text, selection}` |
| 10 | `src/components/chat/ChatComposer.tsx` | 改：`replaceActiveAt` 分支删除、typeahead/选择器点选统一走 `buildTokenInsertion + replaceCommittedText` 单路径（原 overlay 变更 5 并入，护栏 T-INT）；`inputRef` 声明删除（无消费）；**`editable={!inputDisabled}` 传参零改动**（running/无模型/末条纯文本只读经 disabled 通道保持）；`onOpenComposerFullscreen` prop 新增（父层注入，见变更 12）——⛶ 按钮（testID `chat-composer-fullscreen`，触达 28×28）→ `composer-editor-callback.set`（携带当前文本与回填回调）→ `onOpenFullscreen()` 跳全屏屏；**回填实现实测**：走既有「写草稿 + draftRestoreToken」链路（与 undo_send 回滚同款草稿重读通路），光标按既有 `clamp(旧 cursor, 新长度)` 口径而非强制置末（与 main 版外部 value 差分语义一致） |
| 11 | `src/screens/stack/PromptEditorScreen.tsx` | **【修订 2026-09-29 真机轮】原「新增 ChatComposerEditorScreen」作废**（该文件已删除）：改为给既有 `PromptEditorScreen` 加 `variant`（`'form' | 'composer'`）。composer 变体 = 不传 `EditorScreenShell.save`（左位不渲染）、标题不切「未保存」（`编辑消息`，由路由 title 给出）、`useUnsavedGuard(!isComposer && isDirty)` 关闭、`useEffect` 卸载清理里 `onSavedRef.current?.(draftRef.current)` 回填。**【修订 2026-09-29 深夜】composer 变体改纯编辑态**：不传 toggle/segmented/preview/title（预览与档位条整体移除，页内 toolbar 整行不渲染）；**【修订 2026-09-30】编辑区走伪路径 `composer.md` 激活 tag 胶囊**（CodeMirror mark 装饰 + atomicRanges 原子删），并接 `$`/`@` typeahead + 底排选择器插入链（`buildTokenInsertion` 同源；cursor 初值文末、canTypeahead 含 runtime 就绪判定） |
| 12 | 导航注册 + `prompt-editor-callback.ts` + 注入链 | **【修订】**路由表不再新增全屏屏（`ChatComposerEditor` 路由、`header-config` 条目、`RootNavigator` 注册三处已摘），复用 `PromptEditor` 路由；`composer-editor-callback.ts` 已删除，回填回调统一走 `prompt-editor-callback.ts`；**导航通道照 `onOpenSessionDetail` 先例**（chat-tab 目录现状零导航依赖，惯例是父层注入回调）：`ChatTabScreen.tsx` 以 CompositeNavigationProp `navigate('PromptEditor', {title:'编辑消息', initialText, variant:'composer', projectId, sessionId})`（**2026-09-30 起带 scope 两参**供 typeahead/选择器）并在 navigate 前 `setPromptEditorOnSaved` 注入回填（写草稿 + bump draftRestoreToken） → `ChatConversationPanel.tsx` 透传（**scope 未就绪传 undefined，⛶ 走 disabled**） → `ChatComposer.tsx` 消费（变更 10 的 `onOpenFullscreen` prop） |
| 13 | `e2e/pageobjects/chat-transcript.page.ts` | `sendComposerMessage/setComposerText/getComposerText/expectComposerText` 四方法：`switchToWebView()` 后 `$('textarea[data-testid="composer-input"]')`；**受控 textarea 坑：setValue 走 `browser.execute` 用 native value setter + dispatch input 事件**；结束 `switchToNative()` |
| 14 | `e2e/pageobjects/app.page.ts` | `byTestId('chat-composer-input')` 探测目标改为 WebView 容器 View（RN testID 落 resource-id，容器仍可探）。注记：探测语义退化为存在性（View 无 disabled 概念、isEnabled 恒 true）——原「enabled 才可用」判定若被后续 e2e 复用，移到 WEBVIEW context 内断言 textarea readOnly；现状该探测仅作存在性用，不扩面 |
| 15 | `__tests__/composer-input-bridge.test.ts` | 编解码全消息（含 mode/setSelection）+ 坏信封丢弃（照 chat-transcript-bridge.test.ts） |
| 16 | `__tests__/composer-input-dom.test.ts` | `renderHighlightHtml` 双模式直测（escapeHtml/token 与宏 span/尾\n补br/零宽空格/未闭合宏不高亮）——经 `@/` 或 `@web/` 映射直测源码；**勿用源码文本 readFileSync 断言**（CRLF 红灯） |
| 17 | `__tests__/composer-input-webview.test.tsx`（实测落位，原稿 integration 后缀未采用） | ChatComposer + mock WebView：`simulateWebMessage`（change/selectionChange/heightChange/ready）+ `mockWebViewPostMessages` 断言（init/setText/setSelection 序列）；宿主契约 T-HOST1..6（+附加 T-HOST7/8）；**T-CR4①②/T-INT/T-IME 实测落在 19 号文件**（chat 链集成处，内容与矩阵一致） |
| 18 | `__tests__/composer-fullscreen.test.tsx` | **【修订 2026-09-29 真机轮】重写**：T-FS1 ⛶ 存在 + **与 @/$ 同款圆钮**（flatten 样式逐项相等断言）；T-FS2 点 ⛶ 跳 `PromptEditor` 且参数为 `{title:'编辑消息', initialText, variant:'composer', projectId, sessionId}` 纯数据；T-FS3 退出回填（调 take 出的回调 → 草稿 store 更新 + bump 令牌 → ChatComposer 经 `setText` 桥消息回填）。原「屏内保存/未保存拦截/init metrics 全高」三例随自写屏删除，屏内断言迁至 `prompt-editor-screen.test.tsx` 的新 describe（composer 变体：无保存按钮、标题不显未保存、退出即回填、**纯编辑态无预览/档位**、回调缺失不抛错；2026-09-30 起另有 tag 插入链与降级用例） |
| 19 | `__tests__/chat-composer.integration.test.tsx` | `findNativeComposerInput`/`composerChildrenPartTexts` 退役 → 改 `simulateWebMessage('change')` 驱动 + 桥消息断言；与输入无关的用例（发送门闩/终止/事件收尾）骨架保留 |
| 20 | `__tests__/composer-at-path.test.tsx` | main 版迁移：删 `react-native-controlled-mentions` import 与 children span 断言面（`hasMentionSpan`/`formatAtPathMentionMarkup` markup 对账/`promotePlainMentions`/T-AT1/T-AT2b 短路）；v1.5.9 IME 用例断言面改桥协议（change 消息序列）；main 版 T-SC1（断言面是 `selectionColor`，随 TextInput 消失）改写为宿主 init.theme.selection 载荷断言；core 纯函数用例（`findActiveAtQuery`/`filterAtPathTypeaheadCandidates` 等）保留；组件层交互用例并入 17 号文件 |
| 21 | `__tests__/prompt-macro-text-input.test.tsx` | 重写为宏壳协议断言（main 版仅 1 例「value+children 不变量」，随重写退役）：value 直控不抛；init mode/disabled/metrics 载荷（maxHeight 176 提取）；chips 点击 → setText 带光标；**disabled=true → init.disabled/setDisabled 下发 + chips 灰显断言（RN 侧）**；外部 `selection={0,0}` 一拍 → setSelection 消息；表单外壳样式断言**新写**（main 版无存量外壳断言） |
| 22 | `apps/mobile/package.json` + 根 lockfile + `composer-at-path-mention.ts` | `react-native-controlled-mentions` 依赖移除（原 overlay 变更 9 并入：import 级引用仅输入组件文件，全在本迭代改动面内）；main 的 `composer-at-path-mention.ts`（markup 解析层，8 值导出 + 2 type 导出的 src 消费方全在 ComposerAtPathInput 内——overlay 探索实证）整文件删除并清 `composer-at-path.ts:3` 头注释指向；全仓 grep 残留引用为零 + `npx knip` 复核（非门禁，记录结果） |
| 23 | `CHANGELOG.md` | Unreleased 补条目（输入框 WebView 化、滚动分层根治、宏链同迁、chat 全屏编辑） |

## 详细实现步骤

- Step 1 — phase-webview-spike — blocking: yes — qa: manual_user：**分支初始化**（worktree `git status` 确认干净 → `git checkout -b feat/composer-webview main` → 拉纯函数资产（`git checkout feat/composer-overlay -- composer-highlight.ts/atomic-range-delete.ts 及测试`；composer-token-insert main 已有不拉）→ `npm install` 对齐依赖 → typecheck 过）后做 spike。临时调试入口不入 PR（建议 WebView `source={{html}}` 内联 HTML 绕开构建链，Metro reload 即生效），结论落 `docs/Iterations/composer-webview/spike-notes.md`。五点验证，**高低版本安卓均用模拟器（用户拍板 2026-09-29：迭代内验证环境统一，真机验收挪至开发完成后）——高版本 Medium_Phone_API_36.1、低版本 API <35 的 AVD（现有清单没有则 `avdmanager create` 创建）双轨各一轮**：① 键盘链路——textarea 聚焦弹键盘、`AndroidKeyboardClipBody` 收缩正确、**专项检查社区 issue react-native-webview#3848 症状**（键盘弹出时 webview 内容整体上滚不可见；出现则试 visualViewport 校正 scrollTop / 容器动画参数两档缓解并记录效果）；② 高度上报自增高（56→160 封顶内滚，heightChange 节流无抖动）；③ visualViewport 光标可见（多行长文键盘弹起时光标在视口）；④ IME 组合态（模拟器 `adb input` 绕过 IME 无法构造组合态——overlay spike 已定性，本轮只验基础输入链路，组合态由 T-IME jest 序列先行守护 + 开发完成后真机观察）；⑤ 快速滚动 + 输入，高亮与文字零错位（方案收益自证）。spike 不过（缓解无效）→ 迭代终止归档，main 保持已发布现状。
- Step 2 — phase-composer-web-package — blocking: yes — qa: auto：变更 2/3/4/5（包骨架 + 四处注册）+ 变更 6/15（桥类型与编解码测试）；`npm run build:webview` 产物流通 + `npm run typecheck` 过。
- Step 3 — phase-composer-web-editor — blocking: yes — qa: auto：变更 1（web 侧编辑器全量：DOM、双模式分段、事件、原子删、高度上报、suppressChange、光标可见）+ 变更 16（web 纯函数直测）；dist 契约测可选（若做，用引号容忍正则断言 dist 产物而非源码文本）。
- Step 4 — phase-composer-host — blocking: yes — qa: auto：变更 7/8（通用宿主 + chat 壳）+ 宿主层组件测试（props 契约、onSelectionChange 合成形状、replaceCommittedText→setText 序列）。
- Step 5 — phase-composer-macro — blocking: yes — qa: auto（+ 模拟器内存实测）：变更 9/21（宏壳重写 + T-MAC 协议版）；**模拟器实测 agent 配置页多宏输入字段（动态块 ≥3）同屏多 WebView 实例的内存与表单滚动流畅度**，实测结论记入 cache；不可接受 → 触发风险表「宏链退 overlay」预案。
- Step 6 — phase-composer-fullscreen — blocking: yes — qa: auto：变更 10/11/12/18（⛶ 入口 + 全屏屏 + 路由 + callback + T-FS）。（与 Step 5 互不依赖，code-dev-loop 可并行波次）
- Step 7 — phase-composer-integration — blocking: yes — qa: auto：变更 17/19/20（集成测试迁移）+ 变更 22（依赖移除 + `composer-at-path-mention.ts` 删除 + grep 清残留）+ `npm run typecheck` + jest 全量（基线：**主仓口径 main 1577/1577 全绿**（v1.5.26 发版记录）；worktree 跑若现 8 个 CRLF 环境性红灯套件（mermaid/rich-document/boot-script/code-copy 族），按 RULE 既有定性（工作区归一化 LF）处理，不计回归；新增用例计入净增）。
- Step 8 — phase-composer-e2e — blocking: no — qa: auto：变更 13/14（e2e pageobject 改造）+ `npm run e2e:tsc`。e2e 实跑不作为门禁（现状 e2e 页对象与 UI 多处脱节、fixture 配置结构性跑不了，只保证编译与选择器逻辑正确，实跑另排）。
- Step 9 — phase-composer-verify — blocking: yes — qa: manual_user：**模拟器验收 A1–A13（高低版本双轨，用户拍板迭代内验证一律模拟器）**——复用 `tmp/tag-flicker-repro/` 帧差脚本：逐字符注入、帧差统计、滚动分层逐帧检查；A12 宏链/A13 全屏逐项过；IME 组合态（A11 真机部分）与高版本真机复核（A8/A9）**挪至开发完成后由用户配合执行**；CHANGELOG（变更 23）；`docs/apm/RULE.md` composer 条目更新（「已根治（WebView 单引擎）」）。

## 测试策略

原则：纯函数为主断言面（token 分段/原子删/宏切分既有测试零改动）；组件交互改桥消息协议断言（mock WebView 范本 `chat-transcript-webview.test.tsx` 全套现成：`simulateWebMessage` / `mockWebViewPostMessages` / flush helpers）；web 侧高亮渲染下放为纯函数（`renderHighlightHtml` 输出 HTML 字符串）jest 直测。IME 组合态 jest 无法构造（RN 时代即如此），以「change 消息序列」守护 + 真机观察。

### 测试用例

- T-HL1..6 / T-AD1..5 — Step 1 cherry-pick 摘入后**原样不动**（单源复用的直接验证）。
- T-MAC3(13 例) — main 既有纯函数测试**原样不动**（`prompt-macro-input.ts` 不改）。
- T-CB1..5 — blocking: yes — 桥编解码：全消息（含 mode/disabled/setSelection）encode/decode 往返；坏信封（v 不符/type 缺失/JSON 坏）静默丢弃；init payload 结构（含 disabled）；BRIDGE_V 一致性。（Step 2）
- T-CW1..6 — blocking: yes — `renderHighlightHtml`：escapeHtml 转义；token 与宏双模式 span；`@a$b` 互斥双 token；末尾 `\n` 补 `<br/>`；空串零宽空格；未闭合宏不高亮。（Step 3）
- T-CW7..9 — blocking: yes — web editor 纯逻辑（抽纯函数直测）：原子删拦截序列（退格命中区间→整段删文本，token/宏双源）；suppressChange（外部 setText 不触发 change 上报）；高度 clamp 与全屏跳过（maxHeight=null 不上报）。（Step 3）
- T-HOST1..6 — blocking: yes — 宿主壳契约：onSelectionChange 合成事件形状（`nativeEvent.selection.start`）；replaceCommittedText → `setText{text,selection}` 下发序列；外部 value 差分 → setText（水合/清空）；testID 落容器；selection prop 受控 → setSelection；**editable/disabled 变化 → init.disabled + setDisabled 下发（chat 链 running 只读、宏链只读详情两形态）**。（Step 4）
- T-CR4①② / T-INT / T-IME1..2 — blocking: yes — 协议版重生（`composer-input-webview.integration.test.tsx`）：程序化 setText → simulate change 续打 → 断言 value 恒 plain + change 消息流正确；typeahead 点选护栏（onSelect → setText 带 selection + 光标落位）；组合态序列（连续 change 消息不丢字、value 与最后上报严格相等）。（Step 7）
- T-MAC-W1..6 — blocking: yes — 宏壳协议版（`prompt-macro-text-input.test.tsx` 重写，对应 PRD A12）：value 直控渲染不抛；init mode/metrics 载荷（maxHeight 176 提取）；chips 点击 → setText 带光标；**disabled=true → init.disabled/setDisabled 下发 + chips 灰显断言（RN 侧）**；外部 `selection={0,0}` 一拍 → setSelection；表单外壳样式断言新写（main 版仅 1 例 value+children 不变量，无存量外壳断言）。（Step 5）
- T-FS1..3 — blocking: yes — 全屏链（`composer-fullscreen.test.tsx` + `prompt-editor-screen.test.tsx` composer 变体 describe，对应 PRD A13）**【修订 2026-09-29 真机轮】**：⛶ 按钮存在、与 @/$ 同款圆钮（样式相等断言）；点 ⛶ 跳 `PromptEditor` 且只带纯数据参数；退出（卸载）即以当拍草稿回填（草稿 store + 令牌 bump + `setText` 回填）；composer 变体无保存按钮、标题不显「未保存」、不拦退出、编辑/预览互切可用。（Step 6）
- A1–A13（PRD 验收）— qa: manual_user — Step 9 执行并留录屏/帧差证据。

## 兼容性或迁移说明

- 对外契约：`ComposerAtPathInput` props 面（除已证无消费的 `inputRef`/`editable`/`placeholderTextColor` 移除）与 `PromptMacroTextInput` props 面（全量保持）不变；ChatComposer 发送/草稿/typeahead 链路、ExpandablePromptInput renderInline ctx、DynamicBlocksCard/PromptLayoutSection 消费全部无感。
- 宏链既有全屏（ExpandablePromptInput ⛶ → PromptEditorScreen/CodeEditorWebView）不动；chat 新全屏屏是独立新增。
- e2e：composer 输入通道从原生无障碍切到 WEBVIEW context（`switchToWebView` 先例成熟）；`getComposerText` 旧豁免依据（无障碍文本通道）随之作废，文本断言走 webview DOM。
- 构建链：新增包意味着改 webview 后需 `npm run build:webview`（reload 不生效，三层产物链既有纪律）；新 worktree 首次出包必须 `build:webview:native`（checkWebViewAssets 门禁会拦）。
- `box-decoration-break: clone` 需 Chromium 130+（2024-10）；降级为跨行断口，纯视觉不阻塞。
- iOS：聊天页 iOS 分支现状无 KAV 避让、表单页 iOS 用 KAV（均为既有现状，非本方案引入）；验收以 Android 为主（用户设备），iOS 行为记入 spike 观察，不扩面。

## 风险与回滚方案

| 风险 | 缓解/备选 | 回滚 |
|---|---|---|
| 键盘链路：#3848 式「webview 内容被键盘顶出可视区」（社区未解决，高版本新架构） | Step 1 spike ① 前置双轨验证；缓解两档：web 侧 visualViewport 监听校正 scrollTop / RN 容器动画参数调优；缓解无效则迭代终止 | spike 不过不进 Step 2；已实现则 `feat/composer-webview` 放弃不合入，main 保持已发布现状（`feat/composer-overlay` 分支另留「胶囊-only overlay / 纯色字」备选实验线） |
| 键盘链路：低版本（<15）adjustResize 原生收缩 + insets 动画双轨下 webview 高度双重变化跳动 | spike 双轨必验（A10）；现有 TextInput 同链路已验证，webview 差异面仅在内核自身 resize 响应 | 同上 |
| **表单页多 WebView 实例内存/流畅度**（agent 配置页动态块可增，同屏多个宏输入=多个内核实例） | Step 5 模拟器实测（动态块 ≥3）；不可接受 → 宏链维持 main 现实现（`PromptMacroTextInput` 壳重写 revert 回 controlled-mentions children 着色版，props 面不变；表单页多行闪烁属既有现状不扩面），chat 链不受影响 | 宏链单链回退 |
| `box-decoration-break: clone` 旧 WebView 降级断口 | `CSS.supports` 检测可选降级样式（对齐 RN `pillStyleFlat` 的 pad0 思路）；默认接受断口 | 纯视觉，无回滚需求 |
| 每键 postMessage 开销 / RN 回写抖动 | web 自持真源 + RN 不回写（架构性消除）；change 负载极小（{text}）；heightChange rAF 节流 | — |
| 多 WebView 共存（聊天页 transcript + composer；全屏屏单实例）内存/首帧 | Android 同进程共享内核；spike 观察；转场挂载延迟先例（heavyPreviewReady 80ms）可抄 | — |
| IME 组合态真机表现 | compositionstart/end 事件可控（优于 RN 受控）；jest 序列守护 + 真机观察（与 overlay 迭代同口径） | 同键盘链路 |
| Windows worktree CRLF 红灯扩面 | 新测试禁用「读源码文本断言」型（readFileSync src）；需要契约断言时断言 dist（esbuild 产物恒 LF）+ 引号容忍正则；worktree 全量跑撞存量 8 套件 CRLF 红灯按 RULE 既有定性处理（工作区归一化 LF），不计回归 | — |
| build.gradle GBK 编码毁中文注释 | 字节级替换（Buffer 定位拼接）+ `git diff --numstat` 核对（RULE 既有纪律） | `git checkout` 还原 |
| 整体验收不过 | — | `feat/composer-webview` 放弃不合入（或 revert 到 cherry-pick 前的干净起点），main 保持已发布现状（controlled-mentions 闪烁为已知已发布行为）；`feat/composer-overlay` 分支保留作后续备选实验线 |

全量回滚边界：不触 core 与桌面；原生侧仅 build.gradle 一处资产清单（字节级替换）；回滚零外溢。
