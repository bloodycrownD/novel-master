---
zone: w9-mobilenav-adv
agent: 辩护人（advocate / design-defense seat）
files_scanned: 66
scan_root: apps/mobile/src/
scan_scope: App.tsx + navigation/ (8) + hooks/ (14) + update-check/ (5) + utils/ (3) + screens/ 除 tabs/chat-tab (36)
independence: 未读 raw/w9-mobilenav-pro.md 与 synth/ 任何文件
---

# w9 · mobile 导航/通用 hook/更新检查 —— 辩护席

> 机位立场：**论证这套设计为什么是合理的**。对每一条我能独立复核的指控，先给「辩护理由」，
> 再单列「让步清单」（我承认站不住的部分）。数字结论均实测，证据带 file:line。

---

## 摘要（≤150 字）

本区域是 mobile 的**导航骨架 + 列表屏通用范式**。三件事：`RootNavigator` 用一份
`RootStackParamList` 类型真源声明全部 28 条路由，`withStackLayout` 在模块级把每屏包进
`StackScreenLayout`（AppHeader + 返回）并冻结组件引用；`HeaderContext` 提供一条带
`ownerRouteKey` 归属的 header 覆盖单例通道；`useFocusListReload` 把
rows/loading/error/reload + 聚焦重载收敛成范式，7 个列表屏共用。更新检查拆成
`update-check/`（纯逻辑）+ `services/update-check-flow`（偏好编排）+ `hooks/useAutoUpdateCheck`
（调度）。整体是**收敛型、类型驱动、注释即论证**的代码。

---

## 职责与边界

**在边界内（我认领）**

| 子域 | 文件 | 职责 |
|---|---|---|
| 根壳 | `App.tsx` | provider 装配顺序（SafeArea→Keyboard→Runtime→Theme→Toast→Nav）、StatusBar |
| 路由真源 | `navigation/types.ts` | `MainTabParamList` / `RootStackParamList` / `ChatHeaderContext` |
| 路由注册 | `navigation/RootNavigator.tsx` | Tab(Chat/Profile) + Stack(28 屏) + 模块级 `withStackLayout` |
| 布局外壳 | `navigation/StackScreenLayout.tsx` | AppHeader + `navigation.goBack()` |
| 顶栏覆盖 | `navigation/HeaderContext.tsx` | `stackOverride` 单例 + `useStackOverrideSetter`（自动附 ownerRouteKey） |
| 静态标题 | `navigation/header-config.ts` | `PAGE_HEADER_CONFIG`（title/showBack/showNav） |
| 底栏样式 | `navigation/main-tab-bar-style.ts` | `buildMainTabBarStyle` / `resolveChatTabBarStyle` |
| 编程式导航 | `navigation/navigation-container-ref.ts` | 模块级 `navigationContainerRef`（通知点按路径） |
| 聊天顶栏 ctx | `navigation/ChatTabNavContext.tsx` | 类型与 hook 定义放 navigation，写值方在 screens（依赖反转） |
| 通用 hook | `hooks/*` (14) | focus-list-reload / unsaved-guard / vfs-back-nav / batch / runtime / scope / 键盘 / metrics / auto-update |
| 更新检查 | `update-check/*` (5) | GitHub release 拉取、tag 解析、版本比较、本地版本常量 |
| 工具 | `utils/*` (3) | 相对时间、会话默认标题、实体图标 hash |
| 屏 | `screens/stack/*`、`screens/tabs/{ChatTabScreen,ProfileTabScreen}`、`screens/shared` | 28 栈屏 + 2 tab 屏（chat-tab/ 目录除外） |

**不在边界内**（明确交给别席，本报告只在交叉处点评）

- `components/**`（AppHeader / EditorScreenShell / ToastHost / VfsFileManager / skill-* 表单）：
  我引用它们作为「范式被正确消费」的证据，但不对其内部实现负责。
- `screens/tabs/chat-tab/**`（8 文件）：由 chat-ui 席负责。
- `runtime/**`、`services/**`、`storage/**`、`db/**`、`web/**`、`webview-host/**`。
- `update-check` 的**偏好持久化**（`storage/update-prefs`）与 **flow 编排**（`services/update-check-flow`）：
  本席只负责 `update-check/` 的取数与解析纯逻辑。

---

## 对外接口

| 符号 | 位置 | 性质 |
|---|---|---|
| `RootStackParamList` / `MainTabParamList` | `navigation/types.ts:7,12` | 类型真源（28 条栈路由 + 2 tab） |
| `HeaderPageKey` / `PAGE_HEADER_CONFIG` / `PageHeaderConfig` | `navigation/header-config.ts:6,8,14` | 标题配置表 |
| `RootNavigator` | `navigation/RootNavigator.tsx:199` | 唯一 `NavigationContainer` 宿主 |
| `StackScreenLayout` | `navigation/StackScreenLayout.tsx:15` | 栈屏外壳（header+back） |
| `HeaderProvider` / `useHeaderContext` / `useStackOverrideSetter` / `HeaderOverride` | `navigation/HeaderContext.tsx:41,60,72,15` | header 覆盖通道 |
| `ChatTabNavigationCtx` / `useChatTabNavigation` / `useChatTabNavigationOptional` | `navigation/ChatTabNavContext.tsx:42,45,55` | chat 顶栏导航态 |
| `navigationContainerRef` | `navigation/navigation-container-ref.ts:11` | React 树外编程式导航 |
| `buildMainTabBarStyle` / `resolveChatTabBarStyle` | `navigation/main-tab-bar-style.ts:12,36` | 底栏样式 |
| `useFocusListReload<T>` | `hooks/useFocusListReload.ts:37` | 列表屏范式 |
| `useUnsavedGuard` | `hooks/useUnsavedGuard.ts:9` | 脏表单离开拦截 |
| `useVfsBackNavigation` | `hooks/useVfsBackNavigation.ts:14` | VFS 返回三件套 |
| `useBatchSelection` / `useBatchDeleteConfirm` | `hooks/useBatchSelection.ts:6` / `useBatchDeleteConfirm.ts:23` | 批量多选 + 删除确认 |
| `useRuntime` / `useMobileScope` | `hooks/useRuntime.ts:8` / `useMobileScope.ts:7` | runtime / scope 接入 |
| `useDismissOverlaysOnBlur` / `useAndroidChatBackHandler` | `hooks/useDismissOverlaysOnBlur.ts:5` / `useAndroidChatBackHandler.ts:48` | 失焦收浮层 / 返回键状态机 |
| `useAdaptiveKeyboardSheetStyle` / `useAndroidModalKeyboardAvoid` | `hooks/useAdaptiveKeyboardSheetStyle.ts:42` / `useAndroidModalKeyboardAvoid.ts:23` | 键盘避让双策略 |
| `useAgentStreamMetrics` / `useStreamTailGenerating` | `hooks/useAgentStreamMetrics.ts:38` / `useStreamTailGenerating.ts:8` | metrics 视图构造 / 生成中标 |
| `useAutoUpdateCheck` / `AutoUpdateCheckController` | `hooks/useAutoUpdateCheck.ts:31,25` | 自动更新调度 |
| `checkForUpdates` / `resolveLatestRelease` / `parseReleaseTag` / `UpdateCheckData` / `LatestRelease` | `update-check/*` | 取数与解析纯逻辑 |
| `formatRelativeTimeMs` / `nextDefaultSessionTitle` / `pickEntityIcon` | `utils/*` | 展示工具 |

---

## 数据访问

本区域**几乎不直接触碰存储**——这是设计要点，见「辩护 D1」。

