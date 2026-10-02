---
zone: w9-mobilenav-pro
agent: 检察官（对抗机位 / 猎杀死屏、路由契约违反、冗余）
files_scanned: 68
lines_scanned: 11864
---

# w9-mobilenav-pro —— 移动端导航/栈屏/hooks 检察官报告

## 摘要

移动端 UI 外壳：底部双 tab（对话 / 我的）+ 27 条原生栈路由，含全部 stack 屏
（文件编辑器、会话详情、技能管理、数据统计、提示词预览等）、15 个通用 hook
（批量多选、聚焦重载、脏数据守卫、Android 返回键/键盘避让）、GitHub 更新检查
链路（5 文件）、3 个纯工具函数与导航配置三件套（types/header-config/RootNavigator）。
本区不含 `screens/tabs/chat-tab/**`（另一机位负责）与 `components/**`。

## 职责与边界

- **路由契约的唯一声明处**：`navigation/types.ts` 的 `RootStackParamList`。
- **路由注册与栈壳**：`navigation/RootNavigator.tsx`（27 个 `withStackLayout`
  包装屏 + 2 tab），`StackScreenLayout.tsx`（AppHeader + 返回）。
- **header 动态覆盖**：`HeaderContext.tsx`（`useStackOverrideSetter` 按 route.key
  过滤，避免转场期串屏）+ `header-config.ts`（静态标题表）。
- **每屏自持状态与数据加载**，路由参数只做入口定位。
- **不动**：core / VFS / webview 管线 / chat-tab 内部。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `RootStackParamList` | `navigation/types.ts:12` | 30 条路由的参数契约 |
| `HeaderPageKey` / `PAGE_HEADER_CONFIG` | `navigation/header-config.ts:6,14` | 静态标题表（29 键） |
| `RootNavigator` | `navigation/RootNavigator.tsx:199` | 导航根 |
| `navigationContainerRef` | `navigation/navigation-container-ref.ts:11` | React 树外编程式导航（通知点按） |
| `useStackOverrideSetter` | `navigation/HeaderContext.tsx:72` | 屏级 header 覆盖 |
| `useFocusListReload` | `hooks/useFocusListReload.ts:37` | rows/loading/error + 聚焦重载 |
| `useBatchSelection` / `useBatchDeleteConfirm` | `hooks/useBatchSelection.ts:6` / `useBatchDeleteConfirm.ts:23` | 批量态 |
| `useUnsavedGuard` | `hooks/useUnsavedGuard.ts:9` | beforeRemove 拦截 |
| `useAndroidChatBackHandler` | `hooks/useAndroidChatBackHandler.ts:48` | 硬件返回键状态机 |
| `useVfsBackNavigation` | `hooks/useVfsBackNavigation.ts:14` | 文件浏览器返回三件套 |
| `useAutoUpdateCheck` | `hooks/useAutoUpdateCheck.ts:31` | 启动 2s 后自动查更新 |
| `useMobileScope` | `hooks/useMobileScope.ts:7` | 全局 project/session scope |
| `checkForUpdates` | `update-check/check-for-updates.ts:13` | 版本比对编排 |
| `resolveLatestRelease` / `parseReleaseTag` | `update-check/resolve-latest-release.ts:43` / `parse-release-tag.ts:7` | GitHub API + tag 归一 |
| `nextDefaultSessionTitle` / `formatRelativeTimeMs` / `pickEntityIcon` | `utils/*` | 纯函数 |

## 数据访问

本区自身**不直接开库**，全部经 `useRuntime()` → `runtime.*` 服务：

- `runtime.physicalVfs()` — `GlobalTemplateScreen.tsx:51`
- `runtime.globalMetaVfs()` / `projectMetaVfs()` — `FileEditorScreen.tsx:117,122`；`SkillDetailScreen.tsx:91,92`
- `runtime.sessionVfs/projectVfs` — `SubagentSessionScreen.tsx:200,201`
- `runtime.sessions.get/rename` — `SessionDetailScreen.tsx:81,111`
- `runtime.providerModels.*` — `ModelSamplingScreen.tsx:94,153,167`；`ProviderDetailScreen.tsx:158,165,205`
- `runtime.usageStats.*` — `TokenUsageStatsScreen.tsx:136,188,283`
- `runtime.skills().*` — `SkillPanelScreen.tsx:65,102`；`SkillsSettingsScreen.tsx:112,116,198`
- `runtime.smartSortRule.*` — `SmartSortRulesScreen.tsx:57,78,143`；`SmartSortRuleEditorScreen.tsx:232`
- `runtime.messages.searchMessages` — `ChatHistorySearchScreen.tsx:161`
- 通知权限/偏好 KKV — `ChatConfigScreen.tsx:71,85,92`（`appUi` 域，非 core KKV）
- GitHub Releases API（外网）— `update-check/resolve-latest-release.ts:49`

