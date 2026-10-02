---
zone: w9-mobileui-adv
agent: 辩护人（adversarial-defender）
files_scanned: 102
---

# W9 · apps/mobile/src/components/（chat 除外）+ theme/ + errors/ + debug/ —— 辩护报告

> 机位立场：为该区域的设计合理性辩护。产出「辩护理由清单」+「让步清单」。
> 声明：本机位为对抗对的辩护方，未读`raw/` 与 `synth/` 下任何他人报告。

## 摘要

移动端表现层的**基建层**。不含聊天主界面。核心是三段式分层：
`theme/`（21 个语义色 token 单源）→ `components/ui`+`form`+`sheet`+`chrome`（无业务的原语）
→ `components/agent|vfs|provider|skills|profile|...`（业务组件）。
另含两条正交支撑线：`rich-content/`（Markdown→消毒 HTML→WebView 富文本管道）与
`errors/`+`debug/`（错误文案与诊断打点）。约 13k 行。

## 职责与边界

- **负责**：视觉令牌下发、通用交互原语（弹窗/sheet/表单/卡片/按钮）、平台键盘避让策略、
  富文本渲染与 HTML 消毒、WebView 桥协议（类型+编解码）、错误文案归一。
- **不负责**：数据获取（走 `hooks/useRuntime` → runtime service）、路由（走 `navigation/`）、
  聊天主界面（`components/chat/`，另一机位）、业务规则（`packages/core/config-forms/agent` 等）。
- 边界特征：**UI 层零业务持久化**。所有写操作都通过 `runtime.*` 门面下沉，组件自身不碰
  表 / KKV / 文件。这一点在本区102 个文件里守得很干净，是该区最值得肯定的设计纪律。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `ThemeProvider` / `useTheme` | `theme/ThemeProvider.tsx:28,101` | 令牌上下文；`loaded` 暴露首帧未就绪态 |
| `tokensForMode` / `ThemeTokens` | `theme/tokens.ts:6,76` | 21 个语义 token，纯数据无逻辑 |
| `ModalShell` | `components/ui/ModalShell.tsx:68` | 弹窗/底部 sheet 统一骨架，三 variant × 三键盘策略 |
| `AppModal` | `components/ui/AppModal.tsx:10` | RN Modal + `useIsFocused` 焦点闸门 |
| `PickerListModal` | `components/ui/PickerListModal.tsx:61` | 列表单选骨架（load/loading/error/empty 全包） |
| `BottomSheetMenu` | `components/sheet/BottomSheetMenu.tsx:28` | 动作菜单，absorbed自 `SessionActionsDrawer` |
| `EditorScreenShell` | `components/chrome/EditorScreenShell.tsx:75` | 编辑器屏外壳，文件/prompt 两屏共用 |
| `ScreenFormLayout` | `components/form/ScreenFormLayout.tsx:61` | 表单屏骨架（含 FormOverlayProvider） |
| `sanitizeRichHtml` | `components/rich-content/sanitize-rich-html.ts:113` | 富文本唯一消毒出口 |
| `prepareTranscriptRichHtml` | `components/rich-content/prepare-transcript-rich-html.ts:98` | Markdown→消毒 HTML |
| `formatError` | `errors/format-error.ts:48` | Core 领域错误→用户文案 |
| `toastMessage` | `errors/toast-message.ts:4` | 单行 toast 文案拼装 |
| `useAgentEditorFormState` | `components/agent/agent-editor/useAgentEditorFormState.ts:164` | Agent 表单状态容器 |

## 数据访问

**本区域不直接访问任何持久化。** 实测：zone 内 102 文件无 `sqlite`/`AsyncStorage`/
`appUi.get` 之外的直读；唯一的 KKV 触点是 `theme/ThemeProvider.tsx:41` 与 `:71`
经 `appUi.get/set(APP_UI_KEY_THEME)` 读写 `theme` 偏好键，且读写都包了 try/catch。

VFS 内容读取亦不落本区：`components/vfs/` 只做**展示层映射**，行数据由上层注入
（`components/vfs/vfs-row-mapper.ts:126` `mapWorktreeRow(row: WorkplaceListRow, ...)`）。

富文本正文的来源是 `file_cache` KKV 域（见 `docs/apm/RULE.md` 第 31 行），但**读取发生在本区之外**，
本区只收到字符串。这是正确的分层。

## 依赖关系

**import 谁**
- `@novel-master/core/*`：仅类型与错误类 + 两个纯函数入口
  （`agent-editor-state.ts` 的 `formSnapshotJson`/`definitionToForm`、
  `sanitize-rich-html` 依赖的 `formatVfsErrorForUser`）。无 core→mobile 反向依赖。