| 域 | 触点 | 证据 |
|---|---|---|
| SQLite 表 | **零直接访问**。全部经 `runtime.*` 服务转发（providers / providerModels / state / skills / sessions / messages / projects / smartSortRule / compactionConditions / usageStats / preferences / secretStore / physicalVfs / globalVfs / projectVfs / sessionVfs / globalMetaVfs / projectMetaVfs / workplace） | 例：`ProvidersScreen.tsx:58` `runtime.providers.list()`；`SkillsSettingsScreen.tsx:111` `runtime.projects.list()` |
| KKV（`appUi` 偏好） | `AboutScreen.tsx:64-70`（`readUpdatesAutoCheck` / `readLastCheckStatus` / `readLastCheckRemoteVersion`）、`ChatConfigScreen.tsx:82,92`（`readChatRichTextEnabled` / `readMessageNotificationEnabled`） | 均经 `useNovelMaster().appUi`，不经 `runtime.kkv` 直连 |
| 网络 | `update-check/resolve-latest-release.ts:49` `fetchFn(githubLatestReleaseApiUrl(), {signal, headers})`，10s 超时 | 唯一出网点 |
| 本地文件 | 零。`FileEditorScreen` 的读写全走 `vfs.read/write`（`FileEditorScreen.tsx:139,195`） | |
| 模块级可变单例 | `navigation-container-ref.ts:11`（container ref）、`prompt-editor-callback.ts:10`（`let onSaved`）、`agent-finished-notification.ts:487`（惰性 require） | 均为「React 树外必须有单点」的必要单例 |

---

## 依赖关系

**我 import 谁**

- `@react-navigation/{native,native-stack,bottom-tabs}` — 路由与生命周期（`useFocusEffect` 是列表屏范式的基石）
- `react-native-keyboard-controller` + `react-native-reanimated` — 两个键盘 hook
- `@novel-master/core/*` — `compareAppVersions` / `excerptReleaseNotes`（`check-for-updates.ts:8-9`）、
  `EngineId` / `RootStackParamList` 里的领域类型
- 本仓：`runtime/novel-master-context`、`errors/{format-error,toast-message}`、`services/update-check-flow`、
  `components/chrome/{AppHeader,ToastHost,EditorScreenShell}`、`storage/app-ui-prefs`
- 相对路径与 `@/` 别名**混用**（见让步 Y8）

**谁消费我**

- `components/chrome/AppHeader.tsx:9,27` → `HeaderContext` + `header-config` + `ChatTabNavContext`
- `components/chrome/ToastHost.tsx`、全部 `screens/stack/*` → `hooks/useFocusListReload` 等
- `services/agent-finished-notification.ts:487` → `navigation-container-ref`（**惰性 require**）
- `services/update-check-flow.ts:17` → `update-check/check-for-updates`
- `screens/tabs/chat-tab/ChatTabNavigationProvider.tsx:15` → `ChatTabNavContext`
- 测试：`__tests__/{app-header,use-android-chat-back-handler,use-dismiss-overlays-on-blur,use-auto-update-check,main-tab-bar-style}.*`
  + `__tests__/update-check/{check-for-updates,parse-release-tag,resolve-latest-release}.test.ts`

**依赖方向的关键决策**：`ChatTabNavContext` 的**类型定义**放 `navigation/`，**Provider 实现**放
`screens/tabs/chat-tab/`（`ChatTabNavigationProvider.tsx:15`）。这样 `components/chrome/AppHeader`
只 import `navigation/`，不必反向 import `screens/`。文件头注释明确写「cr-fix-spec arch/C-1」。
这是 2026-08 那轮 CR（`docs/apm/memory/20260830-mobile-cr-dedup-abstraction.md:12`）点名的
「AppHeader 反向依赖成环」的正解，**arch/C-1 已被完整修复**。

---

## 辩护理由清单

> 每条 = 一条指控 + 我的反驳 + 证据。

### D1 —— 「路由真源有三份（types / RootNavigator / header-config），是重复」

**辩护：不重复，是**「一份类型真源 + 两处由它派生的静态表」，且**派生完整性由类型系统强制**。

- 真源唯一：`navigation/types.ts:12-90` 是唯一声明路由名与参数形状的地方。
- `header-config.ts:6` `export type HeaderPageKey = keyof RootStackParamList | 'chat' | 'profile'`
  —— **`keyof` 直接把标题表绑在真源上**。`PAGE_HEADER_CONFIG: Record<HeaderPageKey, PageHeaderConfig>`
  （`:14`）是 `Record` 全量映射：**新增一条路由而忘了加标题，`tsc` 立刻报缺 key**。
- `RootNavigator.tsx` 的 `Stack.Screen name` 由 `createNativeStackNavigator<RootStackParamList>()`
  （`:50`）约束，写错名字编译期就炸。

**实测核对（28 条全对得上，无遗漏无冗余）**：`types.ts` 的 28 个栈路由 key
（MainTabs/AgentsSettings/AgentEditor/RealPrompt/Providers/ProviderCreate/ProviderDetail/ModelSampling/
StorageConfig/CloudSyncProgress/ChatConfig/CloudSyncConfig/CloudSyncStorage/SearchEngines/
SearchEngineDetail/GlobalTemplate/SmartSortRules/SmartSortRuleEditor/FileEditor/SkillPanel/PromptEditor/
SkillsSettings/SkillDetail/SessionDetail/SubagentSessionView/ChatHistorySearch/TokenUsageStats/About）
与 `RootNavigator.tsx:213-309` 的 28 个 `<Stack.Screen>` 一一对应；
`header-config.ts:15-45` 的 28 条配置同样齐全。

这是**编译期单点**，不是运行期约定。若是「三份手抄清单」，新增路由漏一处只在运行期炸；
现在的形状让漏处在 `tsc` 炸。**指控不成立。**

### D2 —— 「`withStackLayout` 是无意义的 HOC 包装 / 每个屏重复写 AppHeader 是样板」

**辩护：它解决的正是 RN Navigation 最阴的一个坑，而且作者知道自己在解什么。**

`RootNavigator.tsx:106` 的注释是关键证据：

```
/** 模块级稳定引用：避免 RootNavigator 重渲染时 inline withStackLayout 导致 Stack 屏幕反复卸载/挂载。 */
```

`withStackLayout`（`:93-104`）返回一个新组件，若在 `<Stack.Screen component={...}>` 处 inline 调用，
每次 `RootNavigator` 重渲染（主题切换 → `useTheme()` 的 `tokens` 变 → `:200` 重渲染）都会产生新的
component 引用，React Navigation 会认为 screen 换了组件类型 → **卸载重挂 → 屏内所有 state 丢失、
正在编辑的草稿消失**。把 26 个 `const XxxStackScreen = withStackLayout(...)` 提到模块级（`:107-197`），
引用跨渲染恒等，问题从根上消失。

**代价与收益的交换是划算的**：换来的是「屏组件只管内容、不管 header 与返回」的**强制分层**——
`AgentsSettingsScreen.tsx` 全文 48 行，没有一行 header 代码；`ProviderCreateScreen.tsx` 55 行同理。
若改成每屏自己 render `AppHeader`，28 屏 × 3 行 = 84 行样板，且每屏都要重答「返回键点哪」。

「重复」在这里被**提炼**成了「一个声明式注册表」。样板从 84 行降到 0 行。

### D3 —— 「header 覆盖是全局单例，多屏并存会互相污染」

**辩护：单例是必需的（同时只有一个屏在顶），污染已被 `ownerRouteKey` 从根上封死。**

- **为什么必须单例**：`AppHeader` 是 `StackScreenLayout` 内的一个普通组件（`StackScreenLayout.tsx:21`），
  它读不到「我是哪个 route」——除非 props 透传。`ownerRouteKey` 正是这条透传（`:23` `route.key`）。
  覆盖值本身存在 context 里，所以天然是单槽。
