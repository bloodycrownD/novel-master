# transcript-native-2026-10 · msg 列表（转录）原生化 SPEC

- 日期：2026-10-12
- 状态：**待用户确认**（含 3 项拟定决策，见 §2）
- 前序：`composer-native-2026-10`（输入框原生化，v1.5.41 已发版）——聊天页去 WebView 第二阶段
- 开发形态：code-dev-loop 子代理模式；worktree 父目录 `D:\worktree`（用户指定，弃旧 `D:\Dev\nm-worktree`）
- 参考仓库：`.reference/rikkahub`、`.reference/enriched-markdown`（已迁入主仓，gitignore 覆盖）

---

## 1. 背景与目标

一句话方案：用 **FlashList v2 容器 + 完整自研「行为语义层」（贴底/停跟/prepend 锚定/loadOlder/键盘联动/快照恢复/流式跟尾）+ EnrichedMarkdownText(github) 正文渲染 + 翻新复用工具卡片组件** 实现纯 RN 转录列表，替换 `ChatConversationWebView`，子会话屏复用同组件，`chat-transcript` webview 包彻底退役。

目标：
1. 聊天主页面与子会话屏**零 WebView**（宏链/全屏编辑/vfs 编辑预览仍在范围外，不受影响）。
2. 切换会话不再有 WebView 初始化/ready 握手/信封翻译/快照分片——纯 RN 状态切换 + 水合。
3. mermaid 按代码块处理（拍板已定）：无图渲染、无 WebView 岛；vfs `RichDocumentWebView` 预览侧 mermaid 照旧兜底。
4. 数据面（SessionStreamUnitManager / 单元投影 / view-cache / loadOlder 锚定）**最小必要改动**——数据形态（D1–D12 实质）不变；unit/manager 仅动**句柄契约与路由面**（§3.3 全节：attach/subscribe/resolve 路由/广播/注入去重）+ §3.3-5 写串行化一处，只换渲染宿主与句柄形状。
5. UI parity：观感对齐现 web 版（PoC 硬门之一，截图对比）。

历史教训（探索一手证据）：`docs/Iterations/mobile-native-chat-list/prd.md:3`——2026-06 RN inverted FlatList + RenderHTML 路线「无法稳定满足贴底/流式/prepend/长按菜单」废弃。失败组合是 **VirtualizedList × RenderHTML 异步测高**；现在渲染器是 EnrichedMarkdownText（Fabric 原生同步测量），失败条件已变，但**行为语义层当年就是自研且自研失败的**——本轮把它当设计核心，模式取自 rikkahub（详见 §5.2）。

## 2. 三项拟定决策（默认按推荐执行，用户可推翻）

| # | 决策 | 拟定 | 理由 | 代价（已知情） |
|---|---|---|---|---|
| S1 | 列表容器 | **FlashList v2 + 自研行为层** | 虚拟化/回收交生态标准库（类比 rikkahub 用 LazyColumn 平台组件）；行为层全自研才是「好好设计」的重心；三条路中业务代码量最可控 | 新增 1 个依赖（当前未装，需 PoC spike 验证 ×RN 0.85.3/Fabric/Reanimated 4.5.3 兼容） |
| S2 | 代码高亮 | **开 tree-sitter**（`enableCodeHighlight: true`） | 观感对齐现 web 版（hljs 10 语言彩色 token）；mermaid 恰好无 grammar 自动明文，与拍板一致 | postinstall 联网下载语法资产（CI 须保证网络）；APK 增大若干 MB；首次需原生重编 |
| S3 | markdown flavor | **github** | 表格/任务列表/删除线正常渲染（LLM 常吐表格），代码块自带语言标签+复制按钮 | 文本选区**不能跨段**（跨「段落+代码块」连续选择复制做不到）；`numberOfLines` 失效（折叠功能需自建方案） |

不采用的替代路线存档：S1-纯自研虚拟化（零依赖但相当于重写 FlashList，风险最高）；S1-Fabric 原生容器（性能天花板最高但「原生容器嵌 Fabric item」无先例、链路最长）；S3-commonmark（全文档选区但无表格）。

## 3. 现状 → 目标架构

### 3.1 数据路径（数据面不动，出口以下换形状）

```
core eventBus → SessionStreamUnitManager → SessionStreamUnit（32/64ms 节拍、消息面、指标）
  现状：resolveStreamingWebview → session-stream-webview-adapter → ChatTranscriptWebView（信封 v2 → v1 下译 → web runtime）
  目标：resolveStreamingWebview（语义保留，仅命名待定）→ native transcript handle → TranscriptList（RN 同步渲染）
```

- `SessionStreamUnitView` 投影、D1–D12 数据不变量**原样保持**（清单见附录 B）。
- `session-stream-webview-adapter.ts` 改签 native handle（或退役重写为 `session-stream-native-adapter.ts`）；`ChatTranscriptWebViewHandle` 命令面按 §3.3 重定义——其中 `tryCommitStreamTail`/`commitAbortOverlaySnapshot` 为**死命令面**（生产零调用方，宿主早已切 `reset-stream` 广播，useChatTabController.ts:38-44；仅测试引用 chat-conversation-webview.test.tsx:1228 / chat-transcript-snapshot-after-stream-commit.test.tsx:271,293，随 §5.6 判路重定义退役），随 webview 退役消亡、**不做原生对偶**；真正要翻译的命令面见 §3.3-4 `flushStreamTail`。
- 流式推送与控制消息的多订阅路由、`transcriptReadyEpoch`、attach/detach 纪律——RN 化把「单可见 webview」换成组件树多订阅并存（父 ChatTab 挂栈不卸载 × 子会话屏 push，RootNavigator.tsx:213-218 无 unmountOnBlur），**完整并发模型见 §3.3（并发专项轮定稿，P3 必须全量落地）**。

### 3.3 并发与多订阅模型（并发专项轮定稿）

webview 时代消费模型是「单可见宿主 + 切会话 key 重挂兜底」；RN 化后 TranscriptList 多实例并存且 key 重挂兜底消失（tsi r2 定性的「陈旧投影帧」身份比对守卫从未上线、一直靠重挂兜底）。本节为**必实现**设计；考古依据见附录 D。

