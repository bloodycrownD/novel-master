---
date: 2026-10-01
---

# 对话页 WebView 统一化（chat-webview-unify）技术规格（SPEC）

> 修订记录：r1（2026-10-01 spec-check-loop 首轮审查后修订）——闭合 14 条 P0 / 20 条 P1 / 8 条 P2（审查证据包见 `cache/spec-check-r1-{perf,arch,logic}.md`，judge 裁决含逐条证据）。r2（同日第二轮）——闭合新增 3 P0（键盘态判定归属/合成 dispatcher 契约/工厂位置）+ 3 P1（skill filter 抽取/hintRow 缺位/chips 置灰）+ 9 P2。r3（第三轮）——闭合 2 P0（接口表键盘 hook 互斥/post 注入裁定）+ 4 P1（上行路由表/变更点对齐/metrics 六值/装配归属表）+ 8 P2。r4（第四轮）——闭合 1 P0（Step 1 残留 post 注入）+ 3 P1（工厂参数落点/selectAll 通道/dockAction post 来源）+ 5 P2。r5（第五轮终审）——闭合 1 P0（§单次注册段签名残留）+ 1 P1（themeUpdate fan-out 路由）+ 5 P2（五条计数/命名/透传/措辞对齐）；judge 预判「改完即 Go，主干裁决前四轮已稳住」。fix-cr（2026-10-01，cr-fix-spec r6 full 后的末位回填节点 `fix-cr-spec-backfill`）——**纯文档回填，不改任何契约裁决**：Q1/Q2/Q3 拍板结论回填；资产注册点五处→六处（补 Android `checkWebViewAssets` 守卫清单）；§合成 dispatcher 契约第 4 条补「装配未成功不发 ready、交 8s 兜底」（T-CU1 同步）；划词菜单补 paste 与 `inputDisabled` 同口径门控；Step 4 chips `maxHeight:36` 基底口径更正；风险表补 typeahead 视觉差异与体积实测双口径；可观测性补 `composer_dock_degraded`；§合成 dispatcher 契约第 2 条路由表删 `stickIfNearBottom` 行；旧宿主 re-export 与旧包 `editor.ts` 三处函数体触碰口径放宽；测试策略补两条硬约束。r6-A1 遗留已于 fix-cr2 轮（2026-10-02）回填闭合：`spec.md:99` typeahead 候选源措辞按方案 B 收窄（撤回 vfsMutated 事件承诺），见该行注记。

## 范围外顺手修与二阶段落地（2026-10-01/02，口述需求留痕）

以下改动不在本 spec 步骤矩阵内（用户真机反馈驱动的口述需求 + 二阶段拍板），随迭代落地、随 fix-cr2 轮收尾入库，契约细节以代码注释与 `exit-jank-fix-playbook.md` 为准：

1. **会话列表进 WebView（第二阶段，2026-10-01 拍板「不做保活补丁，整体单 WebView SPA」）**——`#app[data-view]` 双视图（list/conversation 同文档切换零销毁），桥协议第四域（sessionList/viewState 下行、listAction 十一项上行），ChatConversationPanel 常驻+去 key 强制重挂，sessionKey 驱动重置链。spec 详见 `spec-session-list-webview.md`。
2. **进出会话四层卡顿攻坚 + tab 白屏**（快照分片中止/view-cache 窗口化/chip 升级轮延迟+弃权/首帧错峰/detachInactiveScreens=false）——方法论沉淀 `exit-jank-fix-playbook.md`。
3. **CodeMirror 长按连删卡顿**（回滚回环根因）：RN 侧 lastUpstreamTextRef 断回环（基线 `{text, path}` 结构体）+ web 侧 rAF 合帧 + blur 同步 flush 收口（保存路径 blur 后落盘）。
4. **键盘顶起消息迟到上跳**：scroll.ts ResizeObserver 盯 #scroller，尺寸变化 nearBottom 即贴底跟随；非贴底一像素不动。
5. **键盘抬起残影**：dock padding 切换 200ms CSS transition + 首帧豁免（`dock--animated` 挂载前先摘、重挂同路）。注：该修复的 CSS 消费段随 4c995f6b 的大 CSS 重写才落进 HEAD——af763a77 单提交不含消费段，二分排查勿单独 cherry-pick。

## 需求来源

非标准 PRD 输入：用户口述（2026-10-01 三轮确认），需求确认记录见 `docs/apm/memory/20261001-chat-webview-unify-spec.md`。核心诉求与拍板：

1. **中档路线**（2026-09-30 WebView 盘点后的三档路线拍板，记忆 `20260928-context-usage-token-perf.md:356/368`）：转录 + 输入框合成**一个 WebView 页面**，RN 侧单实例承载整个对话视图，桥协议收敛一套。
2. **范围边界**：设置页与「我的」tab 保持 RN 原生不动（判据：流式重内容渲染 + 富文本/代码编辑进 WebView，导航/表单/设置留 RN）。
3. **UI 一致性硬验收**：WebView 化后 UI 与现网一致——逐屏截图对比 + 接缝行为专项（键盘顶起/滚动联动/分界排布/划词菜单）。

前置条件已就位：composer-webview 迭代已并入 main（v1.5.28，输入框 WebView 化 + IME 趟雷 + 资产管线第 4 包基建）。

## 设计目标

1. **单 WebView**：对话 tab 的聊天面板（转录 + 输入框 dock）由两个原生 WebView 实例（ChatTranscriptWebView + ComposerInputWebView）合并为一个，加载新合成包 `chat-conversation`。
2. **布局同文档**：转录区与输入框 dock 在同一文档内 flex 布局——输入框高度变化（打字换行）在文档内部消化（转录区 flex:1 自动收缩），**消灭高度跨桥滞后**（现网高度链 = 跨桥上报 1 跳 + 80ms `withTiming` 缓动，`ComposerInputWebView.tsx:58-62`——这是本迭代有代码级硬证据的核心收益）。
3. **桥协议收敛（主链）**：chat tab 主链的下行/上行消息收敛为一套 v2 协议（单 `init`、单 `ready`、单 `themeUpdate`、能力协商扩全集）。
4. **性能收益（按实测口径修正）**：
   - 省掉一个小 WebView 实例化与其 21KB 文档解析（量级几十 ms；composer 产物 21,826 B vs 转录 8,863,572 B——**「进入成本减半」不成立**：现网双实例同渲染提交并行挂载，墙钟 ≈ max 而非 sum，主导项始终是 8.86MB 转录 bundle 的解析）。
   - 键盘动画期间原生 relayout 每帧 2 个 WebView → 1 个。
   - typeahead 的 query 计算与点选插入从跨桥时序变为同文档函数调用（见 §桥协议 v2 · typeahead 自治；注意：**打字的 `change` 仍是每键一条上行消息，本迭代不消除**——打字真源在 web 的防线要求如此）。
5. **UI 与现网一致（硬验收）**：视觉逐项复刻（样式数值单源迁移 + 样式相等断言 + 真机截图对比）；行为接缝专项清单验收（含划词菜单方案，见 §划词菜单）。

### 非目标（明确不做）

- **实例保活/池化**（小档路线内容）：`chatSubview` 条件渲染卸载机制保持不变，重进会话仍付一次冷启动。挂账后续迭代。
- **子会话屏（SubagentSessionScreen）**：继续走旧链（chat-transcript 包 + 既有 ChatTranscriptWebView 组件）。注：`ChatTranscriptWebViewHandle` 类型搬家波及该屏**一处直接 import 改路径**（`SubagentSessionScreen.tsx:35`，r2 已实测核实），除此之外零改动。
- **宏内联链（PromptMacroTextInput）**：继续用 composer-input 包与 `ComposerInputWebView` 组件，RN 侧零改动；`editor.ts` 内三处触碰全部以 `heightReport` 为条件、宏链取默认 `true` 故行为零变化（口径见 Step 1）。
- **B/C 面**（CodeEditorWebView / RichDocumentWebView）与 rich-document 域：不碰。
- **设置页 / 「我的」tab / 桌面端 / core**：不碰。
- 退出卡顿的另一半（ChatSessionListPanel 整列表重渲染）不在本迭代治。

## 总体方案

### 架构：B+ 合成包 + dock 全进文档 + 协议 v2 + 旧链保留

**为什么不是「目录搬迁合并」**：chat-transcript 与 composer-input 两包 runtime 零交叉 import（唯一耦合 `shared/*`），但 10 个测试文件直 import 两包源码路径（r3 实测核对：attachment-chip-label / chat-transcript-ref-token / chat-transcript-row-window / chat-transcript-snapshot-chunk / collapsible-section-classes / composer-input-bridge / composer-input-dom / message-menu-entry / rows-click-anchor / stream-block-split）——搬迁目录 = 测试面全量重写。采用**薄合成包**：新建 `src/web/chat-conversation/`，入口仅做装配（import 两包抽出的 runtime 工厂），两旧包目录与产物原样保留（子会话屏、宏链、绝大多数测试继续吃旧包）。

**为什么 dock 全区进文档（而非只搬 textarea）**：现网 ChatComposer 的 box 是单一视觉容器（`styles.box` 背景 + 边框 + 圆角），内部纵向排 [状态 chips] → [input] → [toolbar 行]。中间横切 WebView 会切断容器视觉，无法满足 UI 一致性硬验收。故整个 box（chips + input + toolbar + typeahead 浮层）在合并文档内复刻；**FileReferencePicker / SkillPicker（RN 全屏 Modal）与发送决策逻辑留 RN**。