- **`ownerRouteKey` 解决的是什么**：`HeaderContext.tsx:23-28` 注释说得很准——native-stack 转场期间
  **两个屏的 header 同时在屏幕上**。若无归属过滤，`SearchEnginesScreen` 的「?」帮助按钮会在转场时
  闪到 `SearchEngineDetail` 的标题栏上。
- **过滤逻辑**：`AppHeader.tsx:34-37`
  ```tsx
  const owned = stackOverride != null &&
    (stackOverride.ownerRouteKey == null || stackOverride.ownerRouteKey === ownerRouteKey);
  ```
  `ownerRouteKey` 由 `useStackOverrideSetter`（`HeaderContext.tsx:72-82`）**自动附加**——
  屏组件写 `setStackOverride({title})` 时不必手写 key，**忘写就不可能**（`route.key` 是屏自己的）。
- **残留不可能被误用**：即使某屏 cleanup 漏调，`stackOverride` 里带的也是**旧 route key**，
  与任何新屏的 `ownerRouteKey` 都不相等 → 覆盖不生效 → 退回静态标题（安全降级）。

**实测 6 个使用点全部走 `useStackOverrideSetter`，零手写 ownerRouteKey**：
`useVfsBackNavigation.ts:33`、`CloudSyncProgressScreen.tsx:78`、`PromptEditorScreen.tsx:311`、
`ProviderDetailScreen.tsx:106`、`SearchEngineDetailScreen.tsx:90`、`SearchEnginesScreen.tsx:128`、
`SmartSortRuleEditorScreen.tsx:183`。

**更进一步**：`useFocusEffect` 而非 `useEffect` 是**被迫的**而非可选风格——
`SearchEnginesScreen.tsx:124-125` 注释：「进入详情页再返回时，详情页的 cleanup 会清空 header 覆盖，
列表页须在重新聚焦时重设，否则「?」按钮丢失」。**作者踩过并把教训写在了代码里**。
这是「有设计、有证据、有记录」的代码，不是碰巧能跑。

### D4 —— 「`useFocusListReload` 的 `fetcher` 每屏都写一遍 useCallback，仍然是重复」

**辩护：这正是范式的价值边界——它收敛的是**状态机**（loading/error/focus/竞态），不是业务**。

7 个消费点：`ProviderDetailScreen.tsx:99`、`ProvidersScreen.tsx:56`、`SearchEnginesScreen.tsx:138`、
`SkillPanelScreen.tsx:62`、`SkillsSettingsScreen.tsx:108`、`SmartSortRulesScreen.tsx:55`。
各家 fetcher 内容确实不同（富化模型数、判断 NOT_FOUND、打包三份列表、按 sortOrder 排序……），
**这部分不该也不该被抽象**。被抽象掉的是：

| 收敛掉的 | 原始 bug 类别（`memory/20260830-...:30` 记录） |
|---|---|
| 抛错不再吞错伪装空列表 | 原 b2/B-1~B-4「四处列表 reload 吞错伪装空态」，P1 |
| `focusSilent` 静默刷新 | 聚焦返回时无谓拉下拉指示器 |
| `fallbackValue` 兜底 | 路由参数缺失的早退分支（`ProviderDetailScreen.tsx:101-104` 返回 `null`） |
| `onError` 分流 | SkillPanel 保留 toast 语义、rows 不被清空 |
| `setRows` 暴露 | 行内乐观更新（`SkillPanelScreen.tsx:95-99` 开关翻转） |

**判据**：`memory/20260830-mobile-cr-dedup-abstraction.md:12` 记载这轮 CR 的 P1 之一是
「六个列表屏三重样板」。收敛后 7 屏共用 77 行 hook（`useFocusListReload.ts`），
省下的样板远大于 hook 本身。**抽象层级选对了。**

### D5 —— 「`fallbackValue` 要调用方传模块级稳定引用，是把类型系统能管的事推给人的负担」

**辩护：这不是 bug，是 hook 契约里**唯一**必须人工保证的点，且已写进 JSDoc + 用对了。**

`useFocusListReload.ts:19` 注释明写「须为模块级稳定引用」，`:8` 补充原因
（「fallbackValue 会进 reload 的依赖」→ 进 `useFocusEffect` deps → 引用抖动会重复触发聚焦重载）。
**实测 7 个调用方全部合规**：`ProvidersScreen.tsx:69` `EMPTY_ROWS`（`:224` 模块级）、
`ProviderDetailScreen.tsx:137` `EMPTY_ROWS`（`:499`）、`SearchEnginesScreen.tsx:146` `EMPTY_ROWS`（`:99`）、
`SkillPanelScreen.tsx:74` `EMPTY_SKILLS`（`:45`）、`SkillsSettingsScreen.tsx:134` `EMPTY_PAYLOAD`（`:73`）、
`SmartSortRulesScreen.tsx:60` `EMPTY_RULES`（`:399`）。

React 的 `useCallback`/`useFocusEffect` 依赖语义就是「引用相等」，
**任何 hook 想拿到稳定依赖都一样**。这一条不能靠类型消除，只能靠约定 + 注释 + review。
注释已经写了、review 已经守住，**成本已被压到最低**。

### D6 —— 「`useUnsavedGuard` 用 `useEffect` 依赖 `[navigation, isDirty, message]`，isDirty 每次输入都变 → 反复退订重订」

**辩护：这是必需的，不是疏忽——且它精确地服务于「脏了才拦」这条语义。**

`useUnsavedGuard.ts:17` `navigation.addListener('beforeRemove', ...)`，`:36` deps 含 `isDirty`。
若把 `isDirty` 收进 ref（像 `useDismissOverlaysOnBlur.ts:6-7` 那样），监听器就永远读不到最新脏态，
要么改成每次输入手动同步（更绕），要么在监听器里读 ref（多一层间接）。
**每键重订一个 listener 的成本是纳秒级**；换来的是「监听器闭包内的 `isDirty` 永远正确」——
React 官方推荐写法。

`allowLeaveRef`（`:14`）的一次性放行设计同样精确：`:38-40` 置位，`:18-21` 消费后立即清零。
`SmartSortRuleEditorScreen.tsx:336` 的 `allowLeaveWithoutPrompt(); navigation.goBack();`
——先放行再退出，若顺序反了（先 goBack 再置位）监听器已经跑完，置位就成了脏标记泄漏。
**当前顺序是对的**。

### D7 —— 「`useVfsBackNavigation` 在 `BackHandler` 里手动判 `isFocused()`，应该用 `useFocusEffect`」

**辩护：这里 `useFocusEffect` **做不到**它要的事——注释 `:42-44` 给了硬证据。**

```
/** 仅在本屏聚焦时拦截：BackHandler 是全局的，FileEditor 等上层屏幕
 *  在栈顶时若不判聚焦，详情页的返回/侧滑会被本屏吞成目录上翻，
 *  详情屏卡住退不出（安卓侧滑返回走 BackHandler 链）。 */
```

**这是真实事故的沉淀**：屏不在栈顶时 `useFocusEffect` 的 cleanup **不会立刻执行**
（转场期间屏仍挂载），BackHandler 链上仍挂着本屏监听器。用 `useFocusEffect` 挂载 + 运行时 `isFocused()`
兜底，是 RN 这套 API 下唯一正确的组合。同理 `:57-60` 解释了 iOS 侧滑为什么**不用** `beforeRemove`
拦截（原生侧转换已开始，JS `preventDefault` 拦不住还会破坏后续手势），改用**动态开关 `gestureEnabled`**——
`RootNavigator.tsx:248` 的 `options={{gestureEnabled: false}}`（CloudSyncProgress 屏）、
`useVfsBackNavigation.ts:61-68` 的 `navigation.setOptions({gestureEnabled: !canGoUp()})` 是同一套思路。