**数据面改动口径**（R3 轮 N3 修正）：D1–D12 的实质（消息内容、投影字段、缓存锚定语义、数据形态）不变；本节对 unit/manager 代码的改动限定在**句柄契约与路由面**（attach/subscribe/resolve 路由/广播/注入去重/写串行化），不引入新数据形态——「唯一数据形态改动=§3.3-5 写串行化」是数据形态层面的口径，实现方不得以此为令箭漏改路由/订阅面。

**1) 可见性真源与流式路由**（防 C4/A3 族串流）
- handle 契约 `isVisible` 从可选改**必选**：`useTranscriptFocus()` 统一产出 = `useIsFocused()` AND `AppState==='active'` AND 屏幕本地 focusRef（当前全链路无实现方、恒 true，`resolveStreamingWebview` 退化「最后 attach 序」——隐性依赖显式化）。
- 路由规则：先取 focused 句柄；**无 focused 句柄返回 null（后台不推流）**——partial 在单元继续累积不丢，重进由既有 `tryInjectPartialInto`（unit :1226-1253）补齐。控制消息维持全广播（单句柄抛错隔离语义保留）。

**2) 订阅身份与串台防护**（防 C4-P1~P4/A1/B1 族）
- attach 契约升级 `attach(sessionId, handle, {subscriptionId, epoch})`；每次回推（onStreamPayload/onControlMessage）携带 subscriptionId+epoch，屏幕侧 `epoch !== myEpochRef.current` 即丢弃。
- 消息面换源按会话键**整体替换** + 投影帧身份校验：帧引用变更时校验帧内 sessionId 归属，非本会话帧直接丢——key 重挂兜底消失后的**显式重建**；React 同 commit 内子组件 effect 先于父组件执行，切会话首帧窗口尤其危险（tsi r2 教训）。

**3) 后台零流式渲染**（防 C1 族「重活堵 JS 线程」）
- focus 联动 attach/detach：blur（push 子会话屏/切 tab/app 后台）detach 流式句柄、保留消息面订阅；focus 回来 re-attach + 补注入 + **消息面一并重同步**（sync effect deps 无 focus 维度，refocus 须主动补一次 `readMessagesSnapshot` 拉齐；R3 轮 N8 修正）。
- `subscribe(listener, {sessionId, surface})` 按订阅者粒度过滤：后台 surface 仅「状态迁移类」变更（step/settle/出表）唤醒，64ms apply 节拍不唤醒。验收见 §9 DoD-7（perf trace）。

**4) 活跃尾块收尾：`flushStreamTail()` 命令面**（防 B2 三段式错段/A7/C4 族）
- 语义：活跃尾块固化为只读已提交块 + 清活跃态 + 复位本地累积。触发点四处（全在既有广播沿上、零数据面新增）：① unit.settle(finished|failed) 生效分支统一 flush（run 正常结束与失败收尾；interrupted **不走 flush**，沿用既有 `useInterruptedPartialCommit` 中断提交链——R3 轮 N9 修正）；② 收到 `reset-stream`（rollback/fork；对偶 web 侧 `resetStreamTail` 的 cancel 拦迟到 delta 语义，unit :756-779）——后台 surface 经 step 迁移投影通知接收（在 §3.3-3 唤醒枚举内，不依赖独立控制消息唤醒，N8 修正）；③ 收到 `force-snapshot`（pendingChildren 变化/空基线直发）；④ manager `removeUnit` 交接 idle 时对存活句柄补发（manager :1693-1709）。
- 原子性与去重：FlashList 数据替换顺序保证「快照先于 delta」；行构建按 id 去重（对偶 web streamCommit 去重，snapshot.ts:393-404）；判路测试必须覆盖「快照在途 × delta 到达」交错（C9 分片在途丢行的原生对偶）。

**5) 数据面最小必要改动：消息面写串行化**（防 loadOlder × force tail reload 竞态）
- `loadOlderMessages`（unit :970-1015）与 `loadTailMessages({force:true})`/`kickTailReloadQuietly`（:1017-1025/:948-968）是并发 await 链、各自守卫只防链内重入——跨链交错时后落地者覆盖 `messagesValue`（翻上来的历史被冲掉）。修：unit 内所有改 `messagesValue` 的 await 链排入同一 promise 队列，读-改-写在单次微任务窗口完成。**这是本轮唯一的数据形态改动（口径见本节开头）。** 同型竞态同治：manager idle 路径 `loadIdleTailMessages`（:1029-1041）/`loadIdleOlderMessages`（:1069-1104）await 后整体替换 `idleMessageViews` 的链，并入同一串行化纪律（idleMessageViews 与单元 messagesValue 各自一条队列——R3 轮 N5 修正）。
- RN 侧行为防御：`onStartReached` 500ms 冷却 + **`nearBottom===true` 时忽略触发**（贴底无翻历史意图，从源头减少与流式 append 的竞争）。

**6) 错峰信号源：generation 信号盒**
- `snapshot-complete-signal.ts` 改带代次：`notify(gen)` / `consumeNext(gen, timeout)`，代次不匹配即丢——消「超时后残留 pending 让下一次立即返回陈旧信号」缺陷（:32-65 单等待者 + 单 pending）。
- 新信号定义：「消息面引用变更 + 一次 rAF 后 FlashList 布局稳定」（`onCommitLayoutEffect` 比对 lastRenderedMessagesRef 与当前 messages 引用，一致才 notify）；等待者=主屏 controller 单例（子会话屏无 rollback 入口，不多等）。

**7) 快照写回与恢复纪律**（防 C5/C8 族）
- 写回：屏幕 mount 时 ref **固化** sessionId（写回只写固化 key）；100ms 节流 RN 侧重建；emit 携带 mountEpoch，与屏幕当前 epoch 不符即丢（切走瞬间延迟 emit 不落新 key）。
- 恢复：**先消息面就位（idle/投影引用确定）→ 再分步 scrollTo**；每次校正前校验 `snapshot.lastMessageId === messages.at(-1)?.id`，不一致丢弃本次校正（防 A→B→A 用错总高）；恢复完成前 nearBottom 强制为快照值（防恢复途中流式 append 提前贴底）。unit 出表引发的消息面切换带一次 layout invalidate。