**旧组件逐文件裁决**（r1-P2-3 修正：三者命运不同）：

| 文件 | 裁决 |
|---|---|
| `ChatComposer.tsx` | chat 链退役（逻辑拆入 `useChatComposerController`；文件可删或留空壳供 revert） |
| `ComposerAtPathInput.tsx` | chat 链退役（宏链/全屏不引用它，可删） |
| `ComposerInputWebView.tsx` | **不退役**——宏链活依赖（`PromptMacroTextInput.tsx:39/42/43/157` 直 import 组件与 handle 类型），仅摘除 chat 链引用 |

**文档布局**：

```
#app (display:flex, flex-direction:column, height:100%, min-height:0)   ← 四属性缺一 dock 不贴底
├─ #scroller (flex:1, min-height:0, overflow-y:auto)   ← 既有转录滚动容器；由 height:100% 改 flex:1
│   └─ #rows / #stream-tail
├─ #composer-dock                                       ← 复刻 styles.box + styles.dock 的容器
│   ├─ [hintRow]（!hasModel 时的「请先选择工作区模型」行，可点 → dockAction.needModel；styles.hintRow marginBottom:6）
│   ├─ [error]（composerState.error 非空时的报错文本行）
│   ├─ chips 行（状态 chip 列表，桥下发；纯展示不可点——与现网一致）
│   ├─ typeahead 浮层（absolute，锚定 dock 内 input 上缘；web 侧自治，见桥协议）
│   ├─ input（透明 textarea + 高亮层，复用 composer-input runtime；挂载 id #composer-input，
│   │        与旧包 #root 不同名，createComposerRuntime 的 host 参数指向它）
│   └─ toolbar 行（spacer + ⛶ + @ + $ + 发送/终止）
#menu-portal（body 直接子级，保留——fixed 定位包含块语境不变，勿移入 #app）
#mermaid-viewer-portal（body 直接子级，保留——同上；#app 只包 scroller + dock）
```

**键盘与 dock padding 归属（r2-P0-1 定案 / r3-P2-4 修正：RN 侧信号下发，web 纯样式）**：controller 保留 `useReanimatedKeyboardAnimation()`（跨平台 hook，现网 `ChatComposer.tsx:123` 无条件使用），把键盘态经 `composerState.keyboardUp`（布尔）下发、`init.composer.safeAreaBottom` 随 init 下发；web 侧纯样式应用 `padding-bottom = keyboardUp ? 0 : max(8, safeAreaBottom)`，**不做键盘态自判**——web 侧 visualViewport 自判方案已废弃，理由：Android 的 `AndroidKeyboardClipBody` 以 `marginBottom:-keyboardHeight` 在 RN 侧裁切容器，键盘高度根本不进 WebView 视口，`vv.height` 与 `innerHeight` 同步缩小、差值恒 0，判不出弹起；而「键盘弹起时 padding 归零」是现网已修的白条 bug 防线（`ChatComposer.tsx:121-128` 注释），自判方案等于把它带回来。**iOS 分平台现状（r3-P2-4 核实）**：iOS 无容器级避让（无 AndroidKeyboardClipBody 也无 KAV，`KeyboardProvider` 只提供 hook），现状 composer 即被键盘部分覆盖、padding 归零仅消除白条——本迭代**保持等价**（接缝验收按分平台预期核对）。Android 的 `AndroidKeyboardClipBody` **保留**（继续裁切单 WebView 容器，与 web padding 职责互补：clip 管视口收缩、padding 管 dock 底部余量）；`styles.dock`（paddingHorizontal:12 / paddingTop:4 / paddingBottom:8 / `tokens.background` 实底）与 `styles.transcriptHost` 的 `flex:1,minHeight:0` 语义全部迁入文档 CSS。T-CU14 锁「键盘弹起时 dock padding 归零」。

### 桥协议 v2（新包单通道）

信封沿用 `{v, type, payload}`，**下行信封桥版本 = 2**（结构变更防旧 dist 混淆；上行 v 号策略见 §合成 dispatcher 契约第 1 条——runtime 上行保持 v:1，v:2 仅用于新包自有的 ready/dock 上行；新包常量命名 `CONVERSATION_BRIDGE_V = 2`，以免与旧包 `BRIDGE_V` 重载歧义）。冲突消息消歧方案：

| 冲突点 | 现网 | v2 方案 |
|---|---|---|
| `init` 双 schema | transcript {theme,flags} / composer {mode,disabled,theme,metrics,placeholder} | 聚合单 `init`：`{theme, flags, composer:{disabled, metrics, placeholder, safeAreaBottom}}` |
| `themeUpdate` 双 schema | transcript 7 键（含 danger/surface/borderLight）；composer 6 键（含 primaryMuted/selection）——**并集 9 键** | 单 schema 9 键超集，一次下发全文档生效。落点：`shared/host-theme.ts` 的 `HostTheme` **补 `selection` 一键**（`primaryMuted` 已存在于 `:22/:34`）+ **`THEME_VARS` 表同步加 `selection → --selection`**（否则 `::selection` 回落 `--primary-muted` 变色）；composer-input 旧包的 `applyTheme` 直写并行分支保留（旧链不动），新包统一走 `applyHostTheme`；`editor.ts:389-390` 的过期注释顺手修正 |
| `ready` 双 payload | transcript {version:'m4',capabilities,readyState} / composer {version:1} | 单 `ready`：`{version:'u1', capabilities, readyState}`，capabilities 扩全集 |
| `blur` 双向同名 | 本就靠方向区分 | 维持方向区分，type 原名保留 |

**`composerState`（下行，dock 域聚合状态）完整字段表（r1-P0-1 闭合）**——controller 在 RN 侧算好一切派生值再下发，web 不做业务推导：