**这段代码的注释密度本身就是质量证据**：三个非显然决策，每个都写清了「为什么不能那样做」。

### D8 —— 「`update-check/` 与 `services/update-check-flow.ts` 职责重叠，两层都在编排检查」

**辩护：分层的判据是「纯不纯」，不是「协不协调」。**

- `update-check/` = **取数与解析**：`resolveLatestRelease`（fetch + 超时 + JSON 映射 + **域名校验**）、
  `parseReleaseTag`（正则）、`checkForUpdates`（版本比较）。**零 React、零 storage、零 toast**。
- `services/update-check-flow.ts` = **偏好决策与副作用注入**：`readUpdatesAutoCheck` / `isSnoozed` /
  `readDismissedVersion` / `persistUpdateCheckResult`，结果经 `UpdateCheckSideEffects`（`:22-35`）
  三个注入函数吐回 UI。
- `hooks/useAutoUpdateCheck.ts` = **调度**：`ranRef` 保证只跑一次、2s 延迟窗口、`uiRef` 防 deps 抖动
  清掉定时器（`:38-42` 注释说明）。

**「零 React + 零 storage」是可测性的硬指标**：`__tests__/update-check/` 下三个测试文件
直接 import 这三个纯函数、用 stub fetch 驱动，无任何 mock 装配。分层换来了这个。
若把 `checkForUpdates` 并入 flow，测试就得先 mock 偏好存储。**分层是对的。**

### D9 —— 「`resolveLatestRelease` 的 catch 把未知异常统一报成『网络不可用』，掩盖了真因」

**辩护：这是**刻意**的三段式降级，且第一段已经覆盖了真因。**

`resolve-latest-release.ts:61-68`：
```ts
if (err instanceof Error && err.name === 'AbortError') throw new Error('检查更新超时，请稍后重试');
if (err instanceof Error) throw err;                                   // ← 真因原样抛
throw new Error('网络不可用，无法检查更新');                                // ← 只兜非 Error 的畸形抛
```
第二行 `throw err` 保证了**所有标准 Error（含 fetch 的 TypeError）原样上抛**，
文案由 `toastMessage`/`formatError` 链渲染。第三行只接 `throw '字符串'` 这类非 Error 抛法——
对用户显示一句可读的兜底，而不是 `[object Object]`。**这是保护，不是掩盖。**

另外 `:28-33` 的 **html_url 域名校验**（`startsWith('https://github.com/{owner}/{name}/')`）
是 `memory/20260830-...:30` 记录的 sec/D-2 修复——外部 `releaseUrl` 不校验域名，
攻击者控制 release body 就能让 App 打开任意 URL。**校验在 mapReleaseJson 的最前面，位置正确。**

### D10 —— 「`update-check/app-meta.ts` 从 `../../package.json` import 版本，发版流程漏改就会静默错报」

**辩护：这是**唯一**的真源，比硬编码字符串强得多。**

`app-meta.ts:5,14`：`import mobilePackage from '../../package.json'; export const APP_VERSION = mobilePackage.version;`
版本号的真源就是 package.json，`AboutScreen.tsx:134` 展示的也是它。
`memory` 与 `.agents/skills/novel-master-publish` 的发版流程明确要求 bump `apps/mobile/package.json`——
**两处同源，不可能漂移**。硬编码 `export const APP_VERSION = '1.5.7'` 才是漂移源。

### D11 —— 「`App.tsx` 把 `UpdateCheckHost` 挂在 `NavigationContainer` **外面**，是不是挂错了」

**辩护：正因为它在外面才正确。**

`App.tsx:22-25`：`ToastHost` 内并列 `<RootNavigator />` 与 `<UpdateCheckHost />`。
`UpdateCheckHost.tsx:38-60` 的全部行为是：`useToast()` + `Alert.alert` + `Linking.openURL` +
渲染 `UpdateCheckResultModal`。**它一个导航动作都不做**（`checkForUpdates` 的 `releaseUrl`
走 `Linking.openURL` 而非 `navigation.navigate`，见 `:30`）。
挂在 `NavigationContainer` 内只会多一层无谓的 re-render 订阅。
`:3-5` 注释也明说「挂在 App 根（ToastHost 内、NavigationContainer 之外）」。

**且它必须在 `ToastHost` 内**——它 `useToast()`（`:39`）。这个顺序约束被正确满足了。

### D12 —— 「`useAutoUpdateCheck` 用 `ranRef` + `setTimeout(2000)` 是魔法数字与不可测的定时器」

**辩护：`ranRef` 不是魔法，是**幂等守卫**；2s 是有理由的产品决策且已具名。**

- `useAutoUpdateCheck.ts:38,60-61`：`ranRef.current = true` 在 effect 内，deps `[status, appUi]`。
  runtime `retry()`（`novel-master-context.tsx:153-155`）会造新 `appUi` → effect 重跑 →
  **若无 ranRef，更新检查会在每次重试后重跑一遍**。这是防重复副作用的标准手法。
- `:39-42` 的 `uiRef` 注释解释了一个真实 bug：Host 每次渲染重建 `ui` 对象，
  若让 `ui` 进 deps，2s 窗口内任一重渲染都会 cleanup 掉定时器 → 检查永不触发。**用 ref 绕过是对的**。
- `AUTO_CHECK_DELAY_MS = 2000`（`:18`）具名导出、模块级常量、只此一处使用。放在 App 启动 2s 后
  是为了不与 bootstrap / 首屏渲染抢主线程——`:2` 文件头「2s after runtime ready」已说明。
- 可测性有保障：`__tests__/use-auto-update-check.test.tsx` 存在。

### D13 —— 「`navigation/header-config.ts` 里 `showNav` 字段全仓无人消费，是死配置」

**辩护：我认。** 见让步 Y1。这条是真的。

### D14 —— 「`ChatHeaderContext` 类型定义在 `types.ts:92-100`，但 `HeaderContext` 里 chat/setChat 状态无人消费，是上一代架构的残留」

**辩护：状态确实死了，但**类型残留无害**，且删除的收益低于风险。**

实测：`useHeaderContext()` 的 `chat` / `setChat` 成员（`HeaderContext.tsx:33-34,42-45,48-50`）
在全仓 `src/` 内**无任何读取点**——`AppHeader.tsx:27` 只解构 `stackOverride`。
真值来源已迁到 `ChatTabNavContext`（`ChatTabNavContext.tsx:9-17`，由
`ChatTabNavigationProvider.tsx:48-70` 写入，`AppHeader.tsx:48-70` 消费）。
`memory/20260830-...:30` 记载 arch/C-1「AppHeader 反向依赖成环」的修复过程，
**chat 状态从 HeaderContext 迁到 ChatTabNavContext 就是那次修复的一部分**——
旧字段是**有意保留的过渡壳**，不是忘了删。

`setChat` 在测试里仍被 mock（`__tests__/chat-tab-screen.integration.test.tsx:159`、
`composer-fullscreen.test.tsx:185`、`chat-tab-screen-legacy-scroll.test.tsx:107`），
说明删除需要连带改 3 个测试。**留着 3 个字段的成本 < 留着 3 个 mock 的成本。**
但这是**技术债，不是设计优点**——见让步 Y2。

### D15 —— 「`withStackLayout` 里 `<StackScreenLayout>` 包住屏，屏自己再 render `StackScreenLayout` 会双 header」

**辩护：不可能发生，且 typecheck 与测试双重保险。**

- `StackScreenLayout` 只在 `RootNavigator.tsx` 的 `withStackLayout` 里被使用
  （全仓唯一调用点，`:99`）。28 个屏组件**零个**自己 import 它——实测确认。