- `react-native-keyboard-controller` / `react-native-reanimated` / `react-native-webview`：
  键盘与 WebView 能力，集中在 `chrome/`、`form/`、`vfs/` 少数文件。
- `@/theme`、`@/components/ui`、`@/errors`：区内横切依赖。

**被谁消费**（实测消费面）
- `ModalShell` 被 **24 个文件**引用（zone 内 15 + screens 层 9），
  覆盖 `screens/stack/` 的 ProvidersScreen / SkillsSettingsScreen / SearchEnginesScreen /
  SmartSortRulesScreen / SmartSortRuleEditorScreen / ProviderDetailScreen、
  `screens/tabs/chat-tab/` 的两个面板、以及 `chrome/ProjectDrawer`、`vfs/VfsFileManager` 等。
- `BottomSheetMenu`、`PickerListModal`、`EditorScreenShell`、`ScreenFormLayout` 同样跨屏复用。
- `useFormOverlay` 被 `form/FormSelectField` 与 `agent/ToolPolicyPicker` 共用。

**结论：分层不是纸面设计，是真被消费的原语层。**

## 辩护理由清单

### D-1 · ui 原语分层：契约窄、语义正交、消费面已验证（无异议，建议维持）

`ModalShell` 的props 只有 10 个，且**没有一个是业务语义**——全部是视觉与平台维度
（`variant` 三态、`animationType`、`keyboardAvoid` 三策略、`backdropOpacity`、`panelStyle`）。
业务信息一律由 children 承载。这条边界守住了，所以它能被 24 个文件复用而无需分叉。

更关键的是**它把三个平台陷阱显式建模成了枚举**，而不是散落的 if：

```
keyboardAvoid: {kind:'none'} | {kind:'translate', fraction:0.5|1} | {kind:'adaptive', maxHeightRatio}
```

对应 `ModalShell.tsx:35-43`。三个值各自对应一类真实场景：菜单/日历无输入（none）、
矮面板整体上移（translate）、贴底高面板上移+收缩（adaptive）。**把"键盘避让"从隐式
平台分支提升为显式策略参数**，是这个区域最值得辩护的设计决策。

配套的 hooks 契约也干净：`useAndroidModalKeyboardAvoid` 与 `useAdaptiveKeyboardSheetStyle`
**无条件调用、按 kind 选用其一、未选用的那份样式不挂载**（`ModalShell.tsx:84-96` 注释明说）。
这规避了 hooks 规则违规，同时保证零副作用。**这个处理是正确的，很多同类实现会栽在这里。**

### D-2 · BottomSheetMenu：吸收而非平行，是有意识的债务收敛（无异议）

`BottomSheetMenu.tsx:3-4` 明写「吸收了原 `SessionActionsDrawer`（cr-fix-spec comp-rest/C-6）：
未提供回调的项传 `disabled` 置灰不可点，不再需要平行的 drawer 实现」。

这个取舍要肯定。两种做法都"能跑"：一种是保留两个组件，另一种是把差异压缩成一个
`disabled?: boolean` 字段压进同一个骨架。**后者把"实现分叉"换成了"数据表达"**，
成本是一个可选布尔，收益是彻底消除一份平行 UI。这是正确的方向。

`SheetMenuItem` 的 `readonly` 全字段（`BottomSheetMenu.tsx:13-17`）也表明它是当作
只读 DTO 用的，契约清晰。

### D-3 · 编辑器外壳 EditorScreenShell：用 props 表达"屏差异"而非用条件渲染（无异议）

`chrome/EditorScreenShell.tsx:28-73` 的 props 设计是本区最见功力的一段。
文件编辑屏与prompt 编辑屏共用外壳，差异**全部通过"传不传"来表达**：

- `save` 不传 → 不渲染左位按钮（chat 输入框全屏没有"落盘"概念）
- `title` / `titlePress` / `toggle` 都不传 → 整条 toolbar 不渲染
- `segmented` / `previewMode` 不传 → 纯编辑态

`hasToolbar` 的推导（`EditorScreenShell.tsx:92-93`）把"整行不渲染"这个决策收敛到一处，
而不是散成一串三元。**这是把配置空间用"子集关系"而不是"布尔开关"表达**——
`title` / `titlePress` 二选一由 `title == null ? null : titlePress ? ... : ...`
三目链（`:122-153`）裁决，逻辑闭包完整。