| 字段 | 类型/来源 | 驱动的 web UI |
|---|---|---|
| `inputDisabled` | controller 由 `!hasModel \|\| running \|\| lastMessageIsPlainUserText` 派生（现网 `ChatComposer.tsx:540` 同式） | typeahead 开合、input `editable`、@/$ 按钮禁用（现网消费点 `:577/:582-583/:599/:629/:637`） |
| `hasModel` | controller 持有 | **hintRow 显隐判据**（`!hasModel → 「请先选择工作区模型」行可点 → dockAction.needModel，现网 `:553-559`）——不能用 inputDisabled 代替（它是超集，运行态下会误显 hintRow） |
| `sendDisabled` | controller 派生（现网 send 禁用式） | 发送按钮置灰 |
| `running` | unitView?.status 派生 | 发送/终止按钮形态与配色（`running→danger 底+TerminateIcon`） |
| `error?: string` | controller 的 `setError` 两处来源（`:395/:413`） | dock 顶部报错文本（现网 `:561-563`）——缺失即功能回退 |
| `fullscreenEnabled` | `onOpenComposerFullscreen != null`（现网 `:617-620` 置灰 ⛶） | ⛶ 按钮禁用态 |
| `placeholder` | 现网 inputPlaceholder 链 | input placeholder |
| `chips` | `projectComposerStatusForSession` 整表替换 + annotate ∪（现网状态 chip 数据链原样） | chips 行渲染（**纯展示、不随 inputDisabled 变灰**——现网 `AttachmentDraftChips` 的 `disabled` 是透传后未使用的死参数，不要顺手实现成置灰） |
| `keyboardUp` | controller 从 `useReanimatedKeyboardAnimation()` 派生 | dock 底 padding 归零/恢复（见键盘定案） |
| `typeahead` | `{files: 工作区行列表, skills: 技能列表}`——**候选源**（非过滤结果）；RN 在**进会话与技能变更时**拉取下发（`runtime.workplace().buildListRows()` 过滤目录、`runtime.skills().effectiveSkills()`）。（r6-A1 方案 B 收窄，2026-10-02 回填：原「工作区变更（vfsMutated 事件）」承诺撤回——用户侧 VFS 写链零事件发布，core workplace 缓存架构决议为「失效完全依赖读时校验、不挂写路径钩子」，新建订阅基建超本迭代范围；候选源在工作区变更后的陈旧度见风险表） | typeahead 的 query 过滤与渲染在 web 侧做（见下） |

**`dockAction`（上行）枚举（r1-P0-2 闭合）**：`send | terminate | needModel | fullscreen | atPicker | skillPicker`。
- `needModel`：现网 `send()` 首分支 `if (!hasModel) { onNeedModel(); return; }`（`ChatComposer.tsx:504-506`）的载体。
- typeahead 点选**不在枚举里**——点选由 web 自治完成（见 typeahead 自治），无跨桥。
- ~~chip 操作~~：删除（现网无此交互，r1 审查确认系臆造）。

**typeahead 自治（r1-P0-13 定案：web 内计算；r2-P1-1 补前置抽取）**：`findActiveAtQuery`（真源 `@novel-master/core/chat`，RN 侧经 `composer-at-path.ts` re-export）与 `buildTokenInsertion`（`components/chat/composer-token-insert.ts` 纯函数）经 webAlias `@` 进入 web bundle（core 入 web 的真先例：`web/chat-transcript/webview/runtime/render/row-logic.ts:6` 已 import `@novel-master/core/chat`）。**前置抽取**：`filterSkillTypeaheadCandidates` 现定义在 `SkillTypeahead.tsx:12`（同文件 import 了 react-native，直接入 web bundle 会拖进 RN 组件树），须先抽到 `components/chat/skill-typeahead-filter.ts` 纯 .ts，`SkillTypeahead.tsx` 改 re-export（宏链/全屏屏零改动）。打开判据（text+cursor 都在 web editor 手里）、候选过滤、点选插入全部同文档函数调用，**零跨桥**；RN 只保留 Picker 路径（`dockAction.atPicker/skillPicker` → RN Modal → 选择后 `setText` 下发插入）。候选源经 `composerState.typeahead` 下发。**注意 es2018 约束**：这些函数入 web 前核查无 ES2021+ 运行时 API（现网 core 导出已按老内核写）。

**heightChange 的处置（r1-P1-1 修正）**：**chat 链断开**（新包 runtime 经工厂参数关闭高度上报：`createComposerRuntime` 增 `heightReport: boolean`，旧包 main 传 `true` 行为零变化，宏链活消费不受影响），非全局移除。`editor.ts` 三块逻辑裁决：`measureByClamp`/ResizeObserver 上报链在旧包保留、新包关闭；`bindViewportCaretGuard` **保留且新包同样启用**（防光标滚出的独立价值，与本迭代 dock 布局互补）。

**合成 dispatcher 契约（r2-P0-2 闭合：v 号路由 / 消息分流 / 单 ready / init 拆包）**——新包入口的统一装配规则，五条：
1. **v 号策略（r3-P0-2 裁定 / r4-P1-3 补全：上行保持 v:1，v2 身份在 ready 与 dock 域）**：两旧 runtime 的 `BRIDGE_V = 1` 硬编码**不动**（`chat-transcript/webview/runtime/state/state.ts:6`、`composer-input/webview/runtime/model.ts:10`），且其 `post` 是**模块级单例**、被 6+ 兄弟模块直接 import（transcript 侧 `bind-shell-events.ts:9`/`boot-transcript.ts:6`/`menu.ts:14`/`rows-click.ts:2`/`scroll.ts:3`；composer 侧 `editor.ts:24`）——「注入替换 post 让上行带 v:2」违反零改动约束，已否决。落地形态：**运行时上行全部保持 v:1**（runtime post 单例不动）；**唯一例外**是合成入口自持一个 `createBoundPost(2)` 供 **ready 与 dock 域上行（dockAction）** 使用——新包身份标识靠 v:2 ready：宿主只认 `v===2` 的 ready（旧 dist 的 v:1 ready 被拒 → 走超时兜底/能力降级）；宿主对其余上行消息**宽容解析**（不校验 v 字段、按 type 分发；**自带宽松 decoder，禁止复用 `decodeTranscriptToHost`**——它对 `v !== 1` 直接 throw，会被宿主 try/catch 静默吞掉致 webReady 永假、落进 8s 兜底）。下行方向：入口收 v2 信封后按路由表重打包为 v1 喂对应 runtime。
2. **下行消息路由表**：host→web 的 v2 消息在 dispatcher 解析后重打包为 v1 信封喂给对应 runtime 的既有 `handleHostMessage(raw)`（runtime 内部零改动；重打包成本低——composer 域下行仅程序化写入时才有）。路由：`themeUpdate`（9 键超集）**fan-out 三方**——transcript runtime + composer runtime（各自经 `applyInit`/`applyTheme` 消费同一份超集，与 dock 侧 `applyHostTheme` 都写 documentElement、键集互为超集不漏键）+ dock 自有 handler（r5-P1-1 补）；transcript 域（sessionSnapshot/prependPage/appendTailRows/stream 族/flagsUpdate/closeMenu/closeMermaidViewer——**`stickIfNearBottom` 自本轮起不在路由清单内**：该 type 自 BASE 起即无生产方（`keyboardLiftNonce` 恒 0 死 prop），已从 transcript 域 type 清单移除，避免带副作用的死协议面）→ transcript runtime；composer 域（setText/setSelection/setDisabled/blur）→ composer runtime；dock 域（composerState/composerPaste/**selectAll**）→ dock 自有 handler（合成包内新增，不经旧 runtime；`selectAll` 为 web handler 内执行——见划词菜单小节）。
3. **上行消息路由表（r3-P1-1 补全）**——宿主按 type 分发（宽容 v）：`ready`（**仅认 v:2**，见第 1 条）→ webReady 置位；`visibility` → repaintEpoch 脏计数链；`scrollSnapshot`/`loadOlder` → 滚动缓存/分页；`openMessageMenu` → MessageActionMenu 门控（含 `uiRunning` 守卫，现网 `ChatTranscriptWebView.tsx:1399-1410`）；`messageMenuAction`/`menuOpened`/`menuClosed` → 菜单动作（安全守卫归属：rollback/fork/set-floor 在宿主回调）；`openToolFile`/`openSubagentSession`/`openSkillDetail`/`linkClick` → 导航回调；`mermaidViewerOpened`/`mermaidViewerClosed` → BackHandler 链；`copyCode` → 剪贴板；`change`/`selectionChange`/`focus`/`blur` → controller 的草稿/光标链（M1/M4/M5/M6 防线落点）；`dockAction`（send/terminate/needModel/fullscreen/atPicker/skillPicker）→ controller。
4. **单 ready 抑制 + 装配闸门**：`emitReady?: boolean` 进两工厂参数（旧包 main 传 `true` 行为零变化）；合成入口传 `false`，待两 runtime 均 boot 完成后由入口用 v2 post 发**单条** ready（含 capabilities 全集——`version:'u1'`）。composer 旧 main 的顶层 `post('ready')`（`composer-input/webview/main.ts:19`）随薄入口化收进工厂的 emitReady 分支。**装配未成功则不发 ready**：入口须先确认 composer runtime 已挂上（`createComposerRuntime` 返回值非空）与 dock 元素已命中（`dock.mount()` 返回 true）——任一不成立即 `console.error` 中文诊断后 return，由宿主 **T-CU15 的 8s ready 超时兜底**落错误态（不可绕开白屏防线，也不用摘能力位的软降级代替）。判据收敛为纯函数 `shouldEmitConversationReady({composerMounted, dockMounted})`（真值表单测）；配套 `dock.mount()` 改为返回 `boolean`（原 void + 命中失败静默 return 是漏报根因）。
5. **聚合 init 拆包点**：v2 init `{theme, flags, composer:{mode:'composer-token', disabled, metrics, placeholder, safeAreaBottom}}` 在 dispatcher 拆成两份 v1 形状——transcript 喂 `{theme, flags}`、composer 喂 `{mode, disabled, theme, metrics, placeholder}`（theme 用同一份 9 键超集，composer 的 `applyInit` 读它需要的键、多余键忽略；`safeAreaBottom` 由 dock handler 消费，不下喂 runtime）。

**deferred 语义（r1-P0-3 修正——原 T-CU7 表述是错的）**：composer 域消息（`setText`/`composerState`）与 dock 上行**不进** `postOrDeferSnapshotPaint` 的 deferred 队列，走直发。理由：deferred 的唯一目的是防 `applySnapshot` 整体替换 rows 时抹掉增量行（`appendTailRows/prependPage/streamCommit` 三类才需要），composer 域不触碰 `state.rows`；若误 defer，快照分片窗口（40 条会话 ~1.15s）内用户无法打字，且重挂时 deferred 队列整队丢弃（`ChatTranscriptWebView.tsx:960-967`）会造成草稿静默丢失。风险表已记。

**能力协商与降级纪律（r1-P0-8 闭合）**：
- 「**未声明 = 不支持**」硬约定整段继承（`transcript-capabilities.ts:3-7` 注释是该约定的权威表述，迁移时保留原文）；新增能力位标识 `composer-dock`（**不进共享常量数组**，归属见下条；判定函数的显式循环风格保持，为老内核）。
- 能力清单文件**留在 `web/chat-transcript/transcript-capabilities.ts`**（避免动双端 import 面），模块头补「chat-conversation 共用」注记；**`composer-dock` 能力位不写进共享常量数组**（否则旧 chat-transcript 包的 ready 也会带上该位、「未声明即降级」防线对旧包失真）——由新合成包入口构造 capabilities 时并入。
- 未声明 `composer-dock` 时 RN 侧行为：**不下发 dock 域消息 + 输入区渲染降级提示**（「输入组件版本过低，请重启应用」类文案）——不是静默不可点。**可观测性清单（新增一支）**：`composer_dock_degraded` 遥测事件——`ready` 到达但 capabilities 不含 `composer-dock` 时上报（一次），用于线上区分「旧 dist / 能力位没带 / ready 没来」三类输入框消失根因（与 §合成 dispatcher 契约第 4 条的装配失败 `console.error` 诊断互补：那管包内、这支管宿主侧能力协商）。
- 白屏缓解（修正方向）：单点白屏的成因链是「旧 dist 发不出 v2 ready → webReady 永假 → 全部下行丢弃」。缓解 = **RN 侧 ready 超时兜底**（WebView **onLoad 后** 8s 未收到 v2 ready → 渲染错误态 + 提示重载——兜底锚在 load 事件而非 init：init 本身要等 ready 才发（`ChatTranscriptWebView.tsx:1487-1491`），锚 init 是时序死锁；T-CU15 锁定），而非依赖 ready 门控本身。

**划词菜单（r1-P0-14 定案）**：`menuItems` 是 WebView 实例级，合并后单实例只有一套。方案：**扩为三项 `[复制, 全选, 粘贴]`**——
- 复制：沿用现行链（`\u00a0→空格` + trim 清洗 + `uiRunning` 禁复制）。已知外溢（记入风险表）：运行中输入框选词复制同被禁（Android 回调不带 DOM 上下文，无法区分选区来源；保留转录区行为优先）。
- 全选：宿主收菜单点击后**下行 `selectAll`**（dock 域路由，r4-P1-2 补通道）→ web handler 执行——`activeElement` 为 textarea 则 `textarea.select()`，否则 `window.getSelection().selectAll()`。`chat-transcript-selection-menu.ts` 扩三项 + `handleCustomMenuSelection` 按 key 三分支（copy 现行链 / selectAll 下行 / paste 读剪贴板后下行 `composerPaste`）。
- 粘贴：RN 侧读剪贴板（**复用既有依赖** `@react-native-clipboard/clipboard@^1.16.3`，`apps/mobile/package.json:44` 已在——非新增）→ 下行 `composerPaste{text}` → web 插入（textarea 聚焦则光标处，否则先聚焦再插入，`suppressChange` 包裹走 change 上报）。**粘贴与 `inputDisabled` 同口径门控**：运行中/禁用态（`inputDisabled` = `!hasModel || running || lastMessageIsPlainUserText`）不可粘贴——宿主侧与复制项同样前置 `uiRunning` 守卫，web 侧 `composerPaste` 分支再加一道 `inputDisabled` 闸（能不能写的真源以 `composerState` 为准）。这是对齐现网 RN `TextInput` 的既有行为：`editable=false` 时原生粘贴本就进不来，不能因为换成 WebView textarea 就把它放开（否则会向禁用输入框注入文本、落库成草稿并被下一轮发出）。
- 效果：输入框保住复制/全选/粘贴（现网原生菜单的核心三项）；转录区行为不变（多了全选/粘贴两个可用项，无害增益）。
- UI 一致验收项：真机核对输入框长按菜单三项可用、复制内容与现网等价（nbsp 清洗口径一致）。

**IME / 选区防线（r1-P0-12 闭合：7 条机制逐条落点）**——现网防线全量继承，ref 归属明确：

| # | 机制 | 现网位置 | 合并后落点 |
|---|---|---|---|
| M1 | `lastValueRef` 差分基线：**先推进再上抛**（父层 value 回声不得被判外部写入） | `ComposerAtPathInput.tsx:152/185-191` | 宿主 `ChatConversationWebView`（接收 change 的第一层） |
| M2 | `setText` 外部写入**作废选区基线** | `ComposerInputWebView.tsx:329` | 宿主（下发 setText 的 effect） |
| M3 | web 侧 `lastSelection` 去重 + `lastText` + `suppressChange` | `editor.ts:222-223/313-331/455` | web runtime（原样，不动） |
| M4 | `lastSelectionRef` 回声抑制 | `ComposerInputWebView.tsx:184/256-263` | 宿主 |
| M5 | `pendingSelection` 短暂受控 | `ComposerAtPathInput.tsx:154-155/168-175/202` | 宿主 |
| M6 | 打字真源在 web：`change` 只上抛**不回写** | `ComposerInputWebView.tsx:249-255` | 宿主（上行处置处） |
| M7 | **命令式 `setText`（`replaceCommittedText` 路径）反向不置 null**——与 effect 版 setText 的基线规则相反（带选区的程序化写入要落到指定光标） | `ComposerInputWebView.tsx:373-397`（8 行注释解释） | 宿主（命令式 API 上）；**不得顺手统一** M2/M7 的相反规则 |

**bindHostMessageChannel 单次注册（r1-P0-6 / r2-P0-3 闭合）**：两旧 runtime 现都在自绑（`boot-transcript.ts:33-40` 无条件绑、composer `main.ts:17` 顶层绑），且 `bindHostMessageChannel` 无幂等守卫（document+window 双 listener）——双绑定会导致 `onRowsClick` 双发 `messageMenuAction`。工厂契约：`createTranscriptRuntime({bindChannel?, emitReady?})`（**无 post 参数**，同 §兼容与迁移——工厂内部直接 import 模块级 post 单例；两参数默认 `true`、旧包行为零变化）；合成入口传 `false`，由入口统一调一次 `bindHostMessageChannel(合成 dispatcher)`。**工厂体放各包 `webview/runtime/factory.ts`**（r2-P0-3：旧 `main.ts` 同时是旧包构建入口且带顶层副作用——ESM import 即执行，工厂留在 main.ts 会让新包 import 时双 boot/双注册/双 ready；旧 `main.ts` 退化为薄入口，详见 §兼容与迁移）。T-CU3 断言扩展到 `bindShellEvents`（listener 双挂用 scroll/click 回调计数验证）与 `registerRenderRows`/`registerRenderContextMenu`（后写覆盖前写——断言仅注册一次）。

**能力之外的既有协议语义**：`webReady` 门控一切下行（未 ready 零下行，T-HOST10 等价迁移）；`sessionSnapshot` 分片字段分布（`sessionKey/hasMore/generating` 每片重复、`scrollIntent/restoreScroll` 仅末片、`generation` 单调、`chunkTotal=1` 等价旧单包）原样；`SNAPSHOT_CHUNK_SIZE=50` / `SNAPSHOT_CHUNK_BYTES=256KB`（UTF-8 真字节口径）原样。

**CSS（r1-P0-5 定案：合成包自持 CSS，不做数组 join）**：新包**自持一份** `styles/chat-conversation.css`——以 `transcript.css` 为基底（保留 `__RICH_CSS__`/`__MERMAID_FULLSCREEN_CSS__` 两个占位注释），把 composer-input.css 中 dock 相关规则（`::selection`、token 胶囊、输入区样式）移植进来；**丢弃** composer-input.css 的 `html,body{background:transparent}` 段（与 transcript 的 `html,body{background:var(--bg)}` 直接冲突）。由此 `build-webview.mjs` 的 `cssRel` **保持单值**（无需数组扩展），只新增 PACKAGES 条目：`{id:'chat-conversation', entryRel:'chat-conversation/webview/main.ts', cssRel:'chat-conversation/styles/chat-conversation.css', htmlRel:'chat-conversation/index.html', richCssKey:'CHAT_TRANSCRIPT_RICH_CSS', mermaidFullscreenCss:true}`（entryRel 相对 `src/web` 解析、须带包名前缀——实现时修正的简写笔误）。漂移风险（两份 CSS 各自演化）记入风险表。`PACKAGES` 形状扩展项（原 Step 2 的 `cssRel: string[]`）**取消**。

**repaintEpoch 重挂与恢复链（r1-P1-16/17 闭合）**：visibility 脏推送重挂机制保留（触发主路径=进出子会话屏）。合并后重挂代价放大（丢整页含 IME 组合态）——缓解与定案：
- 草稿文本：打字每次 `change` 上行即由 controller `persistDraft` 落库（现网同款），重挂后 ready → 下行四消息：`init` → `composerState` → 草稿 `setText` → 快照直发，**固定顺序**（写入 Step 6 契约）。文本不丢；**IME 组合态（未上屏拼音 buffer）丢失**——记入风险表，接受（重挂是子会话往返的低频路径）。
- typeahead 展开态重挂后关闭 = **预期行为**（非退化，判据 `activeAt` 依赖的 cursor 已重置）。
- 会话切换重挂（`key={chatScrollKey}` 变化）与 visibility 重挂共用同一条四消息恢复链（T-CU8 拆两个子用例分别锁）。

**返回键层级（r1-P1-19 定案）**：`useAndroidChatBackHandler` 优先级链不变（mermaid 全屏第一 → drawer/menu/messageEdit/pickers → backFromConversation）。**typeahead 浮层与划词原生菜单不参与返回键链**（与现网一致：现网 typeahead 是 RN View 时返回键同样直接退出会话）——写明防止实现者误补拦截。

**滚动贴底口径（r1-P1-18 修正）**：`keyboardLiftNonce` 现网是**无生产方的死 prop**（声明/消费 effect 存在但 `ChatConversationPanel` 从不传值，恒 0 早退）——即现网键盘顶起**本就不自动贴底**。本迭代：删除该死 prop（变更点列入清单），接缝验收项改写为「**验证键盘顶起后转录不自动贴底（与现网一致）**」，不承诺修好贴底。

**`#scroller` 改 flex:1 的连带（r1-P1-15/20）**：`emitScrollSnapshot` 的 `clientHeight` 语义随 dock 高度变化（滚动缓存读数口径变化）——风险表记行；dock 高度由 80ms 渐变改为帧内瞬变，`row-windowing` 的贴底守卫（按渐变节奏写的）补一条 `scrollSnapshot` 抖动回归观测用例（T-CU13）。