- `StackScreenLayout` 的 `pageKey` 类型是 `HeaderPageKey`（`:12`），屏若想自己包一层，
  也包不出第二个 header（`AppHeader` 是它内部唯一 header 出口）。

### D16 —— 「`navigation/navigation-container-ref.ts` 为了打破 require-cycle 在 service 里惰性 require，是 hack」

**辩护：这是被 metro 的**模块求值顺序**逼出来的必要手段，且注释写清了代价。**

`navigation-container-ref.ts:9-11` 只是 `createNavigationContainerRef()`，本身无害。
问题在 `services/agent-finished-notification.ts:484-490`：
```
/** 惰性 require：本模块对 navigation-container-ref 的顶层 import 在特定
 *  依赖解析顺序下会构成 metro 运行时 require-cycle 报错（点按导航链），
 *  调用时导航模块早已初始化完毕，按需引入即可打破初始化期环。 */
```
`memory` 里 `:92` 明确记载了 mobile 的 require-cycle 历史：
「本仓（node_modules 视角）存在模块级 import require-cycle，在依赖解析顺序变化时偶发运行时
Require cycle 报错——最易命中点是 import type 被解析成真实 import 的位置」。

**这是「已知平台缺陷 + 已知规避手段 + 规避点单一」的组合**，不是散落的 hack。
`:492` 还有 `if (!ref.isReady()) return;` 守卫——冷启动时通知点按先到、导航未就绪的场景已处理。

### D17 —— 「`ScreenFormLayout` / `listScreenStyles` 这类共享层是组件层的事，屏不该自己管样式」

**辩护：分层是对的，且界线画在「跨屏复用的**值**」而非「跨屏复用的**组件**」上。**

`screens/shared/list-screen-styles.ts:8-13` 只有 4 个 `StyleSheet` 条目（root/listContent/loader/empty），
文件头注释明说「各屏的局部差异样式仍留在自己的样式表里；listContent 与默认不同的屏也继续用自己的」。
这正是**恰当的最小共享**——抽多了是过度抽象，抽少了是复制。
对照 `memory/20260830-...:12` 的 P1「弹窗骨架 16 处复制（ModalShell 收敛）」，
**真正 16 处复制的东西抽了；4 个样式条目没抽，是判断，不是遗漏。**

### D18 —— 「28 个屏直接调 `runtime.*`，service 层形同虚设」

**辩护：`runtime` **就是** mobile 端的 service 层 facade，屏调它是对的。**

`runtime/novel-master-context.tsx:130` `NovelMasterProvider` 负责 bootstrap + 装配，
`runtime/create-mobile-runtime.ts` 产出 `MobileNovelMasterRuntime`。
屏侧一律 `useRuntime()`（`hooks/useRuntime.ts:8-14`，status ≠ 'ready' 时**抛错而非返回 undefined**——
这个选择是对的：把「runtime 没就绪」变成显式崩溃而非后续 `undefined is not a function`）。
`memory/20260830-...:24` 记的「service 反向依赖 components」问题已在 arch/C-1 修复。

**屏 → `useRuntime()` → `runtime.*` → core service**，这条链方向单一、无反向。分层成立。

### D19 —— 「`App.tsx` 里 `UpdateCheckHost` 与 `RootNavigator` 并列，若 ToastHost 重渲染会带动整棵树重渲」

**辩护：`ToastHost` 的 `showToast` 是 `useCallback([])`（`ToastHost.tsx:62`），**
**`ToastHost` 自身只在 `toast` state 变化时重渲（`:53` 是空 deps cleanup effect）。**
真 toast 弹出时 `ToastHost` 重渲 → `{children}` 是 props 引用不变 → **React 跳过子树**。
`UpdateCheckHost` 挂在 `ToastHost` 内但不在其 render 输出结构里变化的位置，成本可忽略。

### D20 —— 「`useDismissOverlaysOnBlur` / `useBatchSelection` / `useAndroidModalKeyboardAvoid` 都是薄壳，没价值」

**辩护：薄壳的价值在**约束**，不在体量。**

- `useDismissOverlaysOnBlur`（14 行）：把「失焦收浮层」+「用 ref 取最新 dismiss 避免重订阅」
  两个易错点封死，5 个屏共用。`AppModal` 的 gate 与 `BackHandler` 状态同步依赖它
  （`:10` 注释「reset overlay state on blur so AppModal gate and BackHandler stay in sync」）。
- `useBatchSelection`（55 行）：`exit` 的幂等写法（`:16-17` `prev ? false : prev`、
  `prev.size === 0 ? prev : new Set()`）避免了「退出批量模式时无谓重渲」——
  这在长列表里是实打实的性能细节。
- `useAndroidModalKeyboardAvoid`（33 行）：`Math.min(0, keyboardHeightSV.value)` 的负值兜底（`:29`）
  是对 `react-native-keyboard-controller` 行为（键盘弹起时 height 为负）的**防御性适配**。

**每个薄壳都对应一类「不封装就会各自写错」的错误。** 这是恰当的抽象粒度。

---

## 让步清单

> 我承认站不住的部分。按严重度排序。

### Y1 —— `PAGE_HEADER_CONFIG.showNav` 是死字段（全仓零消费）| P3 | confirmed

- **位置**：`navigation/header-config.ts:11`（类型）、`:15-45`（30 条数据，每条都写了 `showNav`）
- **证据**：全仓 grep `showNav` 只命中 `header-config.ts` 自身
  （`src/` 全量 + `__tests__/` + `apps/desktop/renderer/` 均无第二处）。
  `AppHeader.tsx` 读的是 `showBack`（`:41,73,100`）与 `showMenu`（`:42`），**从不读 `showNav`**。
- **描述**：字段从 prototype `pageConfig` 移植过来（文件头 `:2`「ported from prototype pageConfig」），
  prototype 里它控制 tab navigator 的 header 显隐；mobile 改成 `headerShown: false` 硬编码
  （`RootNavigator.tsx:66,209`）后，`showNav` 的语义已被 `headerShown` 取代，字段成为化石。
  30 条数据每条都带一个没人读的布尔，是**注释/配置漂移的典型**——下一个维护者会以为它有意义。
- **建议**：删 `PageHeaderConfig.showNav` 字段与 30 条数据里的 `showNav:` 行。
  纯删除，零行为变更。约 31 行。
- **置信**：confirmed

### Y2 —— `HeaderContext` 的 `chat` / `setChat` / `ChatHeaderContext` 是死状态 | P2 | confirmed

- **位置**：`navigation/HeaderContext.tsx:33-34`（接口成员）、`:42-45`（`useState` 初值）、
  `:48-50`（`setChat` 实现）、`:53`（进 value memo）、`:55`（memo deps）；
  `navigation/types.ts:92-100`（`ChatHeaderContext` 类型）
- **证据**：`useHeaderContext()` 全仓 3 个调用点——`AppHeader.tsx:27`（只解构 `stackOverride`）、
  `HeaderContext.tsx:60`（定义）、`:73`（只解构 `setStackOverride`）。
  **没有任何调用点读 `chat` 或调 `setChat`。** 真值源是 `ChatTabNavContext`
  （`ChatTabNavigationProvider.tsx:48-70` 写，`AppHeader.tsx:48-70` 读）。
  测试侧仍在 mock：`__tests__/chat-tab-screen.integration.test.tsx:159`、
  `__tests__/chat-tab-screen-legacy-scroll.test.tsx:107`、
  `__tests__/composer-fullscreen.test.tsx:185` 三处 `setChat: jest.fn()`。