## 依赖关系

**import 谁**：`@novel-master/core`（`/vfs` `/chat` `/skills` `/prompt` `/format`
`/agent` `/compaction` `/feature-flags` `/common`）、`../runtime/novel-master-context`、
`../theme/ThemeProvider`、`../components/chrome/*`（AppHeader / ToastHost /
EditorScreenShell / CloudSyncProgressPanel）、`../components/vfs/VfsFileManager`、
`../services/*`（compaction-warm-orchestration、prompt-preview、vfs-zip、
update-check-flow、app-toast）。

**被谁消费**：
- `navigation/types.ts` → 全部 68 文件 + `components/**`（AppHeader、EditorScreenShell 等）
- `PAGE_HEADER_CONFIG` → `AppHeader.tsx:31`（`pageKey: keyof typeof PAGE_HEADER_CONFIG`）
- `useRuntime` → 几乎所有屏
- `listScreenStyles` → 6 个列表屏（`ProviderDetailScreen/ProvidersScreen/SearchEnginesScreen/SkillPanelScreen/SkillsSettingsScreen/SmartSortRulesScreen`）
- `useFocusListReload` → 6 屏（ProviderDetail/Providers/SearchEngines/SkillPanel/SkillsSettings/SmartSortRules）
- `useDismissOverlaysOnBlur` → 7 处（含 `components/agent/AgentList.tsx:146`、`components/vfs/VfsFileManager.tsx:260`）
- `useAndroidChatBackHandler` → `ChatTabScreen.tsx:86`
- `useVfsBackNavigation` → `GlobalTemplateScreen.tsx:25`、`SkillDetailScreen.tsx:71`
- `checkForUpdates` → `AboutScreen.tsx:82`、`services/update-check-flow.ts:50`
- `navigationContainerRef` → `services/agent-finished-notification.ts:487`（惰性 require）
- `nextDefaultSessionTitle` → `chat-tab/useChatTabScope.ts:477`
- `formatRelativeTimeMs` → `ProjectDrawer.tsx:185`、`ChatSessionListPanel.tsx:277`
- `pickEntityIcon` → `AgentList.tsx:389`、`ProjectDrawer.tsx:169`

## 发现清单

---

### F-w9-mobilenav-1 | P1 | `navigation/types.ts:51-52` + `FileEditorScreen.tsx:60,190`

**死路由参数：函数进 params（`onSessionVfsSaved`），全仓零调用方传它。**

```ts
// navigation/types.ts:51
/** Called after a successful session-scope save (refreshes workspace list). */
onSessionVfsSaved?: () => void;
```

```
// FileEditorScreen.tsx:60
const {path, scopeKind, projectId, sessionId, skillRef, onSessionVfsSaved} = route.params;
// :190  session scope 保存成功后
onSessionVfsSaved?.();
```

**描述**：这是本区最典型的「函数进 params」反模式，且是**双重违规**：

1. React Navigation 明确要求 route params 可序列化（state 持久化 / `navigate`
   的 `merge` 语义都建立在结构化可克隆的前提上）。本仓自己也在
   `navigation/types.ts:59-61` 为 `PromptEditor` 写下了相反的约定——
   「回调不走路由参数（不可序列化），由 prompt-editor-callback 模块级存取」，
   并在 `PromptEditorScreen.tsx:103-107` 照此实现。`FileEditor` 是同一份
   param list 里的直接反例，说明当时的收口只做了一半。