### RN 侧组件重组

- **新组件 `ChatConversationWebView`**：合并两宿主职责——转录侧（快照分片、流式三通道、能力协商、repaintEpoch/visibility 重挂、滚动缓存恢复）+ composer 侧（草稿 setText、程序化写入、dock 状态下发、dockAction 处置）。`memo` 比较器 `chatTranscriptWebViewPropsEqual` **同步扩展**（composer 域新 props 逐个入列——漏加会静默吞更新，现网已有 `pendingSubagentSessions` 单列的踩坑史）。
- **`ChatTranscriptWebViewHandle` 类型搬家（r1-P0-11）**：类型从 `ChatTranscriptWebView.tsx:92-117` 内联迁出到新文件 `src/components/chat/ChatTranscriptWebViewHandle.ts`；**方法面（7 方法）不变**，`session-stream-webview-adapter.ts:14` / `ChatTabProvider.tsx:31` / `useInterruptedPartialCommit.ts:19` / `SubagentSessionScreen.tsx:35` **四处** type-only import 改路径（各 1 行；r2 实测核对——比 r1 多出子会话屏一处直接 import）。「句柄搬家链零改动」修正为「**句柄方法面零改动，类型定义搬家**」。
- **`useChatComposerController`（r1-P2-6 改名，对齐 hook 惯例）接口清单（r1-P0-10 闭合）**：