**8) attach/注入纪律与常驻句柄注册表**（防 B1 HANDLE-NULL/A7/B4 族；R3 轮 N1 修正）
- **manager 层新增 per-session 常驻句柄注册表**：attach 落在注册表而非单元（无单元也落表）；单元创建（idle 会话首轮发送 startRun）、单元替换（startRun 吸收旧单元，manager :1174-1188）从注册表继承句柄——`takeWebviewHandles`（manager :1167-1187）概念上移至注册表层并保留注入权语义。**这是「hasUnit 从 attach 依赖数组摘出」的前提**：旧机制下 hasUnit null→true flip 是「单元凭空出现时补挂句柄」的唯一触发器，摘除而无注册表 = idle 会话首轮发送流式空屏（B1 重演）；注册表接管后单元出现时推送接管，不依赖 attach effect 重跑。
- 「恰好一次注入」上移屏幕句柄：unit 侧注入去重从全局 `injectedValue` 复位改 `injectedInto: Set<subscriptionId>`，detach 只摘自己那条——消 hasUnit flip 时 detach→re-attach 同 partial 双注。
- **屏幕侧 partial 以替换语义应用（幂等）**：`tryInjectPartialInto` 发射的是全量 materializePartial（unit :1233-1253），屏幕尾块按**替换**而非追加应用——重 attach（A→B→A / readyEpoch 重挂 / StrictMode 双挂载）时 sid 已摘导致重注入，替换语义保证不双份。StrictMode 安全依赖此语义 + DoD-7 A→B→A e2e 验证（非「天然覆盖」——R3 轮 N7 修正）。
- attach 时序：ref 非空 + ref 与本次 render 的 screenKey 一致（ref 挂 `__screenKey` 校验）才 attach。

**9) 在途取消与引用稳定**（C10/A8 思想对偶 + 4c2bf4cc2 教训）
- 快照恢复 scrollTo、loadOlder promise、防抖/节流 timer 等**在途异步 apply 必须可取消/对账**（AbortController 形态）；会话键变更时统一 abort 全部在途。
- D5 messages 引用稳定 + 「仅尾 item 重组」（rikkahub 模式）为硬约束：无关重渲染不得产生新 messages 引用（否则整表 diff + 滚动跳）。

**10) 子会话屏专项平推**（A5 语义）
- pending 映射「子会话终态不摘除」（manager :1464-1468：并行 task 批 tool_results 等最慢子 agent 落库的窗口期，pending 映射是任务卡唯一可点数据源）语义照旧不动。
- 子会话屏 TranscriptList 适用 §3.3 全部纪律（focus 路由/订阅身份/flushStreamTail 触发点②③/写回纪律）；命令面为子集（无 composer/rollback 入口）。

### 3.2 组件树

```
ChatConversationPanel（骨架不动）
└─ AndroidKeyboardClipBody（不动：marginBottom 收缩承担键盘避让）
   ├─ TranscriptList（新，flex:1）= FlashList 容器 + useTranscriptScrollBehavior（自研行为层）
   │   └─ TranscriptRowView（新，按行 kind 分发）
   │       ├─ user 气泡：胶囊识别（nmtoken/nmskill linkVariants）+ 正文（richText? EnrichedMarkdownText : Text）
   │       ├─ assistant 气泡：ThinkingSection 折叠区 + 工具组卡片 + 正文 + 流式尾
   │       ├─ 工具卡片：翻新复用 ToolCallGroupCard / ToolCallCard / ToolTurnPhaseBar（现零引用资产）
   │       ├─ 附件 chip 组：原生复刻（等高换行布局语义）
   │       └─ 流式尾块：已提交块（append-only 静态）+ 活跃尾块（单实例高频更新）
   ├─ ChatMetaBar / 指标条（已是 RN，位置不动；上下文用量条本就不在 webview 内——立项讨论时口径更正）
   └─ NativeChatComposer（不动，v1.5.41）
```

### 3.4 形态复刻清单（对齐 web 版 16 形态，E1 探索）

| 形态 | web 实现 | RN 实现 |
|---|---|---|
| user/assistant 气泡样式 | CSS token | tokens.ts + 双主题 markdownStyle（`tokensForMode` + `useTheme()`，composer 先例 NativeChatComposer） |
| thinking 折叠区 | ThinkingSection | ThinkingBlockCard 翻新（折叠/展开/时长） |
| 工具卡片（组/相位条/文件打开/子会话跳转/技能详情） | ToolGroup + data-action 委托 | ToolCallGroupCard 等翻新 + RN onPress |
| 附件 chip 组（换行/label/点击） | AttachGroup | 原生 chip 组件（等高换行语义） |
| 长按消息菜单 | rows-click | RN 长按菜单（菜单项清单抄 web 版 message-menu-entry） |
| 划词菜单 | web selection | EnrichedMarkdownText `contextMenuItems`（系统 copy 不可隐藏只改标签；`copyAsMarkdown` 可加） |
| 代码块复制/语言标签 | CSS 伪元素 + code-copy | github flavor 自带 header + `onCopyPress` |
| 内链路由 | onAnchorClick → linkClick | `onLinkPress` 分流：http 外跳 / nmtoken·nmskill 胶囊 / 其余 `resolveChatLinkTarget` → openFileEditor / toast |
| mermaid | renderMermaidCodeBlocks SVG | **无图**：无 grammar 自动明文代码块（语言标签 mermaid） |
| hidden 行 | data 属性 | ~~列表数据过滤（构建行时跳过）~~ → **D26 拍板收窄（cr-fix-d26 SD-1/B-2）**：保留行、气泡 opacity 0.45 淡显（user/assistant 两角色同规则，旧版 `.row.hidden .bubble` 口径），消除「消息被吞」感 |
| 流式 plain/rich | stream-markdown 350ms 升级 | 见 §5.3（简化：按用户偏好直接渲染，无升级闪烁问题） |
| 空会话提示 | web 文档 | RN 空态视图 |
| 主题双态 | CSS 变量 + nmMode | markdownStyle 双套 + syntaxColors 双套 |
| 贴底按钮/滚动条 | web | RN 实现（贴底按钮为可选增强，v1 不做） |