2. 没有任何调用方传它。全仓 6 处 `navigate('FileEditor', ...)` 调用点
   （`GlobalTemplateScreen.tsx:29`、`SkillDetailScreen.tsx:96`、
   `SubagentSessionScreen.tsx:185/215/222`、`chat-tab/useChatTabScope.ts:625/632`）
   传的都是 `{path, scopeKind, projectId?, sessionId?, skillRef?}`，
   唯一传 `skillRef` 的那处也不带回调。`onSessionVfsSaved?.()` 恒为 no-op。

**建议**：删掉 `types.ts:51-52` 的声明与 `FileEditorScreen.tsx:60/190` 的
解构/调用。若「session 保存后刷新工作区列表」这个需求仍然存在（`comment`
暗示曾经有过），按 `PromptEditor` 的既有先例走模块级单槽回调
（`takeXxxOnSaved()` 读后即清），不要留在 params 里。

**置信**：confirmed（6 处调用点已逐一定位核对）

---

### F-w9-mobilenav-2 | P1 | `SessionDetailScreen.tsx:397` + `RealPromptScreen.tsx:23` + `types.ts:16`

**无参路由 `RealPrompt` 取全局 scope，从带参屏跳入时会展示错会话的提示词。**

```ts
// SessionDetailScreen.tsx:394-397（屏内持有 projectId/sessionId 两个 route 参数）
{/* 查看提示词：跳转到 RealPromptScreen，预览当前会话实际发送的提示词。 */}
<Pressable testID="real-prompt-row" onPress={() => navigation.navigate('RealPrompt')} ...>
```

```ts
// types.ts:16
RealPrompt: undefined;
// RealPromptScreen.tsx:23,29-34
const {projectId, sessionId} = useMobileScope();
if (projectId == null || sessionId == null) { setError('请先选择项目与会话'); ... }
```

**描述**：`RealPrompt` 是 `RootStackParamList` 里唯一一条「**内容依赖某个具体
会话、但参数为空**」的路由。屏内明明已经握着 `route.params.projectId` /
`sessionId`（`SessionDetailScreen.tsx:67`），却丢掉它们改读全局 scope
（`useMobileScope` → `PersistentState` 的 currentProject/currentSession）。

这不是理论风险，有具体反例路径：`SessionDetail` 本身可以被**以非当前
scope 打开**——`SubagentSessionScreen.tsx:171` 跳 `SubagentSessionView` 传的是
子会话的 `sessionId`，而 `chat-tab` 的 task 卡片链路（`useChatTabScope.ts:659`）
用子会话 id 导航。若子会话屏/详情屏链路后续引入「查看提示词」入口（这正是
本行注释所暗示的意图），`RealPrompt` 会渲染**当前 scope**（可能是主会话）
的提示词，而用户以为在看刚点开的那个会话。静默错内容，不报错、不空态。

对比同文件 `:366` 的 `ChatHistorySearch` 入口——它老老实实传了
`{projectId, sessionId}`，而 `:397` 的 `RealPrompt` 没传。同一屏内两种写法。

**建议**：`RealPrompt` 改为带参路由 `RealPrompt: {projectId: string; sessionId: string}`，
`SessionDetailScreen.tsx:397` 传 `{projectId, sessionId}`，
`RealPromptScreen.tsx:23` 改读 `route.params`，删掉 `useMobileScope` 依赖与
`:29-34` 的 null 早退分支。若确要保留「当前会话」语义，则至少让
`RealPromptScreen` 在 `projectId/sessionId` 与进入来源不一致时显式提示，
而不是默默换会话。

**置信**：confirmed（参数读取点与两条 `navigate` 调用点已核对；错配路径依赖
后续新增入口，故「必然触发」不成立，但契约缺口本身已确证）

---

### F-w9-mobilenav-3 | P2 | `navigation/HeaderContext.tsx:33-50` + `navigation/types.ts:92-100`

**`chat` / `setChat` / `ChatHeaderContext` 整条链已死，chat 顶栏改读
`ChatTabNavContext` 后旧 context 没清。**

```ts
// HeaderContext.tsx:33-34
chat: ChatHeaderContext;
setChat: (patch: Partial<ChatHeaderContext>) => void;
// :42-50
const [chat, setChatState] = useState<ChatHeaderContext>({...});
const setChat = useCallback((patch) => { setChatState(prev => ({...prev, ...patch})); }, []);
```