| 成员 | 职责（现网出处） | 去留 |
|---|---|---|
| `executeRun` / `send`（三分支：needModel / 空输入 canResume / 正常发送） | `ChatComposer.tsx:327-422/:500-538` | 保留（send 三分支整体保留在 controller） |
| `persistDraft` / `commitComposerText` | `:237-249/:255-272` | 保留（change 上行 → persistDraft 链） |
| Picker 路径 token 插入（`insertTokensIntoComposer` / `insertSkillToken`） | `:424-435/:469-478` | 保留（Picker 选择 → setText 下发） |
| typeahead token 插入（`applyTypeaheadToken` / `applySkillTypeaheadToken`） | `:440-466` | **随 web 自治移除**（web 内完成） |
| 草稿三订阅链（水化 / `subscribeChatComposerDraft` / `subscribeChatAnnotateDraft`） | `:274-325` | 保留（水化 → setText 下发） |
| 候选拉取两 effect | `:166-217` | 保留但输出改 `composerState.typeahead` 下发（候选源） |
| `pickerOpen` / `skillPickerOpen` + 两 RN Modal | `:664-679` | 保留（Modal 留 RN） |
| `error` state | `:395/:413` | 保留（经 composerState.error 下发） |
| `useReanimatedKeyboardAnimation()` → `keyboardUp` | `:123-129` | **保留**（派生布尔经 `composerState.keyboardUp` 下发——派生方式 `useAnimatedReaction` + `runOnJS` 仅在布尔翻转时 setState，禁每帧 JS 读 SharedValue；**移除的只有 `dockPaddingBottom` 的 `useAnimatedStyle` RN 侧 padding 动画**） |
| `activeAt` / cursor 镜像 / typeahead 开合 state | `:159-217` | **移除**（web 自治） |

- **`ChatConversationPanel`**：`AndroidKeyboardClipBody` 内 `{chatTranscript}{chatComposer}` 双子节点 → 单 `<ChatConversationWebView>`；chatHeader（ChatMetaBar/指标条）仍 RN；`styles.transcriptHost` 的 flex 语义移入文档 CSS。
- **legacy 转录引擎开关退役（chat tab，Q1 已确认退役并执行 `dc4c903b`）**：清理面全景（r1-P1-5）：`ChatTabProvider` 7 处 `useWebviewTranscript`（`:128/242/247/300/324/494/540`）+ `useChatTabStream` 双引擎滚动缓存分流（`:22/28/45/58/60/71/75/79`）+ `useChatTabController`（`:75-87/144-147`）+ `ChatConversationPanel`（`:68/220/401` MessageList 分支与 MessageActionMenu 门控）+ `storage/chat-transcript-engine.ts`（键读取保留、值忽略+注释更新）。`useWebviewTranscript` 派生变量**删除**（保留即每次 mount 多一次 KKV 死读）。`MessageList.tsx` 及 `message-list-scroll.test`/`message-menu-entry.test` 的去留随 Q1 拍板一并定。

### 兼容与迁移

- 旧包不删：`chat-transcript`（子会话屏 + 转录域测试）、`composer-input`（宏链 + composer 域测试）继续独立出包。新包是第五个 asset 包。
- **资产管线注册点共六处（r1-P1-8 起五处 + fix-cr 补第六处）**：① `build-webview.mjs` PACKAGES 条目（cssRel 单值，见 CSS 定案）；② `webview-asset-uri.ts` 包 id 联合类型 + 新 `webview-host/chat-conversation/uri.ts`；③ `src/web/tsconfig.json` include；④ android assets / iOS WebViewDist 落点（`copyDistToNativeSinks` 按 id 自动覆盖）；⑤ **iOS `project.pbxproj` 的资源校验 `-f` 清单**（`:200`，现状只列三包、连 composer-input 都漏——本迭代补 `chat-conversation` 与 `composer-input` 两条）；⑥ **Android `android/app/build.gradle` 的 `checkWebViewAssets` 守卫包清单**（`:176-199`，preBuild 依赖的守卫任务逐包查 `index.html`/`app.js`/`app.css`；漏登记则干净 clone 出包缺该包资产而守卫不响——本迭代补 `chat-conversation` 一条，守卫清单与 pbxproj 同为五包）。
- **前置修复（r1-P2-2）**：当前 android assets 与 iOS WebViewDist 实际只有 3 包（上次 `build:webview:native` 跑在 composer 合入前）——Step 2 先重跑 `build:webview:native` 让 4 包齐全，再做新包，避免把陈旧落点带进验证。
- `readWebViewDistFile` 的 pkg 联合类型扩到 5 包（顺带补 `code-editor`——现状 `code-editor-boot-script.test.ts:7` 传 `'code-editor'` 已是类型不匹配，靠 `tsconfig.build.json` exclude `__tests__` 逃过检查）。
- 转录 runtime 与 composer runtime **工厂化**：`createTranscriptRuntime({bindChannel?, emitReady?})` / `createComposerRuntime(host, {heightReport?, bindChannel?, emitReady?})`（**无 post 参数**——工厂内部直接 import 模块级 post 单例，对齐现 main.ts 用法、不替换 runtime 内部任何东西），工厂体放各包 `webview/runtime/factory.ts`（r2-P0-3 修正：旧 `main.ts` 是旧包构建入口（`build-webview.mjs` 的 `entryRel`）且顶层副作用——`registerRenderContextMenu`/`registerRenderRows`/`startTranscriptBoot()` 与 `mountComposerEditor`/`bindHostMessageChannel`/`post('ready')`——ESM import 即执行，工厂留 main.ts 必致新包双 boot/双注册/双 ready）；旧 `main.ts` 退化为薄入口（调一行工厂 + **re-export** `mountMermaidViewerPortal`/`attachMermaidViewerDelegation` 等名字——`mermaid-fullscreen.test.ts:74-81` 的 `toContain` 字面量断言由 re-export 行满足；`code-copy.test.ts:84-100` 断言的 `bind-shell-events.ts` 路径本就不在搬迁面），旧包行为零变化（默认参数 = 现行为）。
- **装配归属表（r3-P1-4）**：旧包薄入口 `main.ts` = import 工厂 + 一行调用（默认参数）+ re-export；**全部装配动作进工厂**——transcript 侧五个（`registerRenderContextMenu` / `registerRenderRows`+`measureRowWindow` / `mountMermaidViewerPortal` / `attachMermaidViewerDelegation` / `startTranscriptBoot`）与 composer 侧三个（`mountComposerEditor` / `bindHostMessageChannel` / `post('ready')` 的 emitReady 分支）都由工厂按参数编排（`bindChannel:false` 跳过绑定、`emitReady:false` 跳过 ready）。新包合成入口 = import 两工厂 + 自建 `createBoundPost(2)`（**供 ready 与 dock 域上行（dockAction）使用**——dock handler 是新包自有代码不经旧 runtime；transcript/composer runtime 内部上行仍走各自 v:1 单例，宿主宽容解析两类都收）+ `bindHostMessageChannel(合成 dispatcher)` 单次注册 + 调两工厂（`bindChannel:false, emitReady:false`）+ dock handler 挂载 + 双 boot 完成后发单 ready。
- e2e 更新（r1-P1-3/4 补全）：`chat-transcript.page.ts` 的 `sendComposerMessage` **反向重写**（发送键进 web：web context 内点 toolbar 发送键；不再切 NATIVE）；`switchToComposerWebView` 简化为单 context 但需**判据更新**（`helpers/context.ts` 取「第一个 WEBVIEW」——Android 上同屏另有 VFS/CodeEditor/RichDocument WebView，需探测 `#scroller`/`.row.message` 确认是对话页）；`app.page.ts:217-219` 的「请先选择工作区模型」RN 文本探测改 web DOM 选择器（hintRow 进 web）；testID 双轨裁决：**统一到 web `data-testid`**（`composer-input` 已有 `editor.ts:625` 先例），RN 容器 testID 移除，e2e 与单测断言同步。
- 安全守卫（sec/D-1）：统一到新包目录前缀放行 + http/https 外跳 + 其余拒绝；`messageMenuAction`（rollback/fork/set-floor）与 `copyCode` 防线原样；划词菜单扩项后 `paste` 动作的剪贴板读取只经 RN（web 侧不读剪贴板，见划词菜单定案）。

## 最终项目结构