同时 keyboard 三分支（`:199-216`）把预览态（无软键盘）、Android（裁切抬升）、
iOS（KAV padding）三种布局显式分开，**没有留"默认走iOS 分支"这种隐式陷阱**。

### D-4 · Android 键盘避让：marginBottom 收缩而非 translateY，且理由被记录（无异议）

`chrome/AndroidKeyboardClipBody.tsx:5-8` 的注释解释了为什么不能用 translateY：

> body是 `flex:1` 不会自动缩，平移后顶部会被外层 `overflow:hidden` 裁掉，滚不回去也编辑不了；
> 这里直接收缩裁切窗口高度。

这是**正确的物理判断**：RN 的 `flex:1` 在 `overflow:hidden` 容器里平移就是被裁，不是被推。
很多实现（包括很多 demo）在这里会选 translateY 然后在真机上发现滚不回去。
并且这个组件是从"四处逐字复制"里提取的（`:2`），`form/ScreenFormLayout.tsx:28-59`
的 `AndroidKeyboardFormBody` 又复用了同一套模式——**同一知识被复用了两次而不是被复制两次**。

### D-5 · AppModal 焦点闸门：修的是一类"幽灵弹窗"而非单个 bug（无异议）

`ui/AppModal.tsx:1-4` 的问题陈述：

> Prevents unfocused Tab screens from leaving native Modal overlays that block touch
> and Android back after Tab/Stack navigation.

`effectiveVisible = visible && isFocused`（`:13`）。**15 行的组件承载了一条导航一致性不变量**：
任何基于 `Modal` 的弹层，其生命周期不得超过其宿主屏的焦点生命周期。
这解释了为什么 `PickerListModal` / `TextPromptModal` / `SkillPicker` 等全都必须走
`ModalShell`→`AppModal` 这条链——**不是风格偏好，是不变量要求**。

并且我实测过**唯一的绕过点**是 `update/UpdateCheckResultModal.tsx:9`（直接 import 原生 `Modal`），
而它的注释（`:4-6`）给出了充分理由：它在 `NavigationContainer` 之外渲染，
`useIsFocused()` 会抛 "Couldn't find a navigation object"。**例外有据、理由入注释、
且是应用级首屏弹窗（确实无需 focus gate）——这是正确的例外处理，不是破窗。**

### D-6 · FormOverlayHost：用 zIndex 解决一个真实平台限制（无异议）

`form/FormOverlayHost.tsx:1-3` 的问题陈述：「Modals nested inside ScrollView may not
cover sibling footers on Android」。解法是把 overlay 提升到 `ScreenFormLayout` 的
wrapper 下（`ScreenFormLayout.tsx:12` 挂 Provider），并用 `zIndex:100 + elevation:100` +
`pointerEvents` 分层（`FormOverlayHost.tsx:48-54`）。

**`pointerEvents="box-none"` 在 host、="auto" 在 layer** 的两级设计是对的：
host 透明可穿透，layer 实心可拦截。这就是让 sheet 能盖住 sticky footer 的最小机制。

配套的 `ModalShell standalone` 逃生舱（`ModalShell.tsx:60-64`）也设计得当：
FormOverlayHost 体系没有 AppModal/KAV 外壳，所以 ModalShell 允许只渲染遮罩+panel 骨架。
`agent/ToolPolicyPicker.tsx:117` 正是这样用的。**没有为它造第二套骨架，而是给主骨架开了
一个显式开关——这是正确的扩展方式。**

### D-7 · 富文本安全管线：分层清晰，每一层都有独立职责且都有测试（无异议）

`sanitize-rich-html.ts` 的内联 style 白名单（`:21-33`）值得单独辩护：
只放行 12 个纯展示类 CSS 属性，`position`/`z-index`/`inset`/`transform` 以及
`width/height` 的 100% 组合**全部剥离**。注释（`:16-19`）写明了要封的正是
「恶意 `position:fixed;inset:0` 全屏覆盖伪造 app 界面」这条路径。

配套的三重加固也都在：
1. `splitStyleDeclarations`（`:39-73`）手写扫描器跟踪引号与括号深度，
   保证 `url("a;b")` 里的分号不被当分隔符——**这是对"用 split(';') 会被绕过"的正解**。
2. 含 `/*` 的声明整条丢弃（`:84-86`），堵住"用注释拼出 `pos⋯ition`"的绕过。
3. `url(` 的声明丢弃（`:96-98`），堵住 `background:url` 外联加载。

而 `parseStyleAttributes: false` 的原因（`:117-118`）是 PostCSS 依赖 Node、Hermes 解析不了，
于是改由 `transformTags` 通配自己过滤——**限制反而促成了更精确的自控实现**。