**描述**：`AppHeader.tsx:28` 实际读的是 `useChatTabNavigationOptional()`
（`ChatTabNavContext`，`navigation/ChatTabNavContext.tsx:45`），并在
`:48-69` 从 `chatNav.state/actions` 取全部顶栏字段。`HeaderContext` 里这套
`chat` state 已无任何写入方：`setChat` 的调用点全仓为 0（27 处 `setChat`
文本命中全是 `setChatRichTextEnabled` / `setChatSubview` / `setChatState`
的无关前缀），`ChatHeaderContext` 的 4 个字段里
`onBackFromConversation`（`types.ts:98`）与 `onOpenDrawer`（`types.ts:99`）
全仓各只出现 1 次（即自身声明处），已随迁移搬到
`ChatTabNavContext.tsx:20,27` 的同名 action。

结果：`HeaderProvider` 每次渲染都白白跑一次 `setChatState` 的 state 槽位 +
`useMemo`（`:52-55`）把死值塞进 context value，导致所有
`useHeaderContext()` 消费者（`AppHeader.tsx:27`、`useStackOverrideSetter`）
在 chat 字段变化时**无谓重渲染**——虽然当前没人改它，但这是个装了引信的地雷。

**建议**：删 `HeaderContext.tsx:33-34,42-50,53-54` 的 `chat`/`setChat`/`setChatState`
与 `useMemo` 里的对应项，以及 `types.ts:92-100` 的 `ChatHeaderContext`。
`useHeaderContext()` 返回类型收窄为 `{stackOverride, setStackOverride}`。

**置信**：confirmed（`setChat` 零外部写入已逐符号 grep 核对；`onBackFromConversation`
与 `onOpenDrawer` 在 `types.ts` 外零命中已核对）

---

### F-w9-mobilenav-4 | P2 | `hooks/useStreamTailGenerating.ts:1-13`（整文件）

**整文件零引用死代码。**

```ts
/** Stream tail「生成中」：与 uiRunning 同生命周期。 */
export type StreamTailGenerating = { readonly streamTailGenerating: boolean; };
export function useStreamTailGenerating(uiRunning: boolean): StreamTailGenerating {
  return {streamTailGenerating: uiRunning};
}
```

**描述**：`useStreamTailGenerating` / `StreamTailGenerating` /
`streamTailGenerating` 三符号在 `apps/mobile/src` 全树只出现在本文件内部
（各自 1 处 / 3 处，无外部 import）。且该 hook 名为 `use` 但不含任何
hook 调用——纯恒等函数（`{a} → {a: a}`），即便接回去也只是一层无意义包装。

对照 RULE.md 已记的同类退役先例（`stream-watchdog.ts` 退役后「导出保留」、
`useAgentStreamMetrics` 注释里写的「hook 本体退役——数据源已由
SessionStreamUnitManager 投影承担」），本条属于同一类清理欠账，
且比那些更彻底：连导出保留的理由都不成立。

**建议**：删除 `hooks/useStreamTailGenerating.ts` 整个文件。

**置信**：confirmed

---

### F-w9-mobilenav-5 | P2 | `RootNavigator.tsx:97-103` + `ProviderDetailScreen.tsx:106`

**`withStackLayout` 返回的 `Wrapped` 丢弃 props；`Stack.Screen` 的
`initialParams`/`options` 通道对所有包装屏关闭。**

```tsx
// RootNavigator.tsx:93-104
function withStackLayout(pageKey: keyof RootStackParamList, Screen: React.ComponentType) {
  return function Wrapped() {
    return (<StackScreenLayout pageKey={pageKey}><Screen /></StackScreenLayout>);
  };
}
```

**描述**：`Screen` 被声明为无参 `React.ComponentType`，`Wrapped` 也不接
`props`——即包装屏拿不到 React Navigation 注入的任何 screen props。
目前 `27` 个屏全部走 `useRoute()` 自取参数，所以没暴露问题；但这意味着
**任何走 `Stack.Screen` 的 `options`（如 `initialParams`）都不会到达业务屏**。
`RootNavigator` 里已有两处 screen 级 option（`:225` RealPrompt
`animation:'none'`、`:248` CloudSyncProgress `gestureEnabled:false`），
都是纯导航库消费、不需要透传，掩盖了这个限制。