```
apps/mobile/
├─ scripts/build-webview.mjs                     [改] PACKAGES 增 chat-conversation 条目（cssRel 保持单值）
├─ src/
│  ├─ web/
│  │  ├─ chat-conversation/                      [新] 合成包
│  │  │  ├─ index.html                           [新] #app(#scroller+#composer-dock) + 双 portal + CSS 占位
│  │  │  ├─ styles/chat-conversation.css         [新] 自持合成样式（transcript 基底 + dock 移植段）
│  │  │  └─ webview/main.ts                      [新] 统一装配：单次 bindHostMessageChannel + 两工厂 + ready
│  │  ├─ chat-transcript/webview/runtime/factory.ts  [新] createTranscriptRuntime（main.ts 退化为薄入口 + re-export）
│  │  ├─ composer-input/webview/runtime/factory.ts  [新] createComposerRuntime（同上）
│  │  └─ shared/host-theme.ts                    [改] HostTheme 补 selection + THEME_VARS 加映射
│  ├─ webview-host/
│  │  ├─ webview-asset-uri.ts                    [改] WebViewAssetPackageId + 'chat-conversation'
│  │  └─ chat-conversation/uri.ts                [新]
│  ├─ components/chat/
│  │  ├─ ChatConversationWebView.tsx             [新] 统一宿主（含 memo 比较器扩展）
│  │  ├─ ChatConversationBridge.ts               [新] v2 协议单源（双端类型对齐 composer 模式）
│  │  ├─ ChatTranscriptWebViewHandle.ts          [新] handle 类型搬家（4 处 import 改路径）
│  │  ├─ useChatComposerController.ts            [新] 从 ChatComposer 拆出的逻辑层（接口见上表）
│  │  ├─ skill-typeahead-filter.ts               [新] filterSkillTypeaheadCandidates 纯 .ts 抽取（SkillTypeahead 改 re-export）
│  │  ├─ snapshot-chunk-bounds.ts                [新] planSnapshotChunkBounds 迁到无宿主纯模块（两侧宿主各自 import）
│  │  ├─ ChatTranscriptWebView.tsx               [改] handle 类型改从新文件 import（子会话屏继续用）+ **re-export `planSnapshotChunkBounds` 保兼容（零改动 re-export 一处）**
│  │  ├─ ChatComposer.tsx / ComposerAtPathInput.tsx  [删] chat 链退役
│  │  └─ ComposerInputWebView.tsx                [改] 仅摘除 chat 链引用（宏链活依赖，不删）
│  ├─ screens/tabs/ChatTabScreen.tsx             [改] 全屏编辑回调落点微调（在 tabs/ 下，非 chat-tab/）
│  └─ screens/tabs/chat-tab/
│      ├─ ChatConversationPanel.tsx              [改] 单 WebView 布局（**Android 与 iOS 分支同样收敛**为单 <ChatConversationWebView>）+ controller 接线 + 删 keyboardLiftNonce 相关
│      ├─ ChatTabProvider.tsx                    [改] attach 新宿主 handle；handle import 改路径；legacy 清理
│      └─ useChatTabStream.ts / useChatTabController.ts  [改] legacy 双引擎分流清理
│  └─ storage/chat-transcript-engine.ts          [改] legacy 分支退役（Q1 已拍板并执行）
├─ ios/NovelMaster.xcodeproj/project.pbxproj     [改] 资源校验清单补 chat-conversation + composer-input
├─ android/app/build.gradle                      [改] checkWebViewAssets 守卫包清单补 chat-conversation
└─ __tests__/                                    [改/新] 见测试策略
```

## 变更点清单

| # | 文件/模块 | 变更 | 依据 |
|---|---|---|---|
| 1 | 两旧包 `webview/runtime/factory.ts`（新）+ `main.ts` 薄入口化 | 工厂化（bindChannel/emitReady/heightReport 参数，旧包默认行为零变化；re-export 保字面量断言） | r1-P0-6 / r2-P0-3 |
| 2 | `src/web/chat-conversation/**` | 新合成包（自持 CSS/统一装配/单次 bind） | r1-P0-5 |
| 3 | `build-webview.mjs` + `webview-asset-uri` + `tsconfig include` + pbxproj + android `build.gradle` | 六处注册（⑤ pbxproj `-f` 清单 / ⑥ `checkWebViewAssets` 守卫包清单）+ 4 包齐全前置修复 | r1-P1-8/P2-2 |
| 4 | `shared/host-theme.ts` | selection 一键 + THEME_VARS 映射 | r1-P0-7 |
| 5 | `ChatConversationBridge.ts`（新） | v2 协议双端单源（composerState 全字段/dockAction 枚举/9 键 theme） | r1-P0-1/2/7 |
| 6 | `ChatConversationWebView.tsx`（新） | 统一宿主：分片/流式/repaintEpoch 四消息恢复链/composer 下行直发/划词三项菜单/IME 7 防线/memo 扩展/ready 超时兜底 | r1-P0-3/6/12/14, P1-2/17 |
| 7 | `ChatTranscriptWebViewHandle.ts`（新）+ 4 处 import + `snapshot-chunk-bounds.ts`（新） | 类型搬家（adapter/Provider/useInterruptedPartialCommit/SubagentSessionScreen）；`planSnapshotChunkBounds` 迁到无宿主纯模块，新宿主经它 import、旧宿主 re-export 保兼容（零行为变化） | r1-P0-11 / r3-P2-1 |
| 8 | `useChatComposerController.ts`（新）+ 删 ChatComposer/ComposerAtPathInput | 逻辑层拆出（接口表见上） | r1-P0-10 |
| 9 | `ChatConversationPanel` / `ChatTabProvider` / `ChatTabScreen` / `useChatTabStream` / `useChatTabController` | 单 WebView 布局、attach、legacy 清理、keyboardLiftNonce 删除、静态守卫词表回归 | r1-P1-5/18 |
| 10 | `storage/chat-transcript-engine.ts` | legacy 退役（Q1 已拍板并执行） | r1-P1-5 |
| 11 | `e2e/`（page objects + helpers） | sendComposerMessage 反向重写/单 context 判据/模型提示语选择器/testID 统一 | r1-P1-3/4 |
| 12 | `__tests__/` | 失效面修复 + mock 按域分流 + readWebViewDistFile 扩 5 包 | r1-P1-9 |

## 详细实现步骤

