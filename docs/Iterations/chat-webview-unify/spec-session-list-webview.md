# chat-webview-unify 第二阶段：会话列表进 WebView（SPA 化，消灭进出会话销毁重建）

## 背景与目标

第一阶段已把对话页（转录+dock）合并进 `chat-conversation` 单文档。用户真机实测确认：进出会话卡的主体是 **WebView 销毁重建**（`chatSubview` 条件渲染 + `key={chatScrollKey}` 强制重挂）。本阶段把**会话列表视图搬进同一文档**，列表↔对话 = 文档内视图切换，切换零销毁零握手。

**用户方向拍板（2026-10-01）**：不采用「保活」补丁（RN 结构不变+WebView 藏着）——直接整体单 WebView，治本。

## 范围

**做**：ChatSessionListPanel 的 sessions 分支内容（ManageHeader「会话」标题+新建按钮、FlatList 会话行、空态、⋮ 菜单交互、长按进批量）进 `chat-conversation` 文档，成为与对话视图平级的 `list` 视图。

**不做（留 RN）**：AppHeader（项目名/项目列表按钮/返回键）、「会话|项目工作区」SegmentedControl、projects 分支（VfsFileManager）、项目抽屉、BottomSheetMenu/Alert 原生弹层、底部 MainTabs。

## 架构

### 1. web 侧：文档内双视图路由

- `index.html` 的 `#app` 下新增 `#session-list` 视图容器，与对话视图（`#scroller`+`#composer-dock`）平级；文档根挂 `data-view="list" | "conversation"`，CSS 按根属性切视图显隐（`display:none`）。
- 新模块 `web/chat-conversation/webview/session-list.ts`：渲染列表（标题/相对时间/三徽标[生成中|已中断|当前]/活跃中 meta/⋮/›/空态）、绑定点击/长按/⋮ 上报。**薄渲染**：零业务逻辑，全部动作上行。
- 列表滚动：会话数通常 <200，首轮**全量渲染**（不做窗口化——转录区的 row-windowing 硬绑 `#scroller`/`#rows`，复用成本高于收益；性能不达再立项）。
- 新建会话按钮、ManageHeader 标题同入列表视图。
- dock 在 list 视图隐藏（`data-view` 属性联动 CSS）。

### 2. 桥协议扩展（v:2 域，经入口 createBoundPost(2)；下行走 dispatcher 路由表）

- **下行 `sessionList`**（dock 域旁新增第四域或挂 transcript 域旁的独立分支——落 `model.ts` 第四张表 `CONVERSATION_LIST_TYPES`）：
  `{type:'sessionList', sessions: Array<{id, title, updatedAtMs, active, interrupted, current}>, batchSelect?: Array<string>}`
  （RN 侧 reloadLists 与 manager 订阅的数据快照；切视图时与数据变化时推送）
- **下行 `viewState`**：`{type:'viewState', view: 'list' | 'conversation'}`（宿主把 chatSubview 映射下发；web 切 data-view）
- **上行 `listAction`**（v:2，入 `ConversationWebToHostV2Type`）：
  `{type:'listAction', kind: 'open' | 'create' | 'menuOpen' | 'rename' | 'copy' | 'delete' | 'stopRun' | 'longPress' | 'batchToggle', sessionId?: string}`
  （业务全留 RN：open 走 openConversation 状态机、delete 弹原生确认、rename 走既有 prompt、stopRun 走 manager）
- 同步改五处：Bridge `ConversationHostMessage` 联合 / web `model.ts` 表 + `ConversationRoute` / `dispatcher.ts` 分支 / 宿主 `handleUpstream` 分支 + `onListAction` prop / memo 比较器加列表数据字段。桥测试双端比对同步。

### 3. RN 侧结构（ChatTabScreen 重构）