`ProviderDetailScreen.tsx:106` 在 `fetcher` 内部调
`setStackOverride({title: provider.displayName})` 写动态标题——这是当前
唯一可行的动态标题机制（`useStackOverrideSetter` 按 route.key 过滤），
也说明动态 header 需求确实存在，但它把「副作用」放进了数据加载回调里
（`fetcher` 由 `useFocusEffect` 驱动，见 `:141-145` 的 blur 清理），
标题的存活期与 `fetcher` 的执行耦合：`fetcher` 抛错时（`:118-120`）
标题不会被写，而 `:141` 的 cleanup 只在失焦时跑。

**建议**：给 `withStackLayout` 的 `Screen` 形参补上 props 透传
（`React.ComponentType<Record<string, unknown>>` 或直接
`React.ComponentType<any>` + `{...props}` 展开），让 screen props 通道
可用；同时把 `ProviderDetailScreen` 的 `setStackOverride` 从 `fetcher` 里
挪到独立的 `useEffect`（依赖 `provider`），解耦「加载成功」与「设标题」。

**置信**：suspected（`Wrapped` 丢弃 props 是确证的；但因 27 屏均走
`useRoute`，当前无实际功能损失，定级 P2 而非 P1）

---

### F-w9-mobilenav-6 | P2 | `GlobalTemplateScreen.tsx:51` + `SkillDetailScreen.tsx:89-92`

**每次渲染新建 VFS service 实例，传入 `VfsFileManager` 的 `vfs` prop。**

```tsx
// GlobalTemplateScreen.tsx:51
vfs={runtime.physicalVfs()}
// SkillDetailScreen.tsx:89-92
const fileVfs = domain === 'global' ? runtime.globalMetaVfs() : runtime.projectMetaVfs(projectId!);
```

**描述**：`createMobileRuntime` 把这些工厂暴露成**每次调用 new 一个实例**的
函数（`runtime/create-mobile-runtime.ts:179-187`：
`globalVfs: () => createScopedVfsService(conn, {...})`）。本区两处在渲染
体内直接调用，参考引用每次渲染都变。

`VfsFileManager` 内部虽然有 `vfsRef` 兜底（`components/vfs/VfsFileManager.tsx:278,285`
——`vfsRef.current = vfs` 每渲染同步，`reload` 读 `vfsRef.current` 而非闭包
`vfs`，`:314`），所以**不会**触发无限重载循环。但 `vfs` 仍出现在多个
`useCallback` 依赖数组里（`VfsFileManager.tsx:473`、`:582`），引用每次渲染
都变 → 这些 callback 每次渲染重建 → 下游 memo 全废。

RULE.md 已就同类问题立过规矩（workplace 工厂「每次调用 new 新服务实例，
循环内反复获取会使并发去重跨 step 失效——agent-runner 已提升到循环外，
新调用方勿再踩」）。这里虽未造成数据错误，但已踩中「渲染体内 new 服务」
的同款形状。

**建议**：两处都提到 `useMemo`（依赖 `runtime` / `domain`+`projectId`）：
`const vfs = useMemo(() => runtime.physicalVfs(), [runtime])`；
`const fileVfs = useMemo(() => ..., [runtime, domain, projectId])`。

**置信**：confirmed（`createMobileRuntime.ts:179-187` 的工厂形状与
`VfsFileManager.tsx:285,314,473` 的消费方式均已核对）

---

### F-w9-mobilenav-7 | P2 | `ModelSamplingScreen.tsx:88-91` + `:129-134`；`ProviderDetailScreen.tsx:101-104` + `:147-152`

**缺参守卫重复两份，且其中一份是无效早退。**

```ts
// ModelSamplingScreen.tsx
:88   if (!savedModelId) { setLoading(false); return; }        // load 内
:129  useEffect(() => { if (!savedModelId) { showToast(...); navigation.goBack(); } }, ...);  // 独立 effect
```

**描述**：两个屏（`ModelSamplingScreen` / `ProviderDetailScreen`）都用同一套
「route 参数声明为可选（`types.ts:20` `savedModelId?: string`、
`:19` `providerId?: string`）→ 屏内再补一个 toast + `goBack()` effect」的
写法。问题是 `load`/`fetcher` 里**又各写了一遍** `if (!param) return null`
早退（`ModelSamplingScreen.tsx:88`、`ProviderDetailScreen.tsx:101`），
与 effect 的 `goBack()` 逻辑重叠。