`allowedAttributes` 里的白名单（`:136-147`）也是最小集：`a` 只放 `href/name/target/rel`，
`img` 放 `src/alt/title/width/height`，`span` 额外放 `data-annotate-id`（批注锚管道必需），
`pre` 额外放 `data-lang`（代码块语言标签）。**每一项都有注释说明为什么需要**，
没有"先全放行以后再收紧"。

### D-8 · WebView 桥：版本号 + 入站校验 + 导航守卫，三层防护（无异议）

`vfs/CodeEditorBridge.ts:6-10` 的 `BridgeEnvelope<T,P>` 带 `v: 1` 字段，
且 `decodeCodeEditorToHost`（`:70-83`）**真的校验了** `v` 与 `type`：

```ts
if (record.v !== CODE_EDITOR_BRIDGE_VERSION) { throw ... }
if (typeof record.type !== 'string' || typeof record.payload !== 'object') { throw ... }
```

很多桥协议只定义 envelope 类型却不做运行时校验（TS 类型在 `JSON.parse` 后完全失效）。
**这里补上了运行时校验，是对的。**

`RichDocumentWebView.tsx` 的导航守卫（`:339-357`）更值得肯定：
`shouldStartLoadWithRequest` 只放行包目录内的 `file://`，`http/https` 外跳系统浏览器，
**其余 scheme 一律拒绝**。注释（`:341-343`）点明了它的安全意义：

> 外部页面无法在 WebView 内落地后，其 postMessage 伪造桥消息即无从成立。

**这是在攻击面上做的收敛，不只是防跳转。** iOS `target="_blank"` 用
`onOpenWindow` + `preventDefault` 兜底（`:362-366`），并且注释纠正了一个易错点：
「WebViewOpenWindow 的字段是 targetUrl（新窗口目标地址），无 url 字段」。

还有几处细节体现了"被真机教育过"：
- `:193-195` WebView 被系统回收重建后复位 `mermaidViewerOpenRef`，避免残留 true 吞掉返回键。
- `:329` `!navigation.isFocused()` 防止 BackHandler 全局性吞掉上层屏返回（注释引用了
  `GlobalTemplateScreen` 先例）。
- `:262-265` **明确禁止把 annotations 与 setDocument 绑进同一 effect**，并说明原因
  （会销毁重建 Recogito、每改草稿都整页重渲导致二次点击极卡）。**这是一个被踩过的坑被写在了原地。**

### D-9 · entity 解码的"入口全解 / 出口保括号"对称设计（无异议）

`rich-content/decode-literal-html-entities.ts` 提供了两个语义相反的出口：
- `decodeForMarkdownInput`（`:43`）：完整解码含尖括号，供 markdown-it 解析；
- `decodeAfterSanitize`（`:51`）：`preserveAngleBrackets: true`，**保留 `&lt;`/`&gt;`**。

这是防止"sanitize 逃逸后的伪标签被二次还原成裸尖括号"的对称设计，
且循环上限 3 轮（`:22`）防双重编码无限展开。**入口与出口成对定义、语义在函数名里就说清，
是最容易验证的形态**——也确实有 `decode-entities-parity.test.ts` + 快照文件在盯。

### D-10 · linkify 撞车 TLD：用 match 层过滤而非动依赖（无异议，且是正确取舍）

`prepare-transcript-rich-html.ts:11-20` 处理"裸 `xxx.md` 被 linkify 误判为摩尔多瓦 TLD"的问题。
注释解释了为什么不用官方 API：

> linkify-it 5 的 `tlds()` 增删 API 语义破碎（单调用禁不动目标 TLD 反伤 com，
> 批量禁用需手工重植全表）

于是改在 match 层过滤（`:47-59`）。**在依赖 API 语义破碎时选择绕过而非 hack 依赖，
是成熟的工程判断。** 且过滤条件写得克制（`schema !== ''` 显式协议一律保留、
非无路径形态不动），注释还区分了「实测可达」与「前向防御」两类 TLD
（`:36-38` 的 `// 两字符国别码撞车扩展（round 3 CR 补，实测可达）` vs `zip/app/page/... 属前向防御`）。

### D-11 · theme 层：token 单源 + 双入口容错，22 个文件零例外（无异议）

`theme/tokens.ts` 是**纯数据零逻辑**（78 行，只有两个对象与一个 selector）。
`ThemeProvider`（`:34-64`）的加载 effect 覆盖了三种情况：
显式偏好 → 系统 dark → 系统 light，且 `cancelled` 标志防卸载后 setState；
`:55-60` 的 catch 分支保证 `appUi` 读取失败时**仍会落到系统色并置 `loaded`**。