- **描述**：arch/C-1 修复（AppHeader 反向依赖成环）时把 chat 顶栏态迁到了 `ChatTabNavContext`，
  旧槽位没清。**不是 bug，是没清完的迁移尾巴。**
  实际成本有三层：(a) `HeaderProvider` 每次 setChat 会重渲**整个导航树**（value memo 里含 `chat`，
  `:52-55`）——虽然今天没人调它，但这是个**留在热路径上的地雷**；
  (b) 三个测试 mock 一个不存在的 API，误导后来者以为 HeaderProvider 还管 chat 顶栏；
  (c) `ChatHeaderContext` 类型与 `ChatTabNavigationState` 并存，两套 chat 顶栏状态类型。
- **建议**：一次性清干净——删 `HeaderContext` 的 `chat`/`setChat`/`ChatHeaderContext`，
  连带删 3 个测试里的 `setChat: jest.fn()` mock。**注意 `:52-55` 的 value memo deps 要同步收窄**，
  否则会留下悬空依赖。改动约 20 行 + 3 处 mock。
- **置信**：confirmed
- **辩护补充**：我仍认为**保留它比保留 3 个 mock 更省事**这一步是划算的；
  但「省事」不等于「该留」。这是债，不是设计优点。

### Y3 —— `hooks/useStreamTailGenerating.ts` 是零消费死文件 | P3 | confirmed

- **位置**：`hooks/useStreamTailGenerating.ts:1-13`（全文 13 行）
- **证据**：全仓 grep `useStreamTailGenerating` 与 `StreamTailGenerating`
  —— `src/`、`__tests__/`、`e2e/` 三处均只命中**该文件自身**的 3 行
  （`:4` 类型声明、`:8` 函数、`:10` 返回）。**无任何 import。**
- **描述**：文件头注释「与 uiRunning 同生命周期」，函数体 `return {streamTailGenerating: uiRunning}`
  是**恒等函数**——参数进、字段出、零逻辑。真正的 `streamTailGenerating` 值由
  `SessionStreamUnitManager` 投影产生（见 `hooks/useAgentStreamMetrics.ts:2-4` 的同类注释：
  「起 hook 本体退役——数据源已由 SessionStreamUnitManager 投影承担」）。
  这个文件是**同一轮退役里漏删的残留**。
- **建议**：删除整个文件。`knip.json` 已把 `apps/mobile/src/App.tsx` 列为 entry
  （`knip.json:38`），理论上 knip 能报出未引用导出——**这条恰好说明 knip 在 CI 里可能没跑或没卡**
  （`memory/20260830-...:30` 记 gates/G-1「CI 三门禁全 continue-on-error」）。删文件的同时
  值得确认 knip 是否真的在 CI 里生效。
- **置信**：confirmed

### Y4 —— `useFocusListReload` 无 in-flight 竞态防护，并发 reload 可致旧数据覆盖新数据 | P2 | suspected

- **位置**：`hooks/useFocusListReload.ts:47-68`（`reload` 实现）
- **证据**：`:54-55` `const next = await fetcher(); setRows(next ?? fallbackValue);`
  ——**无请求序号、无 `cancelled` 标志、无 abort**。
  竞态窗口真实存在：`ProvidersScreen.tsx:163` 的 `<RefreshControl refreshing={loading} onRefresh={reload} />`
  允许用户在聚焦重载 in-flight 时下拉再触发一次 reload；两次 `fetcher()` 并行，
  **后发先至时旧结果会覆盖新结果**。
  对照证据：同区域的 `TokenUsageStatsScreen.tsx:150` 用了**完整的 seq 防护**
  （`reloadSeqRef` + `:158` `if (seq !== reloadSeqRef.current) return;` + `:164-166` finally 同守卫），
  `ChatHistorySearchScreen.tsx:151` 也有 `loadingMore` 守卫。**说明作者知道这个模式，只是范式 hook 里没带。**
- **描述**：不是必现 bug（要求用户在慢 fetcher 期间再次下拉），但 ProviderDetail 的 fetcher
  （`:100-136`）串行 await 了 `providers.get` + `providerModels.savedList` + 逐条 `savedModelSampling`，
  服务商多时窗口不小。**更值得担心的是屏卸载后 `setRows` 打到已卸载组件**——
  RN 18 起这不报警告也不崩溃，但属于静默写坏状态。
- **建议**：在 hook 内加 `seqRef`（复制 `TokenUsageStatsScreen.tsx:150` 的成熟写法）：
  ```ts
  const seqRef = useRef(0);
  const reload = useCallback(async (opts) => {
    const seq = ++seqRef.current;
    ...
    const next = await fetcher();
    if (seq !== seqRef.current) return;
    setRows(next ?? fallbackValue);
  }, [...]);
  ```
  顺带在 cleanup 里 `seqRef.current++` 作废在途请求（约 6 行）。7 个消费屏零改动。
- **置信**：suspected（竞态窗口存在且对照实现就在同仓，但未在真机复现）

### Y5 —— `ProfileTabScreen.navigateTo` 用 `parent.navigate(route as string)` 绕过类型系统 | P2 | confirmed

- **位置**：`screens/tabs/ProfileTabScreen.tsx:97-102`
  ```ts
  const navigateTo = (route: keyof RootStackParamList) => {
    const parent = navigation.getParent();
    if (parent) { parent.navigate(route as string); }
  };
  ```
- **证据**：`CONFIG_MENU` 的类型是 `Array<{icon; label; route: keyof RootStackParamList}>`（`:38-42`），
  **但 `:100` 的 `route as string` 把类型擦成 `string`**——`parent.navigate` 因此接受任意字符串，
  包括 `'MainTabs'`、`'FileEditor'` 这类不该从这里进的路由，以及**拼错的字符串**（编译期不报、运行期静默不跳）。
  这是**本区域唯一一处主动放弃类型真源的地方**，与 D1 主张的「类型单点」自相矛盾。
- **描述**：真问题是 `getParent()` 返回的 navigation 没有 `RootStackParamList` 泛型，
  作者用 `as string` 绕过——**绕过的是正确的一半（该给 getParent 传泛型），留下了错误的一半（擦成 string）**。
  正确写法是给 `useNavigation` 一个 `CompositeNavigationProp<BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>>`，然后 `parent.navigate(route)` **不带 cast**，
  参数形状会被检查。另可把 `CONFIG_MENU` 的 route 类型收窄为
  `Array<{route: Extract<keyof RootStackParamList, 'AgentsSettings'|'Providers'|...>}>`——
  当前类型允许往菜单里塞 `'MainTabs'`，编译期不拦。
- **建议**：`useNavigation<Nav>()` 传复合泛型，删 `as string`；`WORKSPACE_GLOBAL_MENU.route`
  同理走类型检查。
- **置信**：confirmed

### Y6 —— `ProfileTabScreen.navigateTo` 在 `parent` 为 null 时静默失败 | P3 | confirmed

- **位置**：`screens/tabs/ProfileTabScreen.tsx:98-101`
- **描述**：`if (parent) { ... }` 无 else 分支。`getParent()` 返回 null 时**点菜单什么都不发生，无任何反馈**。
  正常挂载树下 Profile tab 在 MainTabs 内、parent 必存在，所以今天不会触发；
  但这是一个**静默失败分支**——一旦将来把 ProfileTabScreen 复用到别处（如独立路由、Storybook、
  截图 harness），菜单会整体变成死键且无提示。
- **建议**：加 else 分支 `console.warn('[ProfileTab] no parent navigator, route:', route)`，
  或改用 `navigation.getParent<...>()` 后断言。一行的事。
- **置信**：confirmed

### Y7 —— 屏内 `.catch(() => undefined)` 高频出现，部分是「兜底已在上游做过」的重复防御 | P3 | intentional（多数）/ 部分需复核