- `ChatConversationPanel` **常驻**（去掉 `chatSubview === 'conversation'` 条件渲染）；`chatSubview` 作为 prop 进面板 → 映射 `viewState` 下发。
- `ChatConversationPanel` **去 `key={chatScrollKey}`**；sessionId 变化驱动内部重置（见 §4）。
- `ChatSessionListPanel` 退役路径：sessions 分支内容删除（数据/动作已在宿主层）；面板壳（SegmentedControl + projects 分支 VfsFileManager）保留，sessions 态时面板壳**层叠在 WebView 上方**（web 列表视图透出，SegmentedControl 背景实底遮住 WebView 顶部不需要——布局：SegmentedControl 在 WebView 容器之上独立行，WebView 列表视图在其下方 flex 区域）。
- 首次挂载（chat tab 冷启动）：WebView 以 list 视图启动（`init` 时带 `view:'list'`——init payload 扩一个字段，默认 conversation 兼容旧链/子会话屏）。
- 键盘态：list 视图无输入，`AndroidKeyboardClipBody` 保持（键盘只在 conversation 视图有意义，list 态键盘收起由 RN 保证）。

### 4. 会话切换重置链改造（去 key 后 sessionId 驱动）

探索确认的依赖挂载触发的环节，改为 `[sessionKey]` effect 驱动（锚点来自探索报告）：
- `armReadyTimeout` 依赖 `sessionKey`（:2086 已有）——保留但**ready 只在首挂握手一次**，切会话不重走 8s 兜底（web 不重挂 ready 不变）；
- `:1880-1887` sessionKey 重置分支（prevStream* 清空 + needsOpenSnapshotRef）——已有，保持；
- `:1456-1464` ready 清场（webTextRef/lastSelectionRef/pendingSelection）——从「ready 时」改为「sessionKey 变化时」执行；
- deferred 队列：快照代次（generation）机制天然覆盖（新快照整替换 rows，web 侧 `sessionKey` 字段变化清流 :209-251 已有）；
- `init` 重发：sessionKey 变化 → 重发 init（theme/flags 不变也发——幂等）+ 快照开屏（needsOpenSnapshotRef 已置）。
- 草稿：controller 的水化 effect `[sessionId, draftRestoreToken]` 已有——验证切会话时 M1（lastValueRef 先推进）与 setText 顺序不破。

### 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 列表滚动性能（web 无虚拟化） | 会话量级小（<200）全量渲染；不达性能基线再立项窗口化 |
| 返回键链（chatSubview 判定 :116-127） | chatSubview 状态机不变，RN 侧仍感知（viewState 只是它的投影）——返回键零改动 |
| e2e 选择器（新建会话/新会话1/⋮ 移入 web context） | e2e 页对象随后迁移（app.page 的 createSession/openLatestSession/openRowMenu 切 web context；本轮实现后单独小步修） |
| 长按手势（web touch → 长按判定） | 自实现 pointerdown/up 计时（350ms）+ 移动取消；仅进批量一个语义 |
| web 列表视图在 conversation 态仍渲染（display:none） | CSS 隐藏零渲染成本；数据推送仅在 list 态（viewState 联动） |

## 测试面

- web 侧：session-list 渲染单测（FakeElement 桩，照 dock.test 底座）+ dispatcher 路由两新 type + viewState 切 data-view 断言。
- 桥测试：双端 type 集合相等断言扩展（新第四域）。
- RN 侧：chat-tab-screen.integration（列表↔对话联动大改——findPressableByText 的列表行交互改为 mock onListAction 驱动）；chat-conversation-webview.test（sessionKey 变化重置链新行为）；chat-session-list-panel.test 退役/迁移。
- e2e：T-CU12 不受影响（对话视图判据不变）；列表相关页对象迁移后单跑验证。

## 分波

- **wave-1（web 半边 + 协议双端）**：index.html 双视图容器 + CSS + session-list.ts 模块 + model/dispatcher/入口扩展 + Bridge 双端声明 + web/桥测试。
- **wave-2（RN 半边）**：ChatTabScreen/Panel 重构（常驻+去 key）+ 宿主接线（sessionList 下行/listAction 上行/viewState）+ 重置链改造 + 列表面板退役 + RN 测试迁移。
- **wave-3**：全量门（jest 全量 + tsc 三面）+ e2e 迁移 + 重打 APK 真机验证（键盘残影修复一并带上）。

## 状态

- spec 定稿：2026-10-01（用户方向拍板：整体单 WebView，不做保活）
- 执行：wave-1 派遣中