`setMode`（`:66-79`）失败时 `console.warn` 而非抛出，注释（`:73`）说明理由：
「fire-and-forget 场景（如 void toggleMode()）下不冒泡成 unhandled rejection」。
**这是个真实的 RN 陷阱（未捕获的 Promise rejection 在 Hermes 上会静默吞掉后续错误），
处理得对。**

实测消费面：**zone 内 58 个 .tsx 文件全部经 `useTheme()` 或 `tokens` prop 取色**，
无一例外。硬编码 hex 我全量扫过，只剩 9 处，逐一都有正当理由：

| 位置 | 值 | 是否正当 |
|---|---|---|
| `Buttons.tsx:92`、`ConfigListCard.tsx:88`、`SegmentedControl.tsx:59`、`FormChipGroup.tsx:49`、`MonthRangePickerSheet.tsx:29` | `#FFFFFF` | ✅ 正当：primary色上的前景色，两套主题下primary 都是深蓝，白字对比度均达标 |
| `ProjectDrawer.tsx:352` | `#FFFFFF` | ✅ 同上 |
| `charts/PieChart.tsx:37-40` | 四个分类色 | ✅ 正当：数据可视化分类色**不能跟随主题**，否则暗色下无法区分系列 |
| `PieChart.tsx:171` | `#FFFFFF` | ✅ 正当：环形图扇区内文字 |
| **`VfsFileManager.tsx:1000,1004`** | `#dbeafe` / `#fef3c7` / `#92400e` | ⚠️ **见让步 C-1** |

### D-12 · card-styles 单源化（无异议）

`ui/card-styles.ts:1-6` 明写这是从"ElevatedCard / ProfileMenuItem / ProfileSwitchItem /
FormSectionCard **四处逐字复制**"里提取的。提取后`card` / `cardRow` / `cardSurface` /
`iconWrap` / `chevron` 五个导出被 `ElevatedCard.tsx:13` 与 `FormSectionCard.tsx:7` 消费。
**四处复制收敛到一处，是该区"cr-fix-spec comp-rest"系列的典型成果。**

### D-13 · debug/run-timing 的窗口自愈设计（无异议，但请勿当死代码清理）

`debug/run-timing.ts` 的 `ROLLBACK_TIMING_WINDOW_MS`（`:46`）有完整的设计论证：

> 若不设上限则首次回滚后窗口永久打开，日常滚动与快照分片会持续往同一条 t0 上打点，
> logcat 被淹没、回滚轴失去可判读性。

且 `:66-71` 的实现是"超时后**首个站点**即自动把 `rollbackT0` 复位为 0"——窗口自愈，
不需要额外的心跳 timer 或显式关闭点。**这个"用惰性检查代替常驻timer"的写法省掉了
一个组件生命周期管理，是干净的。**

`bootT0`（`:78`）用模块求值时刻做基准，因为冷启动链没有发送 t0——这个理由也写清了。

**辩护要点：全文件 `__DEV__` 门控（每个函数入口都判），生产环境全是 no-op，
零运行时成本。这是"保留可用的诊断能力"的正确姿势，不是遗留垃圾。**

### D-14 · errors 层：领域错误到用户文案的单一映射（无异议）

`errors/format-error.ts` 按 instanceof 链逐层 unwrap（ProviderError → VfsError →
{ Zip/Card/Chat/Agent/SessionFs/CloudSync } → ToolError → TdbcError → Error → String）。
`ToolError` 分支（`:65-72`）特别处理了 cause 链：若 cause 是 VfsError 则整体换成
VFS 的用户文案，否则拼接成 `主消息\ncause 消息`。

`toast-message.ts:4-11` 只有 11 行，做的是"标题：细节"的单行拼装，
且 `detail` 为空串时降级为纯标题。**这个分层（formatError 管"一个错误变成什么"、
toastMessage 管"两个东西怎么拼"）职责单一，可独立测试**——确实有
`format-error.test.ts` 在盯。

### D-15 · atomic-range-delete：把"宏白名单"参数化为泛化区间（无异议）

`common/atomic-range-delete.ts:12` 说明算法骨架"与原 `tryAtomicMacroDelete` 一致，
仅把宏白名单区间参数化"。6 步算法在文件头注释里写全了（`:12-18`），包括
6 个边界情形：非删除返回 null、尾段对账不匹配返回 null、删除已覆盖整段区间时
**返回 null 交给调用方默认差分**（`:50-53`）。