更实质的问题：**类型契约把必填参数声明成了可选**。
`ModelSampling: {savedModelId?: string} | undefined`、
`ProviderDetail: {providerId?: string} | undefined`、
`AgentEditor: {agentId?: string} | undefined`、
`SmartSortRuleEditor: {ruleId?: string} | undefined`——四条路由的参数
都是 `?` 可选，代价是每个消费点都得写防御性早退 + toast + goBack
（`ModelSamplingScreen.tsx:88,130,137` 三处判同一个 `savedModelId`；
`ProviderDetailScreen.tsx:101,148,155` 三处；`AgentEditorScreen.tsx:19,26`
两处）。而全仓 `navigate` 调用点**无一例外都传了值**
（`ProviderDetailScreen.tsx:308`、`ProvidersScreen.tsx:180`、
`AgentList.tsx:249,368,375`、`AgentsSettingsScreen.tsx:33`、
`SmartSortRulesScreen.tsx:70,117,346`）。

`SmartSortRuleEditor` 的 `ruleId?` 是**真有意义的**（`SmartSortRulesScreen.tsx:70`
`navigate('SmartSortRuleEditor', {})` 走新建分支），`AgentEditor` 的
`agentId?` 则是纯冗余（4 处调用点全传）。这几条应区别对待：
真可选的留 `?` 并在注释里写明「缺省 = 新建」，其余改必填，删掉屏内早退。

**建议**：`ModelSampling` / `ProviderDetail` / `AgentEditor` 的参数改必填
（`{savedModelId: string}` 等），删掉 `types.ts` 的 `? | undefined`；对应删
`ModelSamplingScreen.tsx:88-91` 与 `:129-134`、`ProviderDetailScreen.tsx:101-104`
与 `:147-152` 中不再需要的早退/守卫（保留 `handleSave` 里的
`if (!savedModelId) return` 会被 TS 收窄掉，可一并删）。
`SmartSortRuleEditor` 保持可选，补一行注释说明 `{}` = 新建。

**置信**：confirmed（8 处 `navigate` 调用点与 6 处屏内守卫已逐一核对）

---

### F-w9-mobilenav-8 | P3 | `types.ts:86` + `SessionDetailScreen.tsx:366` + `ChatHistorySearchScreen.tsx:113`

**`ChatHistorySearch` 收 `projectId` 但屏内从不读。**

```ts
// types.ts:86
ChatHistorySearch: {projectId: string; sessionId: string};
// ChatHistorySearchScreen.tsx:113
const {sessionId} = route.params;   // projectId 未解构，全文无第二次出现
```

**描述**：`findstr /c:"projectId" screens\stack\ChatHistorySearchScreen.tsx`
零命中——`projectId` 在这个 542 行屏里完全没被使用。唯一调用方
`SessionDetailScreen.tsx:366` 老老实实传了它。

不是 bug（`searchMessages(sessionId, ...)` 只需 sessionId），但属于
「契约比实现宽」的冗余：类型签名承诺了一个调用方必须提供、屏却不消费的字段，
未来若有人照着签名以为该屏有项目维度，会踩空。

**建议**：二选一——①`ChatHistorySearch` 参数收窄为 `{sessionId: string}`，
同步改 `SessionDetailScreen.tsx:366` 的调用；②保留但在
`types.ts:85` 的注释里写明「projectId 为将来多项目扩展预留，当前未用」。
倾向 ①（当前无扩展计划）。

**置信**：confirmed

---

### F-w9-mobilenav-9 | P3 | `navigation/header-config.ts:20` + `RootNavigator.tsx:225`

**`RealPrompt` 的 header 静态标题与 `stackOverride` 双写，且 `animation:'none'` 无注释。**

```ts
// header-config.ts:20
RealPrompt: {title: '查看提示词', showBack: true, showNav: false},
// RootNavigator.tsx:222-226
<Stack.Screen name="RealPrompt" component={RealPromptStackScreen} options={{animation: 'none'}} />
```