## 4. 范围与非目标

**范围**：转录列表原生化 + 子会话屏迁移 + mermaid 按代码块 + 行为层自研 + 工具卡翻新 + chat-transcript 包退役（含信封 v2→v1 下译、能力协商）+ e2e 判据迁移（转录+composer 双漂移一次收口）。

**非目标**（不动）：
- 宏链 `PromptMacroTextInput`（智能体编辑器 DynamicBlocksCard/PromptLayoutSection 两处消费）
- 全屏编辑 `PromptEditorScreen`/CodeMirror、`composer-input` webview 包
- vfs `CodeEditorWebView` / `RichDocumentWebView`（mermaid 预览兜底仍在此）
- desktop 端一切（库仅 mobile 依赖，探索已确认零波及）
- core 数据面（manager/单元/view-cache/loadOlder 锚定）
- mermaid 图渲染恢复（后路=「点击代码块 → 全屏查看屏」，留待未来迭代）
- `react-native-streamdown`/remend/Worklets Bundle Mode（E3 建议单列暂缓：block-split 同构策略已覆盖未闭合语法处理；构建改造面大，后续迭代再评）

## 5. 技术设计

> **架构转向注记（2026-10-15 用户拍板，cr-fix-d26 SD-2 回写）**：本节以下 §5.1-§5.2 的 **v2 正向方案**（estimatedItemSize 禁用/MVCP prepend 锚定/onCommitLayoutEffect/首帧自动测量）已**整体被 inverted spec 覆盖废弃**——D15 bug 家族四轮未收敛后转向 **FlashList v1 + inverted 倒排**（贴底=scrollToOffset(0)、恢复=scrollTop 直读、加载更早=数据尾 append、MVCP 全删 JS 驱动、快照 schema v3），真源见 `docs/Iterations/transcript-inverted-2026-10/spec.md`（D1-D9）与 tag `tn-flashlist-v2-forward-base`（v2 路线回滚档）。本节文本保留为历史决策记录，**不得作为实施依据**。

### 5.1 列表容器（S1 拟定：FlashList v2）【已废弃，见上方转向注记】

- 尺寸：v2 已删除 `estimatedItemSize`（v1 专有，不得使用），依赖**首帧自动测量**；分桶回收挂 `getItemType`（按行 kind：user/assistant/tool/attachment/… 提升回收池命中）。web `row-windowing.ts` 的 EWMA 算法降级为 PoC 量测/诊断工具（验证高度抖动与回收行为），不再作为 prop；PoC 期间直接借用 web 侧 `row-windowing.ts` 与其测试 `chat-transcript-row-window.test.ts`，P5 随目录退役。
- `keyExtractor` = 行 id（web data-id 同源）。
- 首帧后定位：`onCommitLayoutEffect` / `onLoad`（v2 布局提交/加载完成时机，快照恢复与进入定位的挂点）。
- 回收 vs 超长 item 的张力：tree-sitter 单块 50KB/2000 行自动退化 plain 已是第一道护栏；PoC 硬门 2 验证千行代码块，若不过再加折叠（rikkahub `COLLAPSE_LINES` 模式，默认关）。
- **兼容 spike 是 Phase 0 第一项**：FlashList v2 × RN 0.85.3 × Fabric × Reanimated 4.5.3，真机跑通才继续；spike 须确认 ① 不使用任何 v1 专有 API（`estimatedItemSize` 等），② 内建 `maintainVisibleContentPosition`（v2 对象配置、默认开启，子项 `autoscrollToTopThreshold`/`autoscrollToBottomThreshold` 等）与自研行为层的职责切分——**优先枚举**：保留内建 + 调 top/bottom 阈值 + `startRenderingFromBottom`（进入定位）；确与自研打架才关，且须写明关哪几个子项（整体 `disabled:true` 会连 `startRenderingFromBottom` 一起失效，此时进入定位 fallback 改 `scrollToIndex`/`scrollToOffset`）、自研层主导；不兼容则回落 S1-纯自研（行为层设计不受容器影响，见 5.2）。

### 5.2 行为语义层（自研核心 `useTranscriptScrollBehavior`）

设计原则：**行为层与容器解耦**（纯函数 + hook，换容器不动行为）。纯函数直接复用 `src/webview-host/chat-transcript/scroll.ts`（`nearBottom`/`scrollTopForBottom`/`scrollTopAfterPrepend`/`clampScrollTop`，无 DOM 依赖）。