**最后一条尤其关键——它明确划出了"这个函数该做什么、不该做什么"的边界，
而不是贪心处理所有情况。** 有 `atomic-range-delete.test.ts` 覆盖。

### D-16 · vfs-row-mapper：展示映射与导航逻辑分离（无异议）

`vfs/vfs-row-mapper.ts` 把 `WorkplaceListRow`（core 类型）映射成 UI 行，
但**导航所需的逻辑路径与展示名严格分离**：`path` 字段保持逻辑路径原值，
`name` 才是展示名。`pathWithLabels`（`:62-80`）的 `@remarks`（`:59-60`）写明
「只影响展示，不改导航与逻辑路径」。

**这是很容易做错的设计——如果面包屑显示名污染了逻辑路径，跨会话导航就会错。
这里用类型和注释把这条边界钉死了。** 有 `vfs-row-mapper.test.ts` 覆盖。

## 让步清单

以下是**我承认站不住、或者需要别人来定夺**的部分。按优先级排。

### C-1 ·【P2·confirmed】VfsFileManager 徽章硬编码浅色调，dark 主题下会瞎

`components/vfs/VfsFileManager.tsx:997-1006`：

```ts
case 'in':
  return {backgroundColor: '#dbeafe', color: tokens.primary};
case 'muted':
  return {backgroundColor: tokens.border, color: tokens.textSecondary};
default:
  return {backgroundColor: '#fef3c7', color: '#92400e'};
```

**这是我在 D-11 的硬编码审计里唯一没能自圆其说的一处。** 其余 8 处都是
「primary 上的白字」或「数据可视化分类色」，有正当理由；而这两处是
**语义徽章色**（"跟随"= 琥珀底棕字、"目录规则开启"= 蓝底），它们不属于
primary/白字那一类。

问题：dark 主题下 `tokens.background = #000000`，一个 `#fef3c7`（浅米黄）的徽章
会是一个刺眼的亮块，而文字 `#92400e`（深棕）在亮块上虽然可读，但整个徽章在暗色列表里
像一块荧光贴纸。同理 `#dbeafe` 浅蓝底在dark 下也偏亮。
`muted` 分支用了 `tokens.border`/`tokens.textSecondary`（正确的 token 化写法），
**说明作者知道该怎么写，只是这两条漏了**。

**建议**：给 `ThemeTokens` 加 `badgeFollow` / `badgeFollowText` / `badgeIn` 三组 token
（theme/tokens.ts 已有 `warningMuted` 这个先例，见 `:28`/`:50`），或者至少把浅底改成
`tokens.warningMuted`（已有）而不是裸 hex。**我不擅自改，因为这要动 `theme/tokens.ts`
的公开形状，属于跨区契约变更，应由能同时看 desktop 侧的 reduce 代理拍板。**

### C-2 ·【P2·confirmed】Agent 编辑器作用域（mode）改动不触发 dirty，可能静默丢改动

这条我要认真让。链路：

1. `packages/core/src/config-forms/agent/agent-editor-state.ts:542-568` 的
   `formSnapshotJson` **没有把 `mode` 写进快照**（字段列表：name/maxSteps/modelEnabled/
   toolsMode/toolsSelected/(providerId+savedModelId)/system*/persist*/dynamic*/
   workplace*/customAttach*/skills*/description/persist/dynamic，**独缺 mode**）。
2. `components/agent/agent-editor/useAgentEditorFormState.ts:225` 的 dirty 判定
   `isDirty = savedBaseline != null && snapshot !== savedBaseline`，两者都过`formSnapshotJson`。
3. 而 `mode` 在 UI 上**是可编辑的**：`agent-editor/AgentEditorBasicSection.tsx:76-85`
   的 `FormSelectField` 直接绑 `onModeChange → patch({mode})`。
4. 保存时 `mode` **确实会落库**：`AgentEditorForm.tsx:178` 的
   `buildAgentDefinitionFromForm(form)` → `agent-editor-state.ts:613` `mode: input.mode`。

**后果**：用户在"作用域"下拉里从"默认（全部）"改成"仅子智能体"，界面**不会**出现
「有未保存的更改」红条，`useUnsavedGuard`（`hooks/useUnsavedGuard.ts:17`）也不会
在返回时弹拦截框。用户可以直接返回，改动静默丢失。

**旁证这不是有意设计**：
- `useAgentEditorFormState.ts:218-219` 有注释「原实现依赖数组漏了 mode，收敛后顺带修正」，
  说明作者**意识到过mode 会被遗漏**，但那次修的是 useMemo 依赖数组，不是快照字段本身。