- Step 1 — phase-runtime-factory — blocking: yes — qa: auto：两旧包工厂化到 `webview/runtime/factory.ts`（`createTranscriptRuntime({bindChannel?, emitReady?})` / `createComposerRuntime(host, {heightReport?, bindChannel?, emitReady?})`——**无 post 参数**：工厂内部与现 main.ts 同款直接 import 模块级 post 单例，不替换 runtime 内部任何东西；默认参数 = 现行为；旧 `main.ts` 退化为薄入口 + re-export 字面量，见 §兼容与迁移）；**runtime 触碰点：两处装配函数加可选参数，另加旧包 `composer-input/webview/runtime/editor.ts` 三处函数体触碰（fix-cr 放宽，原口径为「仅两处装配函数」）**——装配侧两处为 `startTranscriptBoot({bindChannel, emitReady})`（`boot-transcript.ts` 的 `bindHostMessageEvents()`/`post('ready')` 两动作按参数跳过）与 `mountComposerEditor(parent, {heightReport})`（`editor.ts` 的 heightChange 上报按参数关闭）；editor.ts 三处为 ① `applyText` 在 value 变化分支派发 `composer:text-changed` CustomEvent（供 dock 监听后重渲 typeahead 浮层，旧包无人监听故无影响）② `scheduleMeasure` 开头按 `heightReport` 早退（false 时连 rAF 都不排）③ ResizeObserver 按 `heightReport` 条件注册。**行为等价护栏**：三处闸门一律以 `heightReport` 为条件，而宏链经 `ComposerInputWebView` 不传该参数 → 取默认 `true`，对宏链活链与旧包行为零变化（全仓唯一 `heightReport:false` 调用点是合成包入口），回归闸门 = 旧包 dist 契约测族全绿 + 宏链真机输入高度上报正常（Step 10 抽查）；装配侧另要求 `emitReady` 需**透传至 `bootTranscript`**（`boot-transcript.ts:36` 以 DOMContentLoaded 回调注册——闭包或再入参实现，禁模块级可变 flag），「runtime 零改动」限定为 `handleHostMessage` 解析逻辑与模块级 post 单例不动。验收：旧包 dist 契约测全绿 + `mermaid-fullscreen.test`/`code-copy.test` 装配点断言不红（re-export 行满足 toContain）+ 新增工厂参数单测（bindChannel:false 不调 bindHostMessageChannel、emitReady:false 不 post ready、heightReport:false 不 post heightChange、**runtime 内部 post 仍为 v:1 单例**——bind-shell-events/menu/rows-click/scroll/editor 上行消息头 v 恒为 1）。
- Step 2 — phase-asset-pipeline — blocking: yes — qa: auto：前置修复（重跑 `build:webview:native` 4 包齐全）；新包注册（PACKAGES 条目含 richCssKey/mermaidFullscreenCss、uri、tsconfig、pbxproj 两条、**Android `build.gradle` 的 `checkWebViewAssets` 守卫包清单一条**——六处齐改，漏 Android 一处则干净 clone 出包缺资产而守卫不响）；验收：`build:webview` 出第五包、**`gradlew :app:checkWebViewAssets` 五包守卫通过**、dist 契约测（index.html 含 `#scroller`/`#composer-dock`/双 portal 且 **portal 为 body 直接子级、`#app` 包住 scroller+dock 的结构断言**、`./app.js`、**app.css 含 `.mermaid-fullscreen-backdrop` 与 `.ref-token` 具体规则**——「占位注入不 throw」不够，r1-P1-10）、`readWebViewDistFile` 类型扩 5 包。
- Step 3 — phase-doc-layout — blocking: yes — qa: auto：文档骨架（`#app{display:flex;flex-direction:column;height:100%;min-height:0}` **四属性齐全**——缺一则 dock 不贴底、`#scroller{flex:1;min-height:0}`、dock 容器样式迁移含 `styles.dock`/`tokens.background` 实底、hintRow/error 行）；mermaid/menu backdrop 对 dock 的遮挡裁决=**接受遮挡**（overlay 全屏语义一致，返回键关闭即恢复）；`scrollSnapshot` 抖动回归观测（T-CU13）。
- Step 4 — phase-dock-ui — blocking: yes — qa: auto：dock 复刻——hintRow（!hasModel 行，marginBottom:6）与 error 行；chips 行（`AttachmentDraftChips` 样式数值迁移：chip paddingV6/paddingH10/borderRadius14/hairline/**maxWidth200**、label fontSize12/maxWidth160、**chat 走 transparentRow → 它只把 row 底色覆盖为透明、`marginBottom` 由 6 覆盖为 4；`maxHeight:36` 出自同一个 `styles.row`、是两变体共用的基底仍然生效（早前把两者读成互斥是笔误）**、content gap6/**paddingRight8/alignItems:center**；横向滚动 `overflow-x:auto` 翻译；**chips 不随 inputDisabled 置灰——现网 disabled 是死参数**）；typeahead 浮层（`TypeaheadList` 样式迁移 + web 自治：`findActiveAtQuery`/两 filter/`buildTokenInsertion` 入 web bundle + **前置抽取 `filterSkillTypeaheadCandidates` 到纯 .ts**）；input（metrics **六值常量** `{fontSize:16, lineHeight:22, paddingH:4, paddingV:6, minHeight:56, maxHeight:122}` 随 `ComposerAtPathInput.tsx` 删除须整体迁入新宿主常量——**maxHeight 122 = paddingV×2+lineHeight×5**，漏 minHeight（初始 dock 高度）或 fontSize/paddingV（行高与点击区）同样违反 UI 一致，六值全量纳入 T-CU10 断言；web `editor.ts` 的 `DEFAULT_MAX_HEIGHT=160` 是缺省兜底、宏链实际传 176、新包显式传全套六值）；toolbar（spacer+⛶+@+$+发送，36 圆钮 hairline 描边、发送态配色 running→danger）；**es2018 纪律重申**：dock 新代码禁 ES2021+ 运行时 API（structuredClone/Array.at/Object.hasOwn/replaceAll）与 lookbehind 正则。
- Step 5 — phase-bridge-v2 — blocking: yes — qa: auto：协议 v2 落地（`ChatConversationBridge.ts` 双端单源 + `CONVERSATION_BRIDGE_V=2` 双端一致断言 + composerState 全字段 + dockAction 枚举 + theme 9 键超集 + capabilities 含 composer-dock + ready 超时兜底 8s + 划词三项菜单 handler + composerPaste 链 + 剪贴板依赖接入）。
- Step 6 — phase-unified-host — blocking: yes — qa: auto：`ChatConversationWebView`（分片/流式三通道/能力协商/repaintEpoch + **ready → 下行四消息恢复链固定顺序**（init→composerState→草稿 setText→快照直发）/composer 域直发不 defer/IME 7 防线落点/安全守卫/memo 比较器扩展/handle 七方法）+ `ChatTranscriptWebViewHandle.ts` 类型搬家与 4 处 import、keyboardUp 派生接线（`useAnimatedReaction`+`runOnJS`，见接口表）。
- Step 7 — phase-rn-rewire — blocking: yes — qa: auto：`useChatComposerController` 拆层（接口表逐项）+ `ChatConversationPanel` 单 WebView 布局 + 全屏编辑回填链迁移 + 静态守卫词表回归 + **性能基线采集子步骤**（改造前先在真机采一轮现网双实例基线：进入就绪墙钟/退出 gfxinfo 窗口样本，方法见验收口径——spec 承诺「持平或改善」必须有基线可比）。
- Step 8 — phase-legacy-retire — blocking: no — qa: manual_user：legacy 清理（清理面全景见 §RN 侧组件重组；`composer-fullscreen.test` 的 `'legacy-rn'` mock 与 `chat-tab-screen.integration` 的 MessageList 断言面随本步迁移）——**Q1 已确认退役并执行（`dc4c903b`）**。
- Step 9 — phase-test-repair — blocking: yes — qa: auto：存量测试面修复（§测试策略清单）+ webview mock 按域分流 + typeahead 纯函数测试迁移归属（`composer-token-insert.test`/`composer-at-path.test` 纯函数部分保留——函数本体没删只是被 web 引用；组件级用例迁新宿主）。
- Step 10 — phase-acceptance — blocking: yes — qa: manual_user：三道全量门（mobile 全量 --maxWorkers=2 / typecheck 三处 / 相关 desktop-core 门不涉）+ 新观测面全绿；真机验收（截图对比清单 + 接缝专项：键盘顶起/输入高度/**typeahead 展开态（absolute 覆盖 vs 现网流内推挤，逐条判接受度）**/全屏回填/mermaid 返回键/发送终止/**划词三项菜单（含运行中/禁用态粘贴不可用）/chips 横向滚动/运行中输入框选词行为/滚动不自动贴底（与现网一致））+ 一次性人工验证（临时删 `#composer-dock` 构建 → ~8s 落宿主错误态，装配未成功不发 ready）+ 性能读数对比基线（口径见下）。

## 测试策略

### 存量测试处置原则

- **保留不动**：转录域全部（bridge 信封/snapshot-chunk/stream-block/row-window/scroll/scroll-cache）、composer 纯函数域（composer-input-dom/bridge T-CB 族/`composer-token-insert.test`/`composer-at-path.test` 纯函数部分）、数据链（session-stream-unit 族/view-cache/draft/prompt-editor-screen——走 code-editor 路径不受影响）、`message-list-scroll.test`（随 Q1 定去留）。
- **迁移改造**：`composer-input-webview.test`（T-HOST 族 → 统一宿主等价用例，含 T-HOST8/9/10 防线）、`composer-at-path.test` 组件级用例、`chat-composer.integration.test`（T-G/T-IME/T-CR4 → controller 层 + 桥断言）、`composer-fullscreen.test`（T-FS1 样式相等参照改文档内常量；T-FS2/3 路由回填；`'legacy-rn'` mock 随 Step 8）、`webview-uri-load.test`（新包矩阵）、`mermaid-fullscreen.test`/`mermaid-webview.test`/`code-copy.test`（装配点断言按 Step 1 工厂体留位验证 + 新包断言）、`chat-tab-provider-static-guard.test`（词表回归）。
- **mock 升级**：`react-native-webview-mock` 全局消息缓冲增加按实例/域分流（transcript/composer 消息同缓冲混流问题）；reanimated mock 桩核查（dock padding 移除后 `useReanimatedKeyboardAnimation` 消费面变化）。
- **Step 8 名下**（非 Step 7）：`composer-fullscreen.test` 的 legacy mock 段、`chat-tab-screen.integration.test` 的 MessageList props 断言段（`:499-512/657/686/700`）。

### 关键不变量的测试纪律（两条硬约束，全迭代适用）

1. **关键组合不变量必须有行为测试**——dist 字符串比对**不算**断言（如「ready 恰一条」这类跨装配的组合不变量，须有真 DOM/桩上的行为断言覆盖，字符串比对只能作为补充）。
2. **关键不变量须附变异证据**——每条关键不变量要给出一条「改坏它必红」的变异说明（改了哪个值/挪了哪一行、哪个测试转红），无变异证据的断言视为未锁。

### 新增测试用例（T-CU 系列）

- T-CU1 — blocking: yes — 单 `ready`：**成功装配下恰一条** ready（含 capabilities 全集），之后才有任何下行；装配未成功（composer 未挂上 / dock 未命中）时零条 ready，交 T-CU15 的 8s 兜底（契约见 §合成 dispatcher 契约第 4 条）。
- T-CU2 — blocking: yes — `init` 聚合与 theme 9 键超集：一次 init 含 theme+flags+composer 四段；themeUpdate 单 schema **9 键**（transcript 7 ∪ composer 6 去重）一次生效全文档；`THEME_VARS` 含 `selection` 映射断言。
- T-CU3 — blocking: yes — 单次注册：`bindHostMessageChannel` 全文档单次；`bindShellEvents` 无双挂（scroll/click 回调计数）；`registerRenderRows`/`registerRenderContextMenu` 仅注册一次；`CONVERSATION_BRIDGE_V=2` 双端一致。
- T-CU4a — blocking: yes — M1/M6：打字不回写（change 上抛后无 setText 回声）+ 宿主接收 change 先推进基线再上抛（父层 value 回声不触发 setSelection）。
- T-CU4b — blocking: yes — M2/M7：effect 版 setText 作废选区基线 vs 命令式 setText（带选区）落到指定光标——两条相反规则各自成立、不得统一。
- T-CU4c — blocking: yes — M4/M5：setSelection 回声抑制 + pendingSelection 短暂受控。
- T-CU5 — blocking: yes — 高度文档内消化：input 换行至 5 行封顶（**122**）期间零 heightChange 上行、RN 容器高度不变、`#scroller` 可视高度收缩。
- T-CU6 — blocking: yes — composerState 全字段渲染等价：inputDisabled（消费点清单见字段表）/sendDisabled/running/error/fullscreenEnabled/placeholder/**hasModel（hintRow 显隐判据——inputDisabled 是其超集，运行态下不得误显 hintRow）**/chips（含「不置灰」）/typeahead 候选源。
- T-CU7 — blocking: yes — **composer 域直发不 defer**：快照分片在途期间 `setText`/`composerState` 直发且在末片前生效（负面断言：deferred 队列内不得出现 composer 域消息）。
- T-CU8a — blocking: yes — visibility 重挂恢复：ready → 下行四消息固定顺序（init→composerState→草稿 setText→快照直发）；草稿文本不丢（IME 组合态丢失为已接受风险）；typeahead 关闭=预期。
- T-CU8b — blocking: yes — 切会话重挂（chatScrollKey 变化）：同一恢复链 + 新会话草稿/新候选源。
- T-CU9 — blocking: yes — 安全守卫：新包目录外 file:// 拒绝、http/https 外跳、`messageMenuAction` 防线不弱化。
- T-CU10 — blocking: yes — 样式相等断言（T-FS1 手法扩展）：toolbar 圆钮/发送按钮/dock 容器边框背景/**chips（数值清单见 Step 4）与 typeahead**/**input metrics 六值**的文档内常量与 RN 参照常量逐项相等。
- T-CU11 — blocking: no — mermaid 全屏与 menu backdrop 盖住 dock（接受遮挡）+ 返回键链关闭顺序不变（mermaid 第一优先级；typeahead/划词不参与返回键）。
- T-CU12 — blocking: no — e2e 冒烟：单 context 判据 + web 内发送 + 输入断言。
- T-CU13 — blocking: no — `#scroller` flex:1 后 scrollSnapshot 抖动回归（dock 瞬变高度下滚动缓存读数稳定）。
- T-CU14 — blocking: yes — 键盘态下发：`composerState.keyboardUp` 翻转时 dock 底 padding 在 `max(8, safeAreaBottom)`↔`0` 间切换（RN 侧信号驱动、web 无自判——防白条 bug 回归，r2-P0-1）。
- T-CU15 — blocking: yes — ready 超时兜底：WebView onLoad 后 8s 未收到 v2 ready → 错误态渲染 + 提示重载（假时钟推进测；锚 load 而非 init，r2-P2-5；**每次 onLoad 重置计时、repaintEpoch/切会话重挂后重新计时**——现网 WebView 未绑 onLoad，本迭代新增绑定属新观测面）。