| 行为 | web 现状 | RN 设计 | rikkahub 借鉴 |
|---|---|---|---|
| 贴底真源 | `state.nearBottom`（全仓唯一，80px 阈值） | hook 内单一 `nearBottomRef`（onScroll 计算），阈值语义不变 | `isAtBottom()` 末 item offset 判定 |
| stick-to-bottom | ResizeObserver → `stickIfNearBottomNow` 每帧 | 触发源**组合**：`onScroll`（nearBottomRef 真源）+ `onCommitLayoutEffect`（布局提交，流式/dock 高度变化后的主触发）+ 键盘高度变化回调；`onContentSizeChange` 仅作兜底（v2 内容容器自管理高度、其转发时机无官方承诺，**不作单点依赖**）。任一触发若 nearBottom 则 `scrollToEnd({animated:false})`；非贴底一像素不动。v2 内建 `autoscrollToBottomThreshold` 可能覆盖部分贴底行为，spike 实测后若与自研语义重叠/打架则关闭内建、自研主导 | `LaunchedEffect + snapshotFlow(visibleItemsInfo)` 仅「生成中+未滚动+贴底」才跟 |
| 流式跟尾 | web 同上 | 同上（64ms apply 节拍天然限频） | 仅生成中才自动滚 |
| loadOlder | scrollTop ≤ 24 + armed 闸门 | **`onStartReached` + `onStartReachedThreshold`**（forward 列表历史在顶部，v2 阈值单位=可见长度**比例**而非 px，24px 语义换算 24÷视口高；armed 闸门语义保留）+ `hasMore`/`loadingMoreMessages` 守卫 + 去重 + **500ms 冷却 + nearBottom===true 时忽略触发**（§3.3-5）。不使用 `onEndReached`（那是底部=最新消息端） | 无（rikkahub 无分页） |
| prepend 读位保持 | scrollTop += 高度差 | FlashList `maintainVisibleContentPosition`（v2 对象配置、默认开启，prepend 方向子项 `autoscrollToTopThreshold`）+ `onCommitLayoutEffect` 差值校验（`scrollTopAfterPrepend` 已有；内建子项若被 spike 关闭则此差值校准为唯一腿） | — |
| 快照恢复/写回 | v2 快照 + restoreScroll + 100ms 节流 emit | v2 快照 schema **前向兼容增列 `lastMessageId`**（§3.3-7 恢复身份校验用；旧档缺省时跳过校验；`offsetY`=距底 px 语义不变）；虚拟列表**首帧 contentHeight 未必是终值**，恢复用 `onCommitLayoutEffect`/`onLoad` 分步校正 scrollTo（距底 px 依赖总高，须等布局稳定再校）；写回走原 `useChatTabStream` 链路 | — |
| 键盘联动 | ResizeObserver 逐帧贴底 | `useReanimatedKeyboardAnimation` 高度变化 → 若 nearBottom 贴底一次（AndroidKeyboardClipBody 的 flex 收缩天然缩视口，布局提交回调亦会连带触发） | `ImeAutoScroller.scrollBy(Δ)`（其为强制平移，我们保守取贴底才跟，与 web 语义一致） |
| 进入定位 | 快照恢复或 defaultChatScrollToBottom | 同语义；无快照且消息较少时可用 v2 内建 `maintainVisibleContentPosition.startRenderingFromBottom`（v2 为该场景原生提供） | `chatListInitialized` 一次性闸门 + overshoot |

### 5.3 正文渲染（S2/S3 拟定）

- **plain 路径**（`chatRichTextEnabled=false`，默认）：RN `Text` + pre-wrap，天然保留空行（web 的 stream-blank 占位 hack 是 DOM 专用，不需要）。
- **rich 路径**：`EnrichedMarkdownText flavor="github"`，`markdownStyle` 双主题、`codeBlock.syntaxColors` 双套（tree-sitter 14 默认语言 + opt-in）。
- **流式结构**（block-split 保留为宿主纯函数）：
  - 已提交块：append-only，静态 EnrichedMarkdownText（内容不变=只解析一次，native 渲染 id 防乱序已内建）。
  - 活跃尾块：单实例高频更新（64ms 节拍）；12k 字符护栏内 native 后台线程重解析，主线程只贴 styled text。
  - 未闭合语法不提交（fence/表格 delimiter 确定边界才切）——与库 `streamingConfig` 缺位兼容（G4：不开 streamingAnimation，其 append-only 假设与本项目回滚/替换语义错配）。
- **护栏**：`RICH_CONTENT_MAX_CHARS=12000` 超限回落纯文本 Text（web 同款）；LaTeX 现状两端都不支持（enableMath:false 与 web 无 katex 一致，写明即可）。
- **已知观感差异**（写进验收知情项）：raw HTML 不渲染（`<br>` 不断行）；github 选区不跨段；裸 URL autolink 恒开。
- **胶囊**：仅 user 气泡（与 web 口径一致），复用 `native-composer/token-ranges.ts` 的 `nmtoken://`/`nmskill://` scheme + `linkVariants`（注意渲染侧 `LinkVariantStyle` 多 `fontFamily` 字段，共享对象须留空）。

### 5.4 子会话屏

- `SubagentSessionScreen` 挂 `TranscriptList variant="subagent"`：无 composer、无 dock；指标条/停止按钮已是 RN 不动；交互子集=复制 + 工具卡只读展开（open-tool-file/open-subagent-session 保留跳转）。
- 数据源统一：`listBySession` 全量兜底 → 改 `loadSessionTailMessages(sessionId)`（不带 projectId、不回写 cache），与主屏 40 条窗口口径一致（E4 疑点 10 拍板）。
- **loadOlder 接线**：`variant="subagent"` 同样接 `onStartReached` → `manager.loadOlderSessionMessages(sessionId)`（idle 路径 `loadIdleOlderMessages` 不带 projectId 亦可翻页，manager :1051-1111）+ `hasMore` 透传——统一窗口后 >40 条历史仍可达，避免相对现状「全量可见」的行为回退（有单元的活跃子会话今天本就是 40 窗口，属既有限制非本轮引入）。
- **消息面订阅**：无单元（run 结束、单元出表）场景下 idle prepend 落进 manager 的 `idleMessageViews`，屏幕本地 `messages` state 拿不到——须改为订阅 `manager.readMessagesSnapshot(sessionId)` + subscribe（与 ChatTabProvider :240-319 `readMessagesSnapshot` 模式同构），`hasMore`/`loadingMore` 同源透传；否则 idle 路径 loadOlder 后界面不更新。
- **并发纪律**：§3.3 全节适用（focus 路由/订阅身份/`flushStreamTail` 触发点②③/写回纪律/attach 纪律）；命令面为子集（无 composer/rollback 入口）。
- `transcriptOnly` 变体与 CSS 藏 dock 的装配整段删除。

### 5.5 退役清单（chat-transcript 彻底退役）

六处齐改 + 完整清单见附录 C（22 项，含 build-webview.mjs PACKAGES/白名单、compat-baseline、pruneDist/copyDistToNativeSinks 三端产物、pbxproj `-f` 清单与 IOS_HISTORY_PACKAGES 断言、tsconfig include、README 过期文案、webview-host 目录、v1/v2 桥、host-downtranslate、快照分片机制、`src/web/chat-transcript/` 40 文件、read-webview-dist 联合类型等）。要点：