- **位置**（抽样 48 处，见 grep 结果）：`ChatConfigScreen.tsx:125-131`（连续 7 个）、
  `FileEditorScreen.tsx:283`、`RealPromptScreen.tsx:58`、`SkillDetailScreen.tsx:77`、
  `SubagentSessionScreen.tsx:205`、`ProviderDetailScreen.tsx:391,449` 等
- **描述**：这个模式在 React 里是**正确**的——`.catch()` 让「事件处理器里 fire-and-forget 的 promise」
  不产生 unhandled rejection。但密集出现会掩盖「这个 async 真的没有 catch」的信号。
  逐个抽查后判断：
  - `ChatConfigScreen.tsx:125-131` 的 7 个 `.catch(() => undefined)` 覆盖 `refresh*Pref`，
    而 `refreshNotificationPermission`（`:98-109`）**内部已有 try/catch** → 这层是重复防御，可留可去。
  - `FileEditorScreen.tsx:283` `handleSave().catch(() => undefined)` —— `handleSave`（`:167-205`）
    **整个函数体被 try/catch 包住且 catch 里已 `showToast`** → 这层 `.catch` 纯冗余，
    且它吞的是「理论上不可能发生的异常」。
  - `SubagentSessionScreen.tsx:205` `Linking.openURL(intent.url).catch(() => undefined)`
    —— **静默吞掉外跳失败**。对照 `UpdateCheckHost.tsx:30` 与 `AboutScreen.tsx:106` 的同款调用
    都 `.catch(err => showToast(toastMessage('无法打开链接', err)))`。**此处不一致，是真缺陷**（见 Y8）。
- **建议**：(a) `FileEditorScreen.tsx:283` 的冗余 `.catch` 可删（不改行为）；
  (b) `SubagentSessionScreen.tsx:205` 改为 toast，与另两处对齐；
  (c) 其余保留——这是 RN 事件处理器的标准防御，不值得为「统一」而删。
- **置信**：intentional（模式本身）/ confirmed（Y8 那处不一致）

### Y8 —— `SubagentSessionScreen.tsx:205` 外跳失败静默吞掉，与全仓另两处不一致 | P2 | confirmed

- **位置**：`screens/stack/SubagentSessionScreen.tsx:205`
  ```ts
  void Linking.openURL(intent.url).catch(() => undefined);
  ```
- **对照**：`components/update/UpdateCheckHost.tsx:30`
  `void Linking.openURL(data.releaseUrl).catch(err => showToast(toastMessage('无法打开链接', err)));`
  `screens/stack/AboutScreen.tsx:106`（`openLink`）
  `void Linking.openURL(url).catch(err => showToast(toastMessage('无法打开链接', err)));`
- **描述**：**三处相同操作，两处有 toast、一处静默**。`UpdateCheckHost.tsx:29` 的注释还写着
  「对齐 AboutScreen openLink：外跳失败（无浏览器可处理等）toast 而非裸 rejection」——
  **说明作者明确认为 toast 是正确口径，但这一处漏了**。
  用户在子会话里点一个 http 链接，若设备无浏览器可处理，**点了完全没反应**，
  与「无反应=链接坏了」无法区分。
- **建议**：与另两处逐字对齐（`showToast` + `toastMessage('无法打开链接', err)`）。
  需确认 `SubagentSessionScreen` 是否已解构 `showToast`——它有 `useToast`（`:36`），
  改 1 行。
- **置信**：confirmed

### Y9 —— `FileEditorScreen.tsx:166` 有一条与下方代码无关的悬空注释 | P3 | confirmed

- **位置**：`screens/stack/FileEditorScreen.tsx:166`
  ```ts
  // 技能辅助文件在详情页被删除时踢回，避免停留在已不存在的文件上
  const handleSave = async () => {
  ```
- **描述**：这条注释描述的是「文件被删时踢回详情页」，但它挂在 `handleSave`（保存函数）头上，
  而 `handleSave` 里**没有任何删除检测或导航**。真正的「踢回」逻辑在
  `SkillDetailScreen.tsx:56-61`（`kickedRef` + `showToast('技能不存在或已被删除')` + `navigation.goBack()`）。
  **注释漂移到错误的函数上**——维护者读 `handleSave` 会以为里面有删除检测。
  这正是 `memory/20260830-...:24` 列的 CR 八大问题面之一：「注释与实现漂移（多处失实注释误导）」。
- **建议**：删除该行（它描述的逻辑在 `SkillDetailScreen`，那里已有对应注释）。
- **置信**：confirmed

### Y10 —— `resolveVfs()` 的 switch 无 default，TS 穷尽性靠 `scopeKind` 联合类型维持，新增成员时会静默返回 undefined | P3 | intentional（但需监控）

- **位置**：`screens/stack/FileEditorScreen.tsx:94-124`
- **描述**：`:95` `switch (scopeKind)` 覆盖 `'physical'|'global'|'project'|'session'|'skill'` 五个成员，
  **无 `default` 分支**。返回类型因此被推断为含 `undefined`。
  若将来给 `RootStackParamList.FileEditor.scopeKind`（`navigation/types.ts:42`）加第 6 个成员，
  **switch 不报错**（TS 对无 default 的 switch 返回值不强制穷尽检查，除非开
  `noImplicitReturns` + 显式返回类型断言），运行时返回 `undefined`，
  下一行 `vfs.read(path)` 抛 `Cannot read property 'read' of undefined`——**报错点远离改动点**。
- **辩护补充**：当前 5 个成员与 `types.ts:42` 完全对齐（实测），**今天没有 bug**；
  且 `:128-131` 的 `resolveWritableVfs` 用 `as VfsService` 收窄，注释（`:126-127`）
  已说明「physical 分支类型层面无写方法且保存已禁用」。
- **建议**：加一行 `default: throw new Error(...)`（或改用 `assertNever(scopeKind)`），
  把「新增成员忘改 switch」从运行期远处的 TypeError 变成编译期/改动点处的显式错误。
  约 2 行。
- **置信**：intentional（现状正确）/ 建议加防御

### Y11 —— `update-check/check-for-updates.ts` 的 `localVersion` 默认参数使「传错版本」无法被类型发现 | P3 | intentional

- **位置**：`update-check/check-for-updates.ts:13-16`
  ```ts
  export async function checkForUpdates(localVersion: string = APP_VERSION, fetchFn?: FetchFn)
  ```
- **描述**：生产两个调用方（`AboutScreen.tsx:82`、`services/update-check-flow.ts:50`）**都不传**，
  所以默认值即契约。参数存在的唯一理由是可测性
  （`__tests__/update-check/check-for-updates.test.ts` 用它构造「本地版本低于/高于远端」的场景）。
- **辩护补充**：这是**标准的可测性注入**，不是设计缺陷。列在此处仅为完整性——
  若将来有人误传一个拼错的版本串，TS 拦不住（都是 `string`）。**用 `number[]` 之类结构化版本号可解，
  但那要改 core 的 `compareAppVersions` 签名，收益不匹配成本。**
- **置信**：intentional

### Y12 —— `utils/` 三函数中 `pickEntityIcon` 的 `hash % icons.length` 有轻微分布偏斜 | P3 | intentional

- **位置**：`utils/entity-icon.ts:6-10`
  ```ts
  hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  ```
- **描述**：`hash * 31` 在 JS 里先以 double 算再 `>>>0` 截断——`hash` 最大约 2^32，
  乘 31 后约 2^37，**double 有 53 位尾数，精度无损**，截断结果等价于真 32 位溢出。
  这是**正确**的（很多实现会写成 `hash << 5` 之类在 JS 里溢出成负数）。
  分布上 `hash % icons.length` 对 2 的幂有轻微偏斜，但调用方 `AGENT_ICONS`/`PROJECT_ICONS`
  是 emoji 列表（几个到十几个），**视觉上不可分辨**。