- desktop 侧更粗：`AgentDefinitionEditorForm.tsx:223` 直接写死 `mode: "all"`,
  desktop 根本没有作用域选择器——所以这个问题只在 mobile 暴露，双端不一致。
- `__tests__/agent-editor-form-dirty.test.tsx` 里搜不到任何 `mode`/作用域断言，
  测试也没覆盖到。

**建议**：`formSnapshotJson` 补上 `mode: input.mode`（core 一行改动，双端同时受益）；
mobile 补一条 dirty 测试。**我不改，因为 `formSnapshotJson` 在 `packages/core`，
不在本 zone，且改它会影响 desktop 的 baseline 比对（desktop 写死 `mode:"all"`，
补字段后 desktop 的 baseline 也会带上 mode，两边仍能对齐，但要一起验）。**

### C-3 ·【P3·intentional，按兵不动】vfs-move-path 与 desktop vfs-tree-dnd 逐字重复

`components/vfs/vfs-move-path.ts:2` 自己承认：「从 desktop vfs-tree-dnd 拷贝，暂不抽 core」。
我实测比对，`isSelfOrAncestorPath`（mobile `:6-17` vs desktop `vfs-tree-dnd.ts:36-47`）
与 `resolveMoveDestination`（mobile `:23-36` vs desktop `:53-67`）**逐字一致**，包括注释。

**我为这个现状辩护**：移动校验是**安全边界逻辑**（"不能移到自身/子树"），
两份实现漂移的后果是双端行为不一致——但反过来说，**共享一份 core 实现意味着
两端永远一致，风险为零**。文件里明写「暂不抽 core」，说明是有意识的暂缓而非疏忽。

**我不主张现在动它**：抽 core 要动 packages/core 的导出面 + 双端 import 改写 + 两份
测试的归属调整，属于跨区重构，收益（44 行去重）不抵风险。**但在台账上它应该被标成
"已知技术债、暂缓、勿重复报"**，以免后续机位当成新 bug 反复上报。
两边都有测试兜底（`apps/mobile/__tests__/vfs-move-path.test.ts`、
`apps/desktop/test/vfs-tree-dnd-move.test.ts`），漂移会被测出来。

### C-4 ·【P3·suspected，我不确定该不该报】ThemeProvider 的 `loaded` 暴露了但似乎无人消费

`theme/ThemeProvider.tsx:21` 暴露 `loaded: boolean`，`:52`/`:59` 两处置 true，
`:36` 处 `if (!appUi) { setLoaded(false); return; }`。

我搜过 zone 内**没有任何组件读 `loaded`**，也没搜到 zone 外有读取
（`useTheme()` 的消费方都只解构 `tokens` 或 `{tokens, mode}`）。
这意味着：首帧到偏好加载完成之间，组件会先按 light 渲染一帧再切成 dark——
**如果用户偏好是 dark，会有一次浅色闪烁**。

**我不确定这算不算问题**，因为：(a) 可能是有意为之的首帧降级；
(b) `appUi` 通常在 App 启动早期就绪，闪烁窗口可能短到不可见；
(c) 也有可能某个我没搜到的 screen 在用。所以我标`suspected` 而不是 confirmed，
**建议交给能跑真机的人验一下 dark 偏好冷启动是否有闪白**。若确有闪烁，
正解是让 `loaded` 为 false 时渲染一个空壳而不是按 light 渲。

### C-5 ·【P3·intentional，绝不能报】composer tag 多行闪烁

`docs/apm/RULE.md` 第 21 行有完整记载：mobile 输入框 tag 在多行文本下打字每键闪烁，
已定性为"多行文本变化的全量重排重绘，胶囊内联在 TextInput 内则不可避免"，并明写
**两条死路勿重试**（wrapper 层复用 children、patch 库短路冗余重推，均致 tag 消失）。

对应文件是 `components/chat/ComposerAtPathInput.tsx`——**本来就不在本 zone**。
即便有相邻机位扫到，也应当标 `intentional` 引用 RULE 第 21 行，不当bug 报。
我在这里记一笔，是为了给 reduce 代理省一次重复调查。

### C-6 ·【P3·intentional，绝不能报】小米/HyperOS 上划词批注菜单不可用

`docs/apm/RULE.md` 第 11 行记载：HyperOS 系统级替换 AOSP 文本选区菜单，
react-native-webview 的 `menuItems` 依赖的 `startActionMode` 重写整条不被调用，
**用户 2026-09-28 四轮调查后拍板 hold 不适配**，并明写「**勿当 bug 重复排查、勿立项适配**」。