### 验收口径（性能，r1-P0-9 整段重写）

| 项 | 口径 |
|---|---|
| **板型** | debug 板验收（`[nm-boot]`/`run-timing` 打点 `__DEV__` 门控，release 无打点）；release 仅做抽测 sanity（不作为门槛） |
| **基线** | Step 7 改造前先采**现网双实例基线**（同设备同会话集）：进入就绪墙钟（boot→webview ready 的 `[nm-boot]` 时间差）、退出窗口 gfxinfo |
| **进入会话** | 相对现网双实例墙钟**持平或改善**（现网从未测过双实例总 ready，以基线为准——不是 ≤1.65s：那是单转录读数，合并后单实例要装两 runtime，方向不保证更快的部分如实记录） |
| **退出会话** | `dumpsys gfxinfo reset` 后进入→退出→回列表为一个采样窗口（**不是**重启后累计帧混合样本）；p99 持平或改善；列表重渲染残余如实记录（非目标） |
| **样本** | 每项 ≥3 设备日 × 5 次重复，中位数 + 最差值双报；打点读取走 Metro 日志（dev 包 console.log 不进 logcat） |
| **收益复核** | 高度滞后消灭（input 换行时 RN 侧零 Animated 更新）、键盘帧 relayout 2→1（systrace/gfxinfo 帧对比）作为独立收益项单独记录 |

### 验收口径（UI 一致）

- 截图基线：改造前对现网采集逐屏基线（会话列表/对话页空态/长会话/键盘弹出/typeahead 展开/chips 多行/mermaid 全屏/深浅色），改造后同场景同设备对比。
- 接缝专项（Step 10 清单）+ 划词三项菜单 + 复制内容等价（nbsp 口径）。
- **typeahead 展开态对比项**：单列一项——web 侧 `bottom:100%` absolute 覆盖（input 不动、盖住 chips 行、自创 `max-height:240px`）vs 现网流内子 View 推挤（input 下移），逐条核推挤/覆盖、是否遮 chips、高度上限三项，判「可接受」才放行（对应风险表同名行）。

## 风险与回滚方案

| 风险 | 等级 | 缓解 |
|---|---|---|
| IME 组合态/选区双基线时序互相破坏（7 防线两层 ref 归属） | 高 | 防线逐条落点表 + T-CU4a/b/c 分条断言 + 真机接缝专项首项 |
| 单点白屏（旧 dist 发不出 v2 ready → 下行全丢） | 高 | ready 超时兜底 8s（错误态 + 提示重载）+ 能力降级纪律（未声明即降级提示，非静默） |
| 划词菜单行为变化（三项统一菜单） | 中 | 方案=扩三项保功能面；运行中输入框复制同被禁（罕见，接受）；粘贴按 `inputDisabled` 同口径门控（对齐现网 `TextInput` `editable=false` 行为，非新增限制）；真机验收项锁定 |
| chips 置灰误实现（现网 disabled 是死参数） | 低 | 字段表明示不置灰 + T-CU10 数值断言以修正后的样式清单为准 |
| 键盘 padding 从 UI 线程动画降级为跨桥离散跳变（≤8px 幅度，r3-P2-5） | 低 | 接受（视觉差异极小）；真机接缝专项截图核对键盘弹出瞬间 |
| repaintEpoch 重挂丢 IME 组合态（未上屏拼音） | 中 | 已接受（子会话往返低频路径）；四消息恢复链保文本；T-CU8a 锁序 |
| 若误把 composer 域 defer：分片窗口内不可打字 + 重挂丢草稿 | 中 | T-CU7 负面断言 + 实现契约写死直发 |
| dock 复刻视觉偏差（UI 一致性硬验收） | 中 | 样式数值单源迁移（chips/typeahead 数值入 T-CU10）+ 截图基线对比；`@http://x` 胶囊等待证项一并留证 |
| **typeahead 浮层定位与现网形态不一致（UI 一致性硬验收）** | 中 | 现网 `TypeaheadList` 是**流内子 View**，展开把 input 往下推；web 侧是 `bottom:100%` **absolute 覆盖**（input 不动、浮层盖住 chips 行），且自创 `max-height:240px`（现网无上限）。**验收以现网流内推挤形态为参照判定接受度**：Step 10 截图对比项「typeahead 展开态」逐条核（推挤 vs 覆盖 / 遮住 chips 与否 / 高度上限），差异判「可接受」才放行，不接受则改回流内推挤 |
| 合成包体积 | 低 | 实测（fix-cr 回填）：合成包 `app.js` **8,912,795 B**，双口径并列——对两旧包之和（8,889,363 B）**+23,432 B / +0.26%**（答「合并本身净增多少」），对转录单包（8,866,723 B）**+46,072 B / +0.52%**（答「相对现网单转录包多背了多少」，增量主要来自 composer runtime 内联）；CSS 实测 **+7,093 B**；无框架重复（composer runtime 无 preact）；关注点改为「双 runtime 单实例的 ready 时长」（进入会话口径覆盖） |
| assets/APK 重复承载 ~8.9MB（旧包不删） | 低 | 接受（回滚成本优先）；Step 10 记 APK 体积对比 |
| CSS 双份漂移（chat-conversation.css 与两旧包 CSS 各自演化） | 中 | dock 移植段标注来源锚点注释；变更 checklist 注明「改 composer-input.css 的 dock 段须同步合成包」 |
| `#scroller` flex:1 后滚动缓存口径变化 / row-windowing 贴底守卫节奏 | 低 | T-CU13 观测 + 风险记录 |
| 子会话屏/宏链被误伤 | 低 | 组件与包零改动红线（旧宿主 `ChatTranscriptWebView` 的触碰只有 handle 类型 import 改路径一处 + re-export `planSnapshotChunkBounds` 一处，均为无行为变化；宏链侧 composer-input 包仅 `editor.ts` 三处 `heightReport` 条件触碰，宏链不传该参数取默认 `true` → 行为零变化，见 Step 1）+ 集成测试覆盖 |
| 三层产物链（Metro 碰不到 assets） | 流程 | 全链 build:webview(:native) 纪律写入步骤验证口径 |

**回滚**：分支级回滚（git revert 迭代分支，chat tab 恢复双 WebView 布局）；旧包全程未删（ChatComposer/ComposerAtPathInput 在 Q1 退役提交内标记删除但 revert 语义内可恢复），回滚成本 = 恢复 ChatConversationPanel 旧布局与引用。发版级回滚按 Q1 已定结论（legacy 引擎退役后不再提供 RN 侧回滚路径）。

## Open Questions（已全部拍板，2026-10-01）

- **Q1**：chat tab 的 `legacy-rn` 转录引擎开关是否随本迭代退役？——**已确认退役并执行（`dc4c903b`）**：清理面见 §RN 侧组件重组，`MessageList.tsx` 与其两个测试随退役一并移除；本文后续章节中「待 Q1」的字样一律按此结论读。
- **Q2**：文件/技能选择器维持 RN Modal——**已确认（视同接受推荐默认）**，本迭代即此设计。
- **Q3**：划词菜单方案「扩三项 [复制/全选/粘贴]」（剪贴板读取复用既有依赖 `@react-native-clipboard/clipboard@^1.16.3`）——**已确认（视同接受推荐默认）**。