- **顺序纪律**：先删依赖 dist 产物的契约测（pretest 仍跑 build:webview，残留消费方会红）；再退役包；再改守卫与基线。
- **分片/让渡机制退役**（`planSnapshotChunkBounds` + webview 侧让渡与 inFlight 代次的**消费点**；`yield-quantum.ts` 模块**保留**——manager :434 与 `create-mobile-runtime.ts:110` 仍消费，属数据面不动面）：原生同步渲染无 postMessage 大 payload 堵点；但 `onSnapshotComplete` 信号被 rollback 链 token 重算错峰依赖（`snapshot-complete-signal.ts` + `useChatTabMessageActions`）——**必须给 rollback 链新错峰信号源**（拟定：首帧渲染完成回调/interaction handle）。
- **保留件**：`chat-transcript-scroll-cache.ts`（v2 快照，宿主无关）、`chat-transcript-engine.ts`（历史 KKV 只读锚点）、`src/web/shared/*` 中被其余三包消费的常量（`NEAR_BOTTOM_THRESHOLD_PX` 真源迁 RN 侧文件亦可，保持单一真源纪律）。
- **iOS 面**：本迭代 Android only，且 iOS 侧**从未包含 chat-transcript**——pbxproj copy 脚本存在性断言清单与守卫 `IOS_HISTORY_PACKAGES` 锁的是历史包 chat-conversation（早已退役的旧包）。chat-transcript 退役对 iOS 面**零改动**；chat-conversation 残留致 iOS 出包假绿属历史问题，不在本迭代收口（如需清理由用户单独立项）。

### 5.6 测试迁移

- **纯函数保留**：scroll 纯函数、block-split、message-paging、view-cache、unit/manager 全家、native-composer、keyboard-avoid。
- **语义等价重写**：宿主 7 describe（ready 握手→attach/epoch 语义、流式命令面→native handle、切会话重挂→key 语义、memo 比较器）；`chat-tab-screen` 的「先 snapshot 后 inject」顺序断言；snapshot-after-stream-commit 判路整体重定义：`tryCommitStreamTail`/`commitAbortOverlaySnapshot` 为死命令面退役消亡（§3.1），判路改测 `flushStreamTail` 四触发点 + 「快照在途 × delta 到达」交错（C9 对偶，§3.3-4）；subagent 装配断言。
- **退役**：read-webview-dist **转录侧**消费方 6 套件（chat-transcript-boot-script/entry/rich-styles、code-copy、mermaid-fullscreen、mermaid-webview；另 3 套 rich-document/code-editor 系消费方不动，不属本迭代）、`webview-uri-load` 的 chat-transcript 维度收缩（URI+props 矩阵剩 rich-document/code-editor/composer-input 三包）、web runtime DOM/dist 契约测、mermaid 系列、transcriptOnly 变体测。
- **新增**：行为层单测（贴底/prepend/loadOlder/快照恢复纯函数面 + hook 时序）、行组件 react-test-renderer 测（native-composer 674 行先例）、EnrichedMarkdownText mock 已就位（`test-utils/enriched-markdown-mock.tsx`）。
- **e2e**：T-CU12 重写为 RN a11y/testID 判据（`app.page.ts:50 byTestId`→resourceId 既有解法）；`switchToConversationWebView`+`CONVERSATION_DOM_PROBES` 退役；`chatTranscriptPage` web dock 方法（composer 轮已漂移）与 rollback/tool-phase 三套 spec 的 DOM 判据一并迁原生；真机 e2e 纪律（noReset/forceAppLaunch/禁清数据）照旧。

## 6. 实施计划（Phase 骨架，供 code 阶段细化）

| Phase | 内容 | 出口判据 |
|---|---|---|
| P0 PoC | ① FlashList v2 兼容 spike（真机）；② EnrichedMarkdownText 渲染 spike（静态 md/主题/链接/代码高亮开 tree-sitter）；③ 三硬门预演 | 三硬门：长会话(万行)滚动+流式不劣于 web 版；千行代码块单 item 性能；UI parity 截图对比 |
| P1 行组件 | TranscriptRowView 全形态 + 工具卡翻新 + 菜单 + 附件 chip + 空态 | 行组件 react-test-renderer 套件绿 |
| P2 行为层 | useTranscriptScrollBehavior 全行为 + 快照恢复 + block-split 接线 | 行为层单测绿；模拟器手工全场景（贴底/停跟/prepend/键盘/流式） |
| P3 接线替换 | ChatConversationPanel 换 TranscriptList；attach/epoch/interruptedPartialCommit 语义保持；**§3.3 并发模型全量落地**（可见性路由/订阅身份/flushStreamTail/写串行化/generation 信号盒/写回纪律） | 主屏可用；数据面测试全绿；§3.3 各条并发判路绿 |
| P4 子会话屏 | SubagentSessionScreen 迁移 + 数据源统一 | 子会话屏可用 |
| P5 退役 | 附录 C 22 项（顺序纪律：测试→包→守卫→基线→文档） | 六处守卫绿；APK 无 chat-transcript 残留 |
| P6 测试/e2e | 迁移重写 + T-CU12 重构 + rollback/tool-phase 判据迁移 | jest 全绿；e2e 绿 |
| P7 收尾 | README/CHANGELOG/棘轮口径/APK 体积记录 | 发布准备 |

## 7. 依赖与构建变更

- **新增**：`@shopify/flash-list`（v2，Android only 验证）。
- **变更**：根/`apps/mobile` package.json `enriched-markdown.enableCodeHighlight: true`（触发 postinstall 下载 tree-sitter runtime+grammars、CMake 重编、`generated/` 之外的 vendor 落盘）；CI 需保证安装期网络。
- **不新增**：react-native-streamdown / remend / Worklets Bundle Mode（非目标）。
- patch-package 面：display 侧力争**零补丁**。现有 26 个 diff 文件不动：24 个纯输入面，另 2 个为跨面文件（共享类型 `src/types/MarkdownStyle.ts` 与 `android/.../spans/RoundedBackgroundSpan.kt`）——display 行为零命中（R2 审查实证），本轮不碰该 patch。