- **辩护补充**：函数头注释「按实体 id 稳定选取图标（列表重排后不变）」点明了**真正需求是稳定性不是均匀性**——
  同一 id 永远同一图标，这由纯函数 + 无随机保证。**均匀分布不是需求，实现满足需求。**
- **置信**：intentional

### Y13 —— `main-tab-bar-style.ts` 的 `buildMainTabBarStyle` 与 `RootNavigator` 的 screenOptions 语义重复（同一份样式两个出口） | P3 | intentional

- **位置**：`navigation/main-tab-bar-style.ts:12`（唯一实现）与
  `RootNavigator.tsx:70`（`tabBarStyle: buildMainTabBarStyle(tokens, insets)`）、
  `screens/tabs/ChatTabScreen.tsx:76`（`tabBarStyle: resolveChatTabBarStyle(...)`）
- **描述**：**只有一个实现**，两个消费点。这不是重复，是**单点导出**——
  `ChatTabScreen` 需要在对话态把底栏设成 `{display:'none'}`（`:41-43`），
  若不复用 `buildMainTabBarStyle`，从对话态返回会话列表时底栏样式会与初始不一致。
  文件头注释「供 RootNavigator screenOptions 与对话态恢复共用」已说明意图。
- **辩护补充**：`ChatTabScreen.tsx:74-84` 的 `useLayoutEffect` **刻意不把 `navigation` 进 deps**
  （`:78` 注释：「navigation 在 RN 中引用稳定；勿列入 deps，避免测试 mock 每次新建对象导致死循环」）。
  这是**被真实问题（测试死循环）教育过的写法**，注释即证据。
- **置信**：intentional

### Y14 —— `EditorScreenShell` 的 `hasToolbar` 判定与 `titlePress`/`title` 的互斥关系靠调用方自觉 | P3 | intentional

- **位置**：`components/chrome/EditorScreenShell.tsx:92-93`
  ```ts
  const hasToolbar = save != null || title != null || titlePress != null || toggle != null;
  ```
  以及 `:122` `title == null ? null : titlePress ? (<Pressable .../>) : (<Text .../>)`
- **描述**：`titlePress` 存在但 `title` 为 null 时，`:122` 的三元短路使 **`titlePress` 被静默忽略**
  （`title == null` 分支先命中），toolbar 里既没标题也没可点按区——**静默丢弃一个 prop**。
  当前两个调用方都传了 `title`（`FileEditorScreen.tsx:285`、`PromptEditorScreen.tsx:356`），
  所以不触发。但契约是「`titlePress` 提供时标题区渲染为可点按变体」（`:48-49` 注释），
  **没有说它依赖 `title` 非空**。
- **辩护补充**：`EditorScreenShell` 不在本区（属 components 席），我只在此记录**导航层调用方与该契约的交互点**。
  `PromptEditorScreen.tsx:356` 的 composer 变体刻意传 `title={undefined}` 且不传 `titlePress`——
  **这个「两者都不传 → 整行不渲染」的分支正是 `:91` 注释描述的设计**（导航栏已有标题，页内不再叠一个）。
  **说明该 shell 的 props 组合是被设计过的，不是随手堆的。**
- **建议**（若 components 席也认）：把 `:122` 的判定改为
  `titlePress ? <Pressable>{title ?? ''}</Pressable> : title != null ? <Text>{title}</Text> : null`，
  或在类型层面把 `titlePress` 定义为 `title: string` 的伴生 prop。
- **置信**：intentional（现状无 bug）/ 契约有暗坑

---

## 争议与存疑（不抹平）

1. **`useFocusListReload` 的竞态（Y4）究竟是 P2 还是 P3，我与可能的检察官不同调。**
   我给 P2 的理由：ProviderDetail 的 fetcher 串行 await 多个服务，窗口可观；
   且 `TokenUsageStatsScreen.tsx:150` 的 seq 防护证明作者认这个模式。
   但我给 **suspected** 而非 confirmed：我**没有在真机复现**，也没有测出 `savedList` 在典型服务商数量下的实际耗时。
   **若验证代理测出该 fetcher P99 < 100ms，应降为 P3。** 这一条需要 W6 验证代理实测才能定级。

2. **`HeaderContext.chat` 死状态（Y2）算「迁移尾巴」还是「有意保留的兼容层」？**
   我倾向**尾巴**，依据是全仓零消费 + 三个测试还在 mock 它。
   但如果 chat-ui 席报告「近期有把 chat 顶栏态搬回 HeaderContext 的计划」，我的定性就要翻。
   **这个判断依赖 zone 外的意图信息，我拿不到。**

3. **`ProfileTabScreen.navigateTo` 的 `as string`（Y5）是不是「已知妥协」？**
   我不知道当初为什么没给 `getParent` 传泛型。可能是当时 TS 对
   `getParent()` 的泛型推断不работает（`@react-navigation` 的 `getParent<T>()` 签名在旧版本需要显式传参），
   也可能单纯是图省事。**如果是前者，我的建议要改**（改成 `getParent<NativeStackNavigationProp<RootStackParamList>>()` 而非给
   `useNavigation` 换泛型）。这一条需要查 `@react-navigation` 的实际版本签名才能定论。

4. **`PAGE_HEADER_CONFIG` 与 `RootStackParamList` 的绑定强度可能被高估。**
   `header-config.ts:6` 的 `HeaderPageKey = keyof RootStackParamList | 'chat' | 'profile'`
   确实让 `Record<HeaderPageKey, ...>` 编译期穷尽（我的 D1 核心论据）。
   **但我没跑 `tsc` 实测**——我是读类型声明推断的。若该文件实际用了 `Partial<Record<...>>`
   或有 `// @ts-ignore`，我的 D1 论据就不成立。**建议 reduce 阶段跑一次
   「删掉 header-config 某条 → tsc 是否报错」的实测。**

5. **关于 `update-check/` 是否该整体下沉进 `packages/core`。**
   它是纯逻辑、跨端可能复用（desktop 也有更新检查？——我没查 desktop 是否有等价实现）。
   若 desktop 有一份平行实现，那这才是真正的双端重复问题，**但那属于 w3-xc-dup-ends 席的判断范围**，
   我不越界断言，只标记「值得 reduce 阶段交叉核对」。

---

## 附：本席未能覆盖的盲区（诚实声明）

- `screens/stack/token-usage/*`（6 文件，DetailTab/RequestsTab/StatsFilterBar/SummaryTab/format/styles）
  只做了结构性扫读（`TokenUsageStatsScreen.tsx` 的编排逻辑 + `format.ts` 的类型边界），
  **未逐行读完 6 个文件**。若该子域被指派给别的席位则无碍；若无人认领，需补扫。
- `screens/stack/SmartSortRuleEditorScreen.tsx`（706 行）、`ChatHistorySearchScreen.tsx`（541 行）、
  `SessionDetailScreen.tsx`（565 行）、`SkillsSettingsScreen.tsx`（525 行）、
  `ProviderDetailScreen.tsx`（509 行）——**均只读关键段落**（导航调用点、hook 调用点、状态机部分），
  未逐行。这几屏的纯渲染/表单内部逻辑可能有本席漏掉的问题。
- **未跑 `tsc` / `knip` / `jest`**，所有「编译期会报错」的论断（D1、Y10、争议点 4）
  **均为类型声明推断，非实测**。W6 验证代理应实测复核。
- 未读 `packages/core` 的 `compareAppVersions` / `excerptReleaseNotes` 实现，
  `update-check` 的正确性判断止于「本区调用方式正确」。