**描述**：`PAGE_HEADER_CONFIG` 是静态标题单源（`AppHeader.tsx:31` 以
`keyof typeof PAGE_HEADER_CONFIG` 强制全覆盖），27 条路由一条不漏
（已实测：`types.ts` 的 27 条栈路由全部命中 `header-config`，
`Stack.Screen` 注册的 28 个 name 全部在 `types.ts` 中，三方注册表无缺口——
这点是好的，登记完整）。但 `RealPrompt` 的 `animation: 'none'` 是全表
唯一一处屏幕级动画覆盖，没有注释说明为什么关掉（`CloudSyncProgress`
的 `gestureEnabled:false` 同样裸奔，不过那个至少有 `BackHandler` 拦截
的代码可循）。这类「无注释的非常规覆盖」后来者极易误加回去。

**建议**：给两处 `options` 各补一行注释说明意图（RealPrompt 为何无转场、
CloudSyncProgress 为何禁手势）。

**置信**：confirmed

---

### F-w9-mobilenav-10 | P3 | `utils/session-default-title.ts:4` + `utils/format-relative-time.ts:4`

**`utils/` 三个纯函数的 `nowMs` / 入参设计有「为测试而存在」的痕迹，
`formatRelativeTimeMs` 的 `nowMs` 参数全仓无调用方传。**

```ts
// format-relative-time.ts:4
export function formatRelativeTimeMs(ms: number, nowMs = Date.now()): string {
```

**描述**：`formatRelativeTimeMs` 两个调用点
（`ProjectDrawer.tsx:185`、`ChatSessionListPanel.tsx:277`）都只传一个参数，
`nowMs` 形参的唯一价值是让测试能冻结时钟。这是合理设计，不算问题——
但 `nextDefaultSessionTitle`（`session-default-title.ts:9`）的
`existingTitles: ReadonlyArray<string | null | undefined>` 里，
`null`/`undefined` 分支（`:14` 的 `if (raw == null || raw === '')`）在唯一
调用点 `chat-tab/useChatTabScope.ts:477` 传的是 `list.map(s => s.title)`——
`ChatSession.title` 是否真可为 null 需看 core 类型。若恒为 `string`，
则 `null`/`undefined` 两分支是不可达代码。

**建议**：核实 `ChatSession.title` 的类型。若非 nullable，把
`nextDefaultSessionTitle` 的入参收窄为 `ReadonlyArray<string>`，删 `:14`
的空值分支；若确为 nullable，保留并补注释说明为何容忍。

**置信**：suspected（`useChatTabScope.ts:477` 的实参形状已核对，
但 `ChatSession.title` 的可空性在 core 区、未在本区核实，故标 suspected）

---

### F-w9-mobilenav-11 | P3 | `update-check/resolve-latest-release.ts:17` + `check-for-updates.ts:14`

**`FetchFn` / `localVersion` 的注入形参在生产路径上恒为缺省值。**

```ts
// resolve-latest-release.ts:17,44
export type FetchFn = typeof fetch;
export async function resolveLatestRelease(fetchFn: FetchFn = fetch) { ... }
// check-for-updates.ts:13-15
export async function checkForUpdates(localVersion: string = APP_VERSION, fetchFn?: FetchFn) {
```

**描述**：`fetchFn` / `localVersion` 是标准的依赖注入测试缝，生产两个调用方
（`AboutScreen.tsx:82`、`services/update-check-flow.ts:50`）都走
`checkForUpdates()` 零参。属**有意的可测性设计**，按 PLAN §3 不当缺陷报，
在此仅作登记供 reduce 阶段免于重复争论。

真正可挑的是 `resolveLatestRelease` 的 catch 链（`:61-68`）：
`AbortError` → 超时文案，其余 `Error` → 原样 rethrow，**非 Error 的
throwable**（如字符串）→ 「网络不可用」。第三分支的文案把「服务端返回了
非 Error 异常」误报成「网络不可用」，语义不准。

**建议**：`catch` 末支改为
`throw new Error(\`检查更新失败：${String(err)}\`)`，或统一走
`toastMessage` 风格的具体原因。优先级低。

**置信**：confirmed（catch 分支逐行读过）；注入形参本身标 intentional

---

## 争议与存疑