## 8. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | FlashList v2 × RN 0.85.3/Fabric 兼容无先例 | P0 spike 真机先行；不过则回落纯自研（行为层设计容器无关） |
| R2 | rollback/fork/中断链行序漂移 | §3.3-4 `flushStreamTail` 四触发点落地（死命令面退役消亡不做对偶）+ 判路重定义；P3 验收 |
| R3 | 快照分片退役后 rollback 链 token 重算错峰信号缺失 | generation 信号盒 +「消息面引用变更 + rAF 布局稳定」信号定义（§3.3-6），P3 一并落地 |
| R4 | 流式高度突变 × 回收测量抖动 | v2 首帧自动测量 + `getItemType` 分桶回收池（EWMA 仅作 PoC 诊断）；PoC 硬门 1 覆盖 |
| R5 | tree-sitter 资产下载在 CI/离线场景失败 | 显式 opt-in fail-loud 语义确认；CI 网络保障；`.stamp` 缓存 |
| R6 | e2e 全面漂移导致回归窗口 | e2e 重构独立成 P6，不与功能混跑；真机纪律照旧 |
| R7 | 库升级时补丁冲突面扩大 | 本轮不动现有 patch（26 diff：24 输入面 + 2 跨面文件，display 行为零命中）；升级窗口期单独评估 |
| R8 | RN 化多订阅并存引入新并发面（可见性路由/后台渲染/陈旧投影帧/尾块收尾） | §3.3 全节为强制设计 + §9 DoD-7 并发专项验收（双屏 focus 流式定向、后台零渲染 perf trace、快照×delta 交错、A→B→A 连切、idle 首轮发送） |
| R9 | 超长代码块 item 挑战回收模型 | 50KB/2000 行退化 plain + 12k 护栏；硬门 2 不过则加折叠 |

## 9. 验收（DoD）

1. 聊天主页面与子会话屏零 WebView（`react-native-webview` 消费方仅剩宏链/全屏编辑/vfs 三处）。
2. PoC 三硬门全过（附证据：perf trace + 截图对比）。
3. 数据不变量 D1–D12 测试全绿（附录 B）。
4. jest 全绿（迁移后口径）；e2e T-CU12（原生判据）与 rollback/tool-phase 绿。
5. 六处资产守卫绿、compat-baseline 更新、APK 无 chat-transcript 残留、体积变化记录进 CHANGELOG。
6. 已知行为差异清单（§5.3）写入用户可见变更说明。
7. **并发专项验收（§3.3）**：双屏 focus 切换流式定向正确（主屏↔子会话屏互不串流、后台屏零增量）；后台/不可见屏幕零流式渲染（perf trace 证据）；「快照在途 × delta 到达」交错判路绿；A→B→A 快速连切无串台（模拟器 e2e，用户指定口径）；**idle 会话首轮发送流式定向**（常驻注册表接管首挂，§3.3-8 主线回归——R3 轮 N1 增列）。

---

## 附录 A：Context Bundle（code 阶段子代理直接消费）

**数据链（不动，理解即可）**：`src/services/session-stream-unit.ts`（32/64ms、PAGE_SIZE=40、applyMessages 引用稳定）· `session-stream-unit-manager.service.ts`（snapshot/subscribe/attach/loadOlder/readMessagesSnapshot/hydrate）· `chat-session-view-cache.ts`（窗口 40 冷启动）· `message-paging.ts`（prependOlderMessages）

**挂载/接线（改动面）**：`src/screens/tabs/chat-tab/ChatConversationPanel.tsx`（transcriptHost 挂点 :219-280）· `ChatTabProvider.tsx`（attach effect :279-308、transcriptReadyEpoch）· `useChatTabStream.ts`（defaultChatScrollToBottom）· `useInterruptedPartialCommit.ts`（readyEpoch 去重）· `src/components/chrome/AndroidKeyboardClipBody.tsx`（不动）

**行为层纯函数（直接复用）**：`src/webview-host/chat-transcript/scroll.ts`（nearBottom/scrollTopForBottom/scrollTopAfterPrepend/clampScrollTop）· `src/web/chat-transcript/stream/block-split.ts`（splitStreamBlocks）· `src/web/shared/constants.ts`（NEAR_BOTTOM_THRESHOLD_PX=80 真源）

**行构建（复用）**：`src/components/chat/message-blocks.ts`（buildTranscriptRows*/toolCallViewFromUse/buildToolPairingContext）· `enrich-transcript-rows.ts`（改产 markdown 而非 textHtml）

**行组件资产（零引用待翻新）**：`src/components/chat/{ToolCallCard,ToolCallGroupCard,ThinkingBlockCard,ToolTurnPhaseBar}.tsx`

**渲染库（已装 1.1.1，display 零引用）**：`react-native-enriched-markdown`（EnrichedMarkdownText：markdown/flavor/markdownStyle/linkVariants/contextMenuItems/onLinkPress/onCopyPress；github=表格+代码块 header）· mock：`test-utils/enriched-markdown-mock.tsx` · patch：`patches/react-native-enriched-markdown+1.1.1.patch`（仅 input 侧，display 零重叠）

**胶囊/内链（复用）**：`native-composer/token-ranges.ts`（nmtoken:// nmskill:// + synthesizeTokenMarkdown）· `packages/core/src/domain/chat/logic/resolve-chat-link-target.ts` · `chat-link-nav.ts`

**rikkahub 模式参照**：`.reference/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/pages/chat/ChatList.kt`（itemsIndexed key=id :315、贴底跟随 :278-289、overshoot）· `ui/components/richtext/Markdown.kt`（MarkdownBlock 后台解析 :234-274）· `data/model/Conversation.kt`（updateCurrentMessages 仅尾 copy :59-89）· `ui/hooks/ImeAutoScroller.kt`

**web 行为对照（等价替换的语义基准）**：`src/web/chat-transcript/webview/runtime/scroll/scroll.ts` · `boot/bind-shell-events.ts`（ResizeObserver→stickIfNearBottomNow）· `render/row-windowing.ts`（EWMA 蓝本）

**退役清单**：附录 C。

## 附录 B：数据不变量（D1–D12，测试钉死不许漂）