本 zone 里 `vfs/RichDocumentWebView.tsx:42-45` 的 `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS`
与 `vfs/file-annotate-gate.ts:18-29` 的 `shouldEnableFileAnnotate` 就是这条链路的
mobile 侧实现——**代码本身是正确的，只是硬件覆盖面上有已拍板的盲区**。
另记：`vfs/file-annotate-gate.ts` 把门闩抽成纯函数（可单测），这个设计本身是对的。

## 争议与存疑（不抹平分歧）

1. **C-1 该不该在本波修，还是留给后续迭代？** 我的立场是**该修但不急**——
   它是视觉一致性问题不影响功能，但改动要动 `theme/tokens.ts` 的公开形状。
   如果 reduce 代理认为本波收敛 token 形状更划算，就一起改；
   如果认为风险大于收益，就标 P2 留到 backlog。**我倾向后者**（视觉不一致不阻塞任何流程，
   而 theme token 是双端可能共享的形状）。

2. **C-2 是 core 的锅还是 mobile 的锅？** 我倾向归 core——
   `formSnapshotJson` 的字段列表和 `AgentEditorFormInput` 不一致，这是 core 的契约漂移，
   mobile 只是忠实地用了它。**但我承认 mobile 也有责任**：`AgentEditorBasicSection`
   把 `mode` 做成了可编辑控件，却没有任何本地兜底（比如保存前对比 mode 与初始 mode）。
   如果 core 不改，mobile 可以先加一层本地兜底。**这是个可以两做的分歧，我不当机拍板。**

3. **`rich-content/` 与 `chat/` 的职责边界是否清晰？** 我在本 zone 的辩护范围内把它算作
   `rich-content/` 的一部分（它无 chat 依赖、被 vfs 与 chat 共用）。
   但 `prepare-transcript-rich-html.ts` 的注释大量在谈 chat transcript 的口径
   （"批注文本流零偏移"、"与 desktop MermaidBlock 无按钮口径对齐"），
   **它其实是个跨端共享管线的 mobile 侧实现**。如果 chat 机位也把它算成自己的，
   会出现重复认领。**建议 L2 reduce 时明确：rich-content/ 归 w9-mobileui-adv，
   chat 机位只报它自己的编排层。** 这不是设计缺陷，是覆盖矩阵的划分问题。

4. **卡片样式单源是否已经足够？** `card-styles.ts` 收了 5 个导出，但我注意到
   `ui/ConfigListCard.tsx:92` 的 `chevron: {fontSize: 22, fontWeight: '300'}`
   与 `card-styles.ts:48-50` 导出的 `chevron` 逐字相同——**`ConfigListCard` 没有复用它，
   而是自己又定义了一份。** 同理 `ui/SegmentedControl.tsx:49-52` 的 shadow 四件套
   与 `card-styles.ts:17-21` 的 shadow 四件套也重复（虽然 shadow 强度略不同，
   `0.08/3` vs `0.08/3`，实际完全一致）。
   **这说明单源化做了一半**：提取了但没做完收口。**这是个 P3 的洁癖级问题，
   我不主张本波修**（改动面小但纯属美观），但它是我在本区找到的唯一"提取不彻底"的实例，
   值得记在账上以免被当成"已彻底收敛"。

## 扫描覆盖说明

- zone 内 102 个受版本控制文件全部列入扫描（`git ls-files` 实测）。
- **全文精读**（约 40 个）：theme/ 全部、`errors/` 全部、`debug/` 全部、
  `ui/` 全部、`sheet/BottomSheetMenu`、`form/` 全部、`chrome/` 全部、
  `rich-content/` 全部（6 个）、`common/atomic-range-delete`、
  `agent/` 主文件与 agent-editor 全部、`vfs/` 的 bridge/gate/preview/FM/prompt 相关、
  `provider/FetchModelsSheet`、`skills/skill-ui`、`update/` 全部。
- **定点击读**（依据行数与风险排序）：`vfs/VfsFileManager.tsx`（1231 行，读 badge 段与
  目录规则分支）、`agent/AgentList.tsx`（574）、`vfs/FileMarkdownPreview.tsx`（551）、
  `skills/NewSkillModal.tsx`（466）、`charts/*`、`icons/TabIcons.tsx`、
  `sheet/DirectoryRuleSheet.tsx`、`sheet/MetricDetailSheet.tsx`、`ui/MonthRangePickerSheet.tsx`、
  `chrome/ProjectDrawer.tsx` 等——这些以结构扫描 + 关键段定点击读为主，
  **未逐行精读，若 reduce 阶段对本区某个大文件有具体疑问，应派定点验证代理而非采信我的判断。**