1. **F-2 的定级争议。** 我给 P1，理由是「唯一一条内容依赖会话却无参的路由」
   是确证的契约缺口，且 `SessionDetail` 与 `ChatHistorySearch` 两个兄弟入口
   写法不一致（一个传参一个不传）本身就是缺陷信号。但**当前 UI 下没有
   已存在的入口能让 scope 与来源不一致**——`navigate('RealPrompt')` 全仓仅两处
   （`SessionDetailScreen.tsx:397`、`chat-tab/useChatTabController.ts:107`），
   都在「当前 scope 即目标 scope」的前提下成立。故不按 P0 记。
   若 reduce 阶段认为「无现网触发路径」应降级，P2 亦可接受——
   争议点是**契约违规**是否独立于**可触发性**记 P1。

2. **F-5 是否算问题。** `withStackLayout` 丢 props 目前无实际损失
   （27 屏全走 `useRoute`）。我仍报出来，是因为它是一条**已铺好的陷阱**：
   后来者按 React Navigation 惯例写 `options={{initialParams}}` 会静默失效，
   且没有任何类型或注释提示。这属于「预防性发现」，与「当前缺陷」应分开定级，
   我放 P2 并在描述里明确标注了「当前无功能损失」。

3. **F-6 的严重性。** 已确认 `VfsFileManager` 用 `vfsRef` 兜住了无限循环
   （`VfsFileManager.tsx:285,314`），所以**不是 bug**，是「memo 全废」的
   性能债。我保留了 P2 而非降 P3，因为 `VfsFileManager` 是个 1200+ 行、
   回调密集的组件，引用不稳定会让它的 `useCallback`/`useMemo` 链条整体重建——
   但这一条我**没有实测渲染次数**，纯静态推断。若 reduce 阶段要求实测，
   应降 P3。

4. **未覆盖的子区域。** `screens/tabs/chat-tab/**`（11 文件、约 4000 行）
   按机位划分排除，故 `ChatTabScreen.tsx` 内部我只审了它与 stack 的交互面
   （`onOpenSessionDetail` / `onOpenComposerFullscreen` 两个跨区回调），
   `useChatTabScope` 的 780 行主体、`ChatTabProvider` 的 550 行主体
   **未系统审**。若 W9 另有机位覆盖 chat-tab 则无缺口；否则这是本区的
   已知盲区，建议在 registry 里点名。

5. **`HeaderContext` 的 `chat` 死状态（F-3）**：我确认了 `setChat` 零外部
   写入。但不排除它在**本区之外**（`components/chrome/**` 或 `e2e/`）被调用
   ——我的 grep 脚本只扫 `apps/mobile/src`（排除 e2e），且 `e2e/` 目录本轮
   未纳入 zone。若 e2e 有 mock 依赖 `setChat`，删除前需一并清理。

## 附：本区健康项（不计发现，供 reduce 对照）

- **路由注册三表零缺口**（实测）：`types.ts` 27 条栈路由 ↔
  `RootNavigator` 的 `Stack.Screen` 28 个 name ↔ `header-config` 29 键，
  双向差集为空（`Chat`/`Profile` 是 tab、`chat`/`profile` 是 header pageKey，
  属命名空间差异非缺失）。这是本区最值得肯定的一点。
- **`withStackLayout` 的模块级稳定引用**（`RootNavigator.tsx:106` 注释）
  是有意为之且正确的——inline 调用会导致栈屏反复卸载/挂载，注释也写明了。
- **`useVfsBackNavigation` 的 `isFocused()` 守卫**
  （`hooks/useVfsBackNavigation.ts:45-47`）是真实踩过坑后的修复，
  注释写明了「详情屏卡住退不出」的症状，属高质量防御代码。
- **`useFocusListReload` 的 `fallbackValue` 稳定引用约定**
  （`hooks/useFocusListReload.ts:8` 明确要求「须传模块级稳定引用」）
  且 6 个调用方**全部遵守**（`EMPTY_ROWS` / `EMPTY_SKILLS` /
  `EMPTY_PAYLOAD` / `EMPTY_RULES` 均为模块级 `const`）——约定与实现一致。
- **`update-check/resolve-latest-release.ts:28-33` 的 htmlUrl 域名白名单校验**
  是有价值的防御（防 API 被劫持后把用户导向钓鱼页）。