D1 snapshot() 水合前 null/interrupted 水合前空集 · D2 subscribe 退订+64ms 节拍 · D3 流式只推当前 focused 句柄（§3.3-1；无 focused 不推、partial 单元累积——机制于 R3 并发轮更新）/控制全广播 · D4 每订阅恰好注入一次+injectedInto 句柄级去重（§3.3-8——机制于 R3 并发轮更新） · D5 messages 引用稳定 · D6 tail 40+1 判 hasMore · D7 窗口水合仅冷启动 · D8 loadOlder 首行 seq 锚+同步写 cache · D9 收尾 force reload 刷 cache · D10 idle 路径不参与 LRU 淘汰 · D11 合成行 runId:settledAtMs+readyEpoch 去重 · D12 interrupted 解锁分支。（证据行号见 E4 报告 §4.1，已存档）

## 附录 C：退役清理点（22 项）

**A 构建产物**：1 `build-webview.mjs` PACKAGES(:243-253) 2 `WEBVIEW_CORE_ALLOWLIST['chat-transcript']` 60 条(:66-167) 3 `webview-compat-baseline.json` 删段 4 pruneDist/copyDistToNativeSinks 三端目录（android assets / ios WebViewDist 假绿坑）
**B 守卫面**：5 `webview-asset-uri.ts` 联合类型 6 `android/app/build.gradle:179` checkWebViewAssets+javadoc 7 **iOS 面零改动**（pbxproj copy 脚本存在性断言清单与 `IOS_HISTORY_PACKAGES` 锁的是历史包 chat-conversation，从无 chat-transcript——守卫注释口径即如此，无需也不得改） 8 `src/web/tsconfig.json` include(:27-28) 9 README.md(:143,:170,:232,:239-255,:270) 10 `webview-asset-guard.test.ts` 断言更新
**C RN 源码**：11 `src/webview-host/chat-transcript/` 整目录（scroll.ts 先迁再删；anchored-menu-layout.ts=web 划词菜单锚定计算，RN 长按菜单锚定可参考其算法但不复用 web 实现，随目录退役；uri.ts=webview URI 规整，退役） 12 `ChatConversationWebView.tsx`(1891 行)+`ChatTranscriptWebViewHandle.ts` 13 `session-stream-webview-adapter.ts`（改签 native） 14 `ChatTranscriptBridge.ts`(v1,321 行)+`ChatConversationBridge.ts` 转录段 15 `message-blocks/enrich-transcript-rows/prepare-stream-tail-html/snapshot-chunk-bounds/chat-transcript-selection-menu/conversation-theme` 逐件判复用/退役 16 `SubagentSessionScreen.tsx` transcriptOnly 段 17 `src/services/chat-transcript-telemetry.ts` 18 `src/web/chat-transcript/` 37 文件（shared 共享件除外）
**D 测试**：19 read-webview-dist 联合类型+9 消费套件（转录 6 退役、另 3 保留不属本迭代）

---

## 附录 D：并发考古依据（B 路报告摘要，2026-10-13 专项轮）

**事故世代索引**（详档：docs/apm/memory/20261005-chat-concurrent-msg-mixup-brain-storm.md、20260913-reload-busy-period-probe.md、20260830-four-issues-brain-storm.md、20261001-chat-webview-unify-spec.md；docs/Iterations/transcript-session-isolation/spec.md、chat-webview-unify/{spec.md,exit-jank-fix-playbook.md,bugs/}、session-stream-unit-2026-09/{prd,spec}.md、main-session-stream-resume/spec.md）：

- **世代 A（单槽换绑，2026-06~09）A1-A9**：串会话消息/后台收尾丢失/subagent 父屏不刷新/统计串号/任务卡灰置/【生成中】残留（六轮插桩定案：native-stack 压栈冻结 WebView 表面）/重进 partial 丢失/streamRegistry 陈旧事件/max_steps 不清态 → §3.3-1/2/4/8 逐条对应。
- **世代 B（单元化重构，v1.5.18~26）**：B1 HANDLE-NULL（startRun 替换吸收时句柄注册表清空→新 run 全程无句柄；修法=takeWebviewHandles 迁移）→ §3.3-8；B2 三段式错段（step 边界尾块未重置）→ §3.3-4 触发点②；B3 列表抖动（贴底钳制误判上滚）→ §5.2 行为层贴底守卫；B4 dirty 重挂只剩当前回复 → §3.3-8。
- **世代 C（unify+SPA，2026-10-01~05，问题最密集）**：C1 进出会话四层卡顿（chip 轮 2.2s 堵死 JS 线程——重活与交互竞争与 webview 无关）→ §3.3-3/9 + §5.3 后台线程；C4 并发会话串台四路径（tsi 修复 dev-ready 未合入，v1.5.37 rollback-spa 后「随回滚从根消失」）→ §3.3-2 显式重建；C9 分片在途丢行（CR P0）→ §3.3-4 交错判路；C10 分片代次/乱序 → §3.3-9 取消对账思想。
- **世代 D（composer-native）**：信封版本错位白屏（v2→v1 下译缺失、静默丢弃）——随包退役消失，无需对偶。
- **世代 E（并行奠基）E1-E3**：agentActive 泄漏/FGS 单通知/跨项目点按——数据面已修已保留，不属本轮。

**两条关键判定**：
1. webview 时代「会话内切换陈旧投影帧」的防护 = key 重挂兜底（tsi r2 的身份比对判据从未上线）——RN 化重挂消失，§3.3-2 为**显式重建项**而非新增需求。
2. 「串台随 rollback-spa 从根消失」仅有 CHANGELOG 单方陈述、无专项复验记录——§9 DoD-7 并发 e2e 兼作补验。

**webview 特有、退役即消失的病（勿当需求）**：8s 握手兜底/前后台渲染进程自愈/visibility 脏重挂/安全链接管家/信封版本协商/能力协商降级——原生单进程无此面，不做对偶（区别于「问题仍在、机制要翻译」清单，见 B 路报告第二节逐条标注）。 20 webview-mock 去留（rich-document 等仍用，留） 21 knip/eslint X3 覆盖自动收缩确认
**E 保留件**：22 `chat-transcript-scroll-cache.ts`+`chat-transcript-engine.ts`（宿主无关/历史锚点）
