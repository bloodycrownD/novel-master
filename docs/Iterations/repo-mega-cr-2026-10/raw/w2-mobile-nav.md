---
zone: mobile-nav
agent: domain-survey
files_scanned: 70
---

# W2 · mobile-nav 按域测绘报告

覆盖范围（70 个文件，全部通读）：

- 根：`apps/mobile/src/App.tsx`、`apps/mobile/src/polyfills.ts`
- `apps/mobile/src/navigation/`：8 个（RootNavigator / types / header-config / HeaderContext / ChatTabNavContext / StackScreenLayout / main-tab-bar-style / navigation-container-ref）
- `apps/mobile/src/hooks/`：15 个（全部）
- `apps/mobile/src/update-check/`：5 个（全部）
- `apps/mobile/src/utils/`：3 个、`apps/mobile/src/types/`：1 个（全部）
- `apps/mobile/src/screens/stack/`：28 个（含 `token-usage/` 6 个、`storage-config-migration-values.ts`）
- `apps/mobile/src/screens/shared/list-screen-styles.ts`
- `apps/mobile/src/screens/tabs/ProfileTabScreen.tsx`（tabs/chat-tab 属 W1 域，未读）

未读但被本区引用的外部物（仅作依赖登记）：`components/chrome/*`、`components/agent/AgentEditorForm`、`services/*`、`storage/*`、`runtime/*`、webview 相关。

---

## 摘要

这一片是移动端的「骨架 + 设置面 + 更新检查」：`App.tsx` 串起 runtime/theme/toast 三层 Provider，`RootNavigator` 用「底部双 Tab（对话/我的）+ native stack」承载全部设置与工作流页面（智能体、服务商、模型采样、存储、云同步、搜索、技能、文件编辑、会话详情、子会话、数据统计、关于）。`navigation/` 额外自研了一套 header 体系（`PAGE_HEADER_CONFIG` 静态表 + `stackOverride` 动态覆盖 + `ownerRouteKey` 归属过滤），因为 `headerShown:false` 后所有顶栏由 `AppHeader` 自绘。`hooks/` 是这一片沉淀下来的通用能力层（聚焦重载、批量多选/删除确认、未保存守卫、VFS 返回上翻三件套、键盘避让）。`update-check/` 是纯函数 + fetch 编排的小模块。

## 职责与边界

- **有**：
  - 路由表与路由参数契约（`navigation/types.ts` 是全 app 唯一的路由真源）。
  - 顶栏渲染的静态配置与动态覆盖通道。
  - 除「对话 Tab」与「我的 Tab」本体之外的全部页面装配与业务编排（列表/表单/详情/进度）。
  - 列表屏通用范式（`useFocusListReload` + `useBatchSelection` + `useBatchDeleteConfirm` + `useDismissOverlaysOnBlur` + `listScreenStyles`）。
  - 编辑类页面的统一外壳（`EditorScreenShell` 的两个使用者：FileEditorScreen、PromptEditorScreen）与未保存守卫。
  - GitHub 发行版检查的取数/解析/编排。
- **无（明确不在本区）**：
  - 对话 Tab 内部（`screens/tabs/chat-tab/*`、ChatTabScreen）——W1 域。
  - VFS 文件浏览器、编辑器 WebView、聊天转录 WebView 的实现（`components/vfs/*`、`components/chat/*`）。
  - 一切 core 服务实现（`packages/core/*`）；本区只调 runtime facade。
  - 运行时引导/数据库连接（`runtime/*`、`db/*`）。
- **半越界（已记录，见 F-mobile-nav-11）**：`SubagentSessionScreen` 反向 import 了 `screens/tabs/chat-tab/` 两个模块。

## 对外接口

**navigation/**

| 符号 | 位置 | 消费方 |
| --- | --- | --- |
| `RootNavigator` | `navigation/RootNavigator.tsx:199` | `App.tsx:23` |
| `RootStackParamList` / `MainTabParamList` / `ChatHeaderContext` | `navigation/types.ts:12/7/92` | 全 app 屏与 components |
| `PAGE_HEADER_CONFIG` / `HeaderPageKey` / `PageHeaderConfig` | `navigation/header-config.ts:14/6/8` | `components/chrome/AppHeader.tsx:8` |
| `HeaderProvider` / `useHeaderContext` / `useStackOverrideSetter` / `HeaderOverride` | `navigation/HeaderContext.tsx:41/60/72/15` | RootNavigator + 6 个 stack 屏（ProviderDetail / PromptEditor / SearchEngines / SearchEngineDetail / SmartSortRuleEditor / CloudSyncProgress）+ `hooks/useVfsBackNavigation` |
| `StackScreenLayout` | `navigation/StackScreenLayout.tsx:15` | `RootNavigator.withStackLayout` |
| `buildMainTabBarStyle` / `resolveChatTabBarStyle` / `TabBarInsets` | `navigation/main-tab-bar-style.ts:12/36/7` | RootNavigator:70 / ChatTabScreen:76 |
| `navigationContainerRef` | `navigation/navigation-container-ref.ts:11` | RootNavigator:205 / `services/agent-finished-notification.ts:487` |
| `ChatTabNavigationCtx` / `useChatTabNavigation(Optional)` + 两个 state/action 类型 | `navigation/ChatTabNavContext.tsx:42/45/55` | `components/chrome/AppHeader.tsx:10` / ChatTabScreen:28 |

**hooks/**（15 个，全部被消费，除 `useStreamTailGenerating`——见 F-mobile-nav-12）

`useRuntime`（全量屏）、`useMobileScope`（RealPromptScreen + chat-tab）、`useAutoUpdateCheck`（`components/update/UpdateCheckHost`）、`useAdaptiveKeyboardSheetStyle` + `useAndroidModalKeyboardAvoid`（`components/ui/ModalShell.tsx:30/31`）、`useAgentStreamMetrics`（`ChatStreamMetricsBar.tsx:13`、`ChatStreamMetricsBarLive.tsx:24`）、`useAndroidChatBackHandler`（chat-tab）、`useBatchDeleteConfirm`（Providers / ProviderDetail / SmartSortRules / SkillsSettings）、`useBatchSelection`（AgentList / ProjectDrawer / FetchModelsSheet / ChatTabScreen + 4 stack 屏）、`useDismissOverlaysOnBlur`（AgentList / VfsFileManager / ProviderDetail / Providers / SearchEngines / ProfileTab / chat-tab）、`useFocusListReload`（ProviderDetail / Providers / SearchEngines / SkillPanel / SkillsSettings / SmartSortRules）、`useUnsavedGuard`（AgentEditor / FileEditor / PromptEditor / SmartSortRuleEditor）、`useVfsBackNavigation`（GlobalTemplate / SkillDetail）。

**update-check/**：`checkForUpdates`（AboutScreen + `services/update-check-flow`）、`resolveLatestRelease` / `FetchFn` / `parseReleaseTag` / `LatestRelease` / `UpdateCheckData` / `UpdateCheckStatus`、`APP_VERSION` / `GITHUB_REPO` / `APP_LINKS` / `githubLatestReleaseApiUrl()` 等 URL 构造器。

**utils/**：`pickEntityIcon`（AgentList、ProjectDrawer）、`formatRelativeTimeMs`（ProjectDrawer、ChatSessionListPanel）、`nextDefaultSessionTitle`（chat-tab `useChatTabScope.ts:477`）。

## 数据访问

本区**不直接触表**，全部经 `runtime.*` facade；但记录了各屏触达的域与文件路径，便于 W3「表消费对账」机位交叉核。

| 屏/模块 | 触达域（runtime facade） | 证据 |
| --- | --- | --- |
| TokenUsageStatsScreen | `runtime.usageStats.{getSummary,getDailyBuckets,getModelBreakdown,getHourlyBuckets,listRequestUsage}`（底表 `chat_message` 逐消息 token 列）；`runtime.providers.list`；`runtime.savedModelRepo.listByProvider`（`llm_saved_model`） | `screens/stack/TokenUsageStatsScreen.tsx:134-139,188,235,242,283` |
| SmartSortRules/Editor | `runtime.smartSortRule.{listRules,createRule,updateRule,deleteRule,moveRule,setEnabled,setEnabledBatch,resetDefaults}` | `SmartSortRulesScreen.tsx:57,78,96,142,189,250` |
| SkillsSettings / SkillPanel / SkillDetail | `runtime.skills().{listSkills,effectiveSkills,deleteSkill,setDisabled}`（global/project meta 域 VFS）；`runtime.projects.list` | `SkillsSettingsScreen.tsx:112,116,198`、`SkillPanelScreen.tsx:65,102` |
| FileEditorScreen | `runtime.physicalVfs/globalVfs/projectVfs/sessionVfs/globalMetaVfs/projectMetaVfs` 的 `read`/`write`；session 域保存走 `sessionSaveVfsFile`（tool turn） | `FileEditorScreen.tsx:94-124,139,179,195` |
| SessionDetailScreen | `runtime.sessions.{get,rename}`、`loadChatAgentMeta`、`runCompactionWithTokenWarm`、`refreshComposerStatusAfterFloorOrCompaction` | `SessionDetailScreen.tsx:81,111,83,165,177` |
| SubagentSessionScreen | `runtime.sessionStreamUnitManager.{snapshot,subscribe,loadSessionTailMessages,attachWebview,detachWebview,stopRun}`、`runtime.messages.listBySession`、`runtime.sessionVfs/projectVfs` | `SubagentSessionScreen.tsx:61,73,88,151,96,200-201` |
| PromptEditorScreen | `runtime.skills().effectiveSkills`、`runtime.sessions.get`、`runtime.workplace({kind:'session'}).buildListRows` | `PromptEditorScreen.tsx:158,185-191` |
| StorageConfigScreen | `getCloudSyncLocalStatus`、`getDatabaseMaintenanceStats`、`runDatabaseMaintenance`、`exportDatabaseBackup`、`importDatabaseBackup` | `StorageConfigScreen.tsx:71,79,227,254,282` |
| CloudSyncConfig/Progress/Storage | `getCloudSyncConfig` / `setCloudSyncConfig` / `testCloudSyncConnection` / `pullCloudSync` / `pushCloudSync` / `getCloudSyncStatusView` / `runtime.secretStore.get('cloud-sync/s3-secret-key')` | `CloudSyncConfigScreen.tsx:60,121,130`、`CloudSyncProgressScreen.tsx:107,123`、`CloudSyncStorageScreen.tsx:46` |
| ChatConfigScreen | `runtime.preferences.{get,set}LlmStreamEnabled/SubagentStreamEnabled/ThinkingContextEnabled`、`runtime.compactionConditions.{get,set}Conditions`、`storage/chat-rich-text-pref`、`storage/message-notification-pref`、`services/agent-finished-notification`（通知权限/保活） | `ChatConfigScreen.tsx:67-121,232,283,305` |
| AboutScreen | `storage/update-prefs`（`updatesAutoCheck` / `lastCheckStatus` / `lastCheckRemoteVersion` / `dismissedVersion`） | `AboutScreen.tsx:11-19,60-97` |
| ChatHistorySearchScreen | `runtime.messages.searchMessages` | `ChatHistorySearchScreen.tsx:161` |
| ModelSampling / ProviderDetail / Providers | `runtime.providerModels.*`、`runtime.providers.*`、`runtime.state.{get,reset}Current{Provider,Model}Id` | `ModelSamplingScreen.tsx:94,153,167,188`、`ProvidersScreen.tsx:78-86` |
| SearchEngines/Detail | `services/search-config.store`（`runtime.searchConfig` 的读写包装） | `SearchEnginesScreen.tsx:140,164`、`SearchEngineDetailScreen.tsx:104,140,149,168` |
| update-check/ | 网络：`api.github.com/repos/bloodycrownD/novel-master/releases/latest`（10s 超时 + html_url 前缀校验） | `update-check/resolve-latest-release.ts:44-58` |

**非表类全局单例/模块级状态**（清理时必须知道）：

- `update-check/app-meta.ts:16` `APP_VERSION` = `import mobilePackage from '../../package.json'` —— 构建期注入，Metro 把 package.json 打进 bundle。
- `components/agent/prompt-editor-callback.ts:11` 模块级 `onSaved` 单例（push 前写、mount 时 take）。
- `components/chrome/ToastHost.tsx:77` `registerAppToastSink` 模块级 sink。
- `navigation/navigation-container-ref.ts:11` `navigationContainerRef`。
- `runtime/mobile-scope.ts:9` `MobileScopeSnapshot` = 持久化的「当前项目/当前会话」指针（`PersistentState`）。

## 依赖关系

**本区 import 谁**（按依赖面）：

- `@novel-master/core/*`：chat（`UsageStats*`、`ChatMessage`、`chatLinkNotFoundMessage`）、provider、skills、vfs、smart-sort-rule、compaction、agent（`DEFAULT_SUBAGENT_DEFINITION`）、prompt、feature-flags、format、common、以及根导出（`EngineId`、`isCloudSyncError`）。
- 本 app 内：`runtime/novel-master-context`（`useNovelMaster`）、`runtime/agent-activity`、`theme/*`、`errors/*`、`components/*`（ui/form/profile/sheet/batch/chrome/provider/agent/chat/vfs/skills/charts/icons/prompt）、`services/*`（cloud-sync、db-backup、db-maintenance、smart-sort-rule-yaml、vfs-zip、update-check-flow、chat-agent-meta、compaction-warm-orchestration、project-composer-status、search-config、model-display-label、agent-display-label、agent-create、session-stream-*）、`storage/*`（update-prefs、chat-rich-text-pref、message-notification-pref）。
- 唯一反向依赖 chat-tab：`SubagentSessionScreen.tsx:41-42`（见 F-mobile-nav-11）。
- `navigation/types.ts` 仍被 `components/chrome/AppHeader.tsx` 引用（`ChatHeaderContext`），与 `ChatTabNavContext` 注释宣称的「避免 components 反向依赖 screens」有出入——不过该类型本身已是死代码，见 F-mobile-nav-13。

**谁消费本区**：

- `App.tsx` ← `index.js`（RN 入口）。
- `RootNavigator` ← `App.tsx`。
- `navigation/types.ts` ← 全部 28 个 stack 屏 + ProfileTabScreen + `components/chrome/AppHeader.tsx`。
- `header-config.ts` ← `AppHeader`。
- `HeaderContext` ← RootNavigator + 6 屏 + `useVfsBackNavigation` + `AppHeader`。
- `hooks/*` ← 见「对外接口」表。
- `update-check/*` ← `AboutScreen` + `services/update-check-flow.ts`（经 `useAutoUpdateCheck`）。
- `screens/stack/*` ← 仅 RootNavigator（无其他直接消费方，屏不对外导业务函数）。
- `screens/stack/token-usage/format.ts` / `styles.ts` ← 主屏 + 三个页签（唯一的内部横向共享点，设计良好）。

---

## 发现清单

### F-mobile-nav-01 | P2 | `apps/mobile/src/screens/stack/SessionDetailScreen.tsx:254-255`

```
onSubmitEditing={() => commitTitle(titleDraft)}
onEndEditing={() => commitTitle(titleDraft)}
```

**描述**：RN 的 `TextInput` 在回车提交时 `onSubmitEditing` 与 `onEndEditing` 都会触发（同一次提交）。`commitTitle` 闭包里的 `sessionTitle` 是本次 render 的旧值，两次调用都满足 `next !== sessionTitle`，于是**发出两次 `runtime.sessions.rename`**、两次 `showToast('已重命名')`、两次 `DeviceEventEmitter.emit('session-renamed')`。第二次写的是同样的值，幂等所以不脏数据，但多一次 RPC + 双 toast，且第二次调用会与第一次并发（`rename` 未 await 完成就发第二次）。

**建议**：`commitTitle` 内加 in-flight 守卫（`renamingRef`），或在 `onSubmitEditing` 里只 `setEditingTitle(false)` 让 `onEndEditing` 承担唯一提交点（与 iOS 行为一致）。

**置信**：confirmed

---

### F-mobile-nav-02 | P2 | `apps/mobile/src/screens/stack/RealPromptScreen.tsx:23` + `apps/mobile/src/screens/stack/SessionDetailScreen.tsx:397`

```ts
// RealPromptScreen.tsx:23
const {projectId, sessionId} = useMobileScope();
// SessionDetailScreen.tsx:397
onPress={() => navigation.navigate('RealPrompt')}
```

**描述**：`RealPrompt` 路由无参数（`types.ts:16` `RealPrompt: undefined`），页面从 `useMobileScope()` 取的是**全局持久化的「当前项目/当前会话」**（`runtime/mobile-scope.ts:9-12`）。而入口在 `SessionDetailScreen` 里——用户可能正在查看会话 A 的详情页（该页路由参数是 `{projectId, sessionId}`），此时全局 current session 是 B。点「查看提示词」看到的是 B 的提示词，与所在页面语义不符，且无任何提示。

**建议**：`RealPrompt` 路由加可选参数 `{projectId?, sessionId?}`，入口显式传当前会话；缺省时回落到 scope（保留旧行为）。

**置信**：confirmed

---

### F-mobile-nav-03 | P2 | `apps/mobile/src/navigation/types.ts:39-53`（`:52`）

```ts
FileEditor: {
  path: string;
  scopeKind: 'global' | 'project' | 'session' | 'skill' | 'physical';
  ...
  /** Called after a successful session-scope save (refreshes workspace list). */
  onSessionVfsSaved?: () => void;
};
```

**描述**：路由参数里塞了**函数**，与本仓自己写下的规则直接冲突——`components/agent/prompt-editor-callback.ts:1-5` 的模块头注释原文：「React Navigation 路由参数要求可序列化，函数放进 params 会触发 "Non-serializable values" 警告，因此回调不走路由」。更关键的是：**全仓无人给 `onSessionVfsSaved` 赋值**（grep `onSessionVfsSaved` 只命中 types.ts:52 声明与 FileEditorScreen.tsx:60/190 消费），所以这是一个「违反既定契约 + 无人使用」的死参数，属于规则被绕过后的残留。

**建议**：删除该参数与 FileEditorScreen 里的调用；确有需要时按 prompt-editor-callback 的模块级存取范式补。

**置信**：confirmed

---

### F-mobile-nav-04 | P2 | `apps/mobile/src/screens/stack/AboutScreen.tsx:88-93`

```ts
} catch (err) {
  await persistFailedUpdateCheck(appUi);
  setLastStatus('error');
  showToast(toastMessage('检查失败', err));
}
```

**描述**：`catch` 块里的 `await persistFailedUpdateCheck(appUi)`（KV 写）自身抛错时，会把原始错误顶掉并让整个 `runManualCheck` 变成未处理 Promise 拒绝——而它是被 `void runManualCheck()` 调用的（`:130`），用户侧表现为**点了「检查更新」完全无反馈**（连「检查失败」toast 都没有）。对称地，成功分支里 `await persistUpdateCheckResult(appUi, data)` 若失败，会被同一个 catch 捕获并把状态标成 `'error'`，即「网络检查其实成功」被显示成「上次检查失败」。

**建议**：持久化包 `try/catch` 或 `.catch(() => undefined)`，保证 UI 反馈与真值对齐；`void runManualCheck()` 处补 `.catch()` 兜底。

**置信**：confirmed

---

### F-mobile-nav-05 | P2 | `apps/mobile/src/screens/stack/ProviderDetailScreen.tsx:77-78`

```ts
// 默认「模型管理」（高频），与「服务商配置」tab 并列；顶部 SegmentedControl 切换。
const [activeTab, setActiveTab] = useState<'config' | 'models'>('config');
```

**描述**：注释写「默认『模型管理』」，代码默认的是 `'config'`（服务商配置）。同一文件 `:78` 下方与 `PAGE_HEADER_CONFIG` 的静态标题「模型管理」（`header-config.ts:23`）叠加，用户进屏第一眼是服务商配置表单而非注释宣称的高频页。这类注释/代码漂移会持续误导后续维护者（也会误导 CR）。

**建议**：确认哪个是想要的默认态，改代码或改注释，二选一对齐。

**置信**：confirmed

---

### F-mobile-nav-06 | P2 | `apps/mobile/src/screens/stack/PromptEditorScreen.tsx:105-107`

```ts
const onSavedRef = useRef<PromptEditorOnSaved | null>(
  takePromptEditorOnSaved(),
);
```

**描述**：`useRef(initialValue)` 的实参在**每次 render 都会求值**（只是首次生效）。于是本屏每次重渲染（包括 composer 变体下每敲一个键）都会再调一次 `takePromptEditorOnSaved()`，把模块级单例 `onSaved` 读走并清空。当前单屏场景下 `ref` 已持有了值，多余的 take 返回 null、**看起来无害**；但它是一个「无消费方却会清空单例」的隐性副作用——只要出现「已挂载的 PromptEditor 与新的 `setPromptEditorOnSaved` 并存」的时序（例如另一处表单在 push 之前 set 回调、而旧屏刚好重渲染一次），回调就会被旧屏吞掉，新屏拿到 null，保存静默失效。

**建议**：改为惰性初始化 `const onSavedRef = useRef<...>(null); if (onSavedRef.current === null) onSavedRef.current = takePromptEditorOnSaved();`（配 `useState` 惰性初始化亦可），确保 take 只发生一次。

**置信**：suspected（当前调用图为单屏，但机制确实有洞）

---

### F-mobile-nav-07 | P2 | `apps/mobile/src/hooks/useFocusListReload.ts:47-68`

```ts
const next = await fetcher();
setRows(next ?? fallbackValue);
```

**描述**：通用列表 hook **没有任何请求序号守卫、也没有卸载/取消守卫**。同一文件头注释说这是「聚焦即重载」的通用范式，被 6 个屏复用；聚焦重载是高频触发（每次 focus 一次），而某些屏的 fetcher 较慢（`ProviderDetailScreen` 先 `providers.get` 再 `providerModels.savedList`；`SkillsSettingsScreen` 对每个项目串行 `listSkills`）。慢的旧请求晚于新的落地，就会把新数据覆盖回旧数据。同仓的 `TokenUsageStatsScreen.tsx:130-141` 明确实现了 `reloadSeqRef` 守卫并注释「过期响应后到整体丢弃」，说明这个模式是被认可的——只是通用 hook 漏了。

**建议**：在 `useFocusListReload` 里加 `seqRef`（`++seqRef` 后落地前比对），与 TokenUsageStatsScreen 同款；顺带加 unmount 保护。

**置信**：confirmed

---

### F-mobile-nav-08 | P2 | `apps/mobile/src/screens/stack/ProviderDetailScreen.tsx:104-106`

```ts
const provider = await runtime.providers.get(providerId);
setStackOverride({title: provider.displayName});
```

**描述**：在 `useFocusListReload` 的 `fetcher`（一个「取数据」的纯语义闭包）里做**渲染副作用**（改全局 header 状态），且无聚焦/取消守卫。`fetcher` 的引用变化会带动 `reload` → `useFocusEffect` 重跑（`useFocusListReload.ts:70-74`）；若这次 fetch 在屏失焦后才 resolve，`setStackOverride` 会在失焦之后把标题写回全局。虽然 `useStackOverrideSetter` 带的 `ownerRouteKey` 能挡住「泄漏到相邻屏」（`HeaderContext.tsx:78`），但同屏内「config/models 两 tab 切换」与「栈上再 push 一屏」期间仍可能出现标题抖动或停留脏值。另 `:141-145` 单独挂了一个失焦清空的 `useFocusEffect`，两者靠调用顺序对齐，是隐式耦合。

**建议**：标题 override 移出 fetcher，改为独立的 `useFocusEffect`（拿到 provider 后在聚焦作用域内 set），与 `SearchEnginesScreen.tsx:126-136` 的写法对齐。

**置信**：confirmed

---

### F-mobile-nav-09 | P2 | `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx:239-250`

```ts
for (const p of providerList) {
  labels[p.id] = p.displayName;
  providerEntries.push({id: p.id, label: p.displayName});
  const saved = await runtime.savedModelRepo.listByProvider(p.id);
```

**描述**：`reloadModels` 在 `useFocusEffect` 里每次聚焦跑一遍，对 N 个服务商**串行 await** N+1 次查询。服务商数上去后（N≥10）这一屏的进入延迟线性增长，而这些结果只用来生成筛选下拉的选项（纯展示）。

**建议**：`Promise.all` 并发（注意底层 tdbc 事务内语句必须同步，批外并发读应无碍；如担心连接串行化，至少把 `listByProvider` 收敛成一次 `list()` 批量接口）。

**置信**：confirmed

---

### F-mobile-nav-10 | P2 | `apps/mobile/src/screens/tabs/ProfileTabScreen.tsx:97-102`

```ts
const navigateTo = (route: keyof RootStackParamList) => {
  const parent = navigation.getParent();
  if (parent) {
    parent.navigate(route as string);
  }
};
```

**描述**：两点。其一，`route as string` 把 `keyof RootStackParamList` 的类型信息整个丢掉——任何拼错的字符串都能过编译，运行期静默失败。其二，`parent` 为 null 时**静默无动作**（用户点了没反应，没有任何提示）；理论上 Profile tab 永远有父导航器，但 `navigateTo` 是「8 个配置项 + 3 个工作区项」共用的唯一出口，一旦导航结构变化就是整屏死按钮。

**建议**：改用 `useNavigation<NativeStackNavigationProp<RootStackParamList>>()` + `navigation.getParent<...>()?.navigate(route)`，并对 `parent == null` 加一次性告警/禁用。

**置信**：confirmed

---

### F-mobile-nav-11 | P2 | `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:41-42`

```ts
import {resolveChatLinkIntent} from '@/screens/tabs/chat-tab/chat-link-nav';
import {useInterruptedPartialCommit} from '@/screens/tabs/chat-tab/useInterruptedPartialCommit';
```

**描述**：`stack` 层的一个屏直接 import `tabs/chat-tab/` 的两个实现模块。`navigation/ChatTabNavContext.tsx:2-4` 的注释把「components 不反向依赖 screens」当成 cr-fix 的架构整改成果，而这里 screens→screens 的横向依赖把 W1（chat-tab）与 W2（stack）两个域在编译期绑死：chat-tab 侧任何重构都会牵动子会话页，反向亦然；同时形成潜在的 require-cycle 风险面（`docs/apm/RULE.md:92` 记录过「模块级 import 的 require-cycle 只在依赖解析顺序变化时才炸，worktree 没炸主仓炸」的真实事故）。

**建议**：把 `resolveChatLinkIntent`（纯函数）与 `useInterruptedPartialCommit`（hook）上提到 `services/` 或 `components/chat/` 的中立位置，两侧都从那里取。

**置信**：confirmed

---

### F-mobile-nav-12 | P3 | `apps/mobile/src/hooks/useStreamTailGenerating.ts`（全文 13 行）

```ts
export function useStreamTailGenerating(uiRunning: boolean): StreamTailGenerating {
  return {streamTailGenerating: uiRunning};
}
```

**描述**：全 `src` grep `useStreamTailGenerating` / `streamTailGenerating` 只命中本文件自身，无任何消费方（`__tests__` 也没有）。同文件头注释说「与 uiRunning 同生命周期」——即它是一个已被内联取代的空壳 hook。

**建议**：删除文件。同目录 `useAgentStreamMetrics.ts` 的做法可作参照（那支保留了纯函数并注明「hook 本体退役」，但至少还有两个消费方）。

**置信**：confirmed

---

### F-mobile-nav-13 | P3 | `apps/mobile/src/navigation/HeaderContext.tsx:32-58`

```ts
interface HeaderContextValue {
  chat: ChatHeaderContext;
  setChat: (patch: Partial<ChatHeaderContext>) => void;
  stackOverride: HeaderOverride | undefined;
  setStackOverride: (override: HeaderOverride | undefined) => void;
}
```

**描述**：`chat` / `setChat` 及其 `useState` 是死状态——全 src 无 `setChat(` 调用（grep 命中的 `setChat*` 全是 `setChatRichTextEnabled` / `setChatSubview` 等无关标识符），唯一消费方 `components/chrome/AppHeader.tsx:27` 只解构了 `stackOverride`。真正在用的是 `ChatTabNavContext`（另一套 `chatSubview`，字面量还不同：`'sessions'|'conversation'` vs `'list'|'conversation'`）。也就是说 `navigation/types.ts:92` 的 `ChatHeaderContext` 类型、context 里的两个字段、以及 provider 里的一次多余 state 全是迁移残留。

**建议**：删除 `chat`/`setChat` 与 `ChatHeaderContext` 类型；同时把 `chatSubview` 的两套字面量口径统一（否则同名不同义，读者极易踩）。

**置信**：confirmed

---

### F-mobile-nav-14 | P3 | `apps/mobile/src/screens/stack/SkillsSettingsScreen.tsx:419-423`

```ts
keyExtractor={(entry, index) =>
  entry.kind === 'header'
    ? `header:${entry.project.id}`
    : rowKey(entry.row) + `:${index}`
}
```

**描述**：行 key 拼了 `index`，与同文件 `:167-170` 精心设计的稳定 `rowKey`（`global:name` / `projectId:name`）自相矛盾。列表插入/删除/重排后同一行 key 会变，FlatList 的 item 复用与 `removeClippedSubviews` 行为退化（项目 tab 的分组数据每次 reload 重建，顺序还依赖 `runtime.projects.list()`）。

**建议**：直接用 `rowKey(entry.row)`（分组头与行不会撞：头以 `header:` 开头，行以 `global:` / `projectId:` 开头）。

**置信**：confirmed

---

### F-mobile-nav-15 | P3 | `apps/mobile/src/screens/stack/SessionDetailScreen.tsx:184-195`

```ts
onSucceeded: async () => {
  ...
  DeviceEventEmitter.emit('session-transcript-changed', {sessionId});
},
onFinally: async outcome => {
  if (outcome.ok) { DeviceEventEmitter.emit('session-transcript-changed', {sessionId}); }
  await load();
},
```

**描述**：压缩成功时 `session-transcript-changed` 被广播两次（`onSucceeded` 一次、`onFinally` 里 `outcome.ok` 又一次）。两次的区别只是时序（预热落定前后各一次，注释解释了这个意图），但聊天页订阅方会因此重复 reload 整个转录；文件头的注释把两处都当作「刻意」写的，故只报为 P3 冗余，不建议直接删。

**建议**：若聊天页订阅侧已做去重则标注 intentional 并在两处写明；否则合并为一次（或带 `reason` 字段区分，让订阅方自行决定）。

**置信**：suspected

---

### F-mobile-nav-16 | P3 | `apps/mobile/src/screens/stack/CloudSyncProgressScreen.tsx:83-97`

```ts
useFocusEffect(useCallback(() => {
  const onBack = () => { if (runningRef.current) { return true; } return false; };
  const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
  return () => subscription.remove();
}, []));
```

**描述**：`BackHandler` 是进程级全局的，多个 handler 依注册倒序串行。本屏的 handler **不判 `navigation.isFocused()`**——本屏在栈顶时先跑、返回 false 后会继续落到更早注册的 handler（例如 `hooks/useVfsBackNavigation.ts:41-53` 那个）。后者正是因为这个链条才加了 `if (!navigation.isFocused()) return false;` 的注释说明。本屏同步完成瞬间（`runningRef` 由 true 翻 false 与 `navigation.goBack()` 相邻，`:136-137`）存在极短窗口，下层 VFS 屏的返回可能被本屏这次 false 放行走掉。

**建议**：照 `useVfsBackNavigation` 的先例，在 handler 首行加 `if (!navigation.isFocused()) return false;`。

**置信**：suspected（窗口极窄）

---

### F-mobile-nav-17 | P3 | `apps/mobile/src/screens/stack/ModelSamplingScreen.tsx:94-98`

```ts
const saved = await runtime.providerModels.getSavedById(savedModelId);
if (saved == null) {
  showToast(toastMessage('加载失败', '模型不存在'));
  return;   // finally 置 loading=false，页面留下一个全空的表单
}
```

**描述**：模型已被删除时只 toast 并 `return`，不 `goBack()`。屏继续渲染空白表单（`modelName` 空、`contextWindowTokens` 空），用户点保存只会得到「模型名称不能为空」。同文件 `:129-134` 对「缺 savedModelId」是 `goBack()` 的，同文件 `:118-121` 对加载异常也只 toast——三种失败出口三种待遇。`ProviderDetailScreen.tsx:147-152` 的对照做法（缺参即 `goBack()`）更一致。

**建议**：统一失败出口：模型不存在 → toast + `navigation.goBack()`。

**置信**：confirmed

---

### F-mobile-nav-18 | P3 | `apps/mobile/src/hooks/useBatchDeleteConfirm.ts:29-51`（三处调用点均未 memo 化入参）

```ts
const confirmBatchDelete = useBatchDeleteConfirm<string>({
  title: '删除模型',
  message: ids => `确定删除选中的 ${ids.length} 个模型？`,   // 每次 render 新函数
  deleteOne: useCallback(...),                              // 这里 memo 了
  onDone: async () => { ... },                              // 每次 render 新函数
});
```

**描述**：hook 用 `useCallback` 包裹返回值（`[title, message, deleteOne, onDone]` 为依赖），但三个调用点里 `message` 与 `onDone` 都是内联箭头函数（`ProviderDetailScreen.tsx:170-183`、`SmartSortRulesScreen.tsx:158-172`、`SkillsSettingsScreen.tsx:182-213`），`deleteOne` 在 `SmartSortRulesScreen` 里倒是 memo 了。结果：每次父屏 render 都产出一个新回调，hook 的记忆化形同虚设。当前消费方都是 `onPress`/`onDelete` 直接挂载，尚未造成 bug，但 hook 存在的前提（稳定引用）被系统性破坏，将来挂进 `useMemo`/`useEffect` 依赖就会炸。

**建议**：要么在 hook 内改用 ref 读最新入参（对齐 `useAutoUpdateCheck.ts:39-42` 的 `uiRef` 范式），要么三处调用点把 `message`/`onDone` 也 `useCallback`。前者更省事、也更符合本仓已有的 ref 取最新值范式。

**置信**：confirmed

---

### F-mobile-nav-19 | P3 | `apps/mobile/src/polyfills.ts:70-81`

```ts
} else if (
  typeof globalThis.Blob !== 'undefined' &&
  typeof globalThis.Blob.prototype.arrayBuffer !== 'function'
) { ... }
```

**描述**：`else if` 分支要求 `Blob` 存在**且** `Blob.prototype.arrayBuffer` 不存在。在 RN/Hermes 上 `Blob` 存在时 `arrayBuffer` 必然是标准方法（RN 内建），所以该分支实质不可达；可达的是上面的 `FileReader` 分支——它会**无条件覆盖**内建的 `Blob.prototype.arrayBuffer`。这不是 bug（文件头注释解释了动机：AWS SDK 拿 Blob 响应体时 RN 自带 `arrayBuffer` 可能异常），但属于「全局猴补 + 死分支」组合，注释里没标出 else 分支的不可达性。

**建议**：给 else 分支加注释说明其为不可达兜底（或直接删）；若 RN 已修好该问题，连 FileReader 覆盖也该撤掉——建议 W3 单开一条「polyfill 有效性」核实项。

**置信**：suspected

---

### F-mobile-nav-20 | P3 | `apps/mobile/src/screens/stack/GlobalTemplateScreen.tsx:44` / `SkillDetailScreen.tsx:85-92`

```tsx
// GlobalTemplateScreen.tsx:44
vfs={runtime.physicalVfs()}
// SkillDetailScreen.tsx:85-92
const fileScope: VfsScope = domain === 'global' ? {kind:'global-meta'} : {...};
const fileVfs = domain === 'global' ? runtime.globalMetaVfs() : runtime.projectMetaVfs(projectId!);
```

**描述**：`create-mobile-runtime.ts:184,187` 里 `physicalVfs()` / `globalMetaVfs()` 都是**每次调用 new 一个 service 对象**（`createScopedVfsService(conn, ...)` / `createPhysicalVfsService(conn)`）。这两屏在 render body 里直接调用，于是每次 render 都换一个新 `vfs` prop（`scope={{kind:'global'}}` 同样每次新建对象）。`components/vfs/VfsFileManager.tsx:278-285` 专门用 `vfsRef` 兜住了「引用抖动不触发重查」，但 `:472-473`、`:576-582` 的多个 `useCallback` 依赖里含 `vfs` ——这些回调每次 render 都会重建，下游 memo 全部失效。

**建议**：两屏用 `useMemo` 固定 `vfs`/`scope`（依赖 `runtime`/`domain`/`projectId`）。更根本的修法是在 runtime 层缓存这几个 service 实例。

**置信**：confirmed

---

### F-mobile-nav-21 | P3 | `apps/mobile/src/screens/stack/ChatHistorySearchScreen.tsx:141-190`

**描述**：`runQuery` 无请求序号守卫。`append: true` 与新查询（`append: false` 会先 `setResults([])`）并发时，慢的旧 append 会在新结果之后 `setResults(prev => [...prev, ...batch])` 追加，把已不属于当前筛选条件的历史行混进列表；`setHasMore` 也会被旧响应覆盖。屏内的 `onEndReached` 只用 `loading/loadingMore` 挡了同一 tick 的连点，挡不住跨请求竞态。搜索页无刷新按钮、用户只能靠改条件重查，污染会一直留到下次查询。

**建议**：照 `TokenUsageStatsScreen.tsx:130-141` 加 `seqRef`。

**置信**：suspected

---

### F-mobile-nav-22 | P3 | `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx:349` + `:262-266`

```ts
} catch { setCombos([]); setProviderLabels({}); setProviders([]); }   // :262-266
...
const libraryEmpty = combos.length === 0 && summary != null;            // :349
```

**描述**：`libraryEmpty`（库全空冷启动引导）的判据是「无任何服务商×模型组合」，但 `combos` 为空有两种来源：真的没配模型，或 `reloadModels` 抛错被 `catch` 清空（`:262-266`）。后者会让已用过的用户看到「Token 用量自记录功能上线起开始积累…发起点对话后这里会展示统计」这段**冷启动文案**，而库里其实有历史数据且 summary 已加载。

**建议**：`reloadModels` 失败时保留上一轮 `combos`（或加 `modelsLoadFailed` 标志让 `libraryEmpty` 不成立），避免用「配置为空」冒充「库为空」。

**置信**：confirmed

---

### F-mobile-nav-23 | P3 | `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:60,86,138,243`

```ts
const {sessionId, projectId, parentSessionId} = route.params;   // 类型是 string
...
if (sessionId == null) { return []; }                            // :86、:138、:243
```

**描述**：路由类型 `SubagentSessionView: {projectId: string; sessionId: string; parentSessionId: string}`（`types.ts:80-84`）保证三者非空，但屏内四处仍在判 `== null`（`:70`、`:74` 的 `manager.snapshot(sessionId != null ? ... : null)`、`:86`、`:137-138`、`:243-245`）。这类「类型已保证还写防御」的冗余让人误以为参数可选，也遮住了真正的空值风险（`FileEditor` 那种 `projectId?`）。

**建议**：清掉冗余判空；确需兜底就在 `useRoute` 边界做一次 `if (!route.params) return <Fallback/>`。

**置信**：confirmed

---

### F-mobile-nav-24 | P3 | `apps/mobile/src/update-check/check-for-updates.ts:17` + `parse-release-tag.ts:9`

```ts
const TAG_PATTERN = /^v?(\d+\.\d+\.\d+)(?:[-+].*)?$/;   // 预发布后缀被丢弃
const cmp = compareAppVersions(localVersion, release.version);
const status = cmp < 0 ? 'update-available' : 'up-to-date';
```

**描述**：`v1.6.0-beta.1` 会被解析成 `1.6.0`。若 GitHub 把预发布版标为 latest（或将来改用 `/releases` 列表），已在 `1.6.0` 的用户会被告知「有新版本 1.6.0」并跳到下载页，拿到 beta。当前用 `/releases/latest`（`resolve-latest-release.ts:47`）时 GitHub 默认排除预发布，所以今天不可达。

**建议**：要么显式拒绝带预发布后缀的 tag（`parseReleaseTag` 抛错或标记 prerelease），要么在 `checkForUpdates` 里对 prerelease 走不同提示。属于「设计上没覆盖的输入空间」，不是现网 bug。

**置信**：suspected

---

### F-mobile-nav-25 | P3 | `apps/mobile/src/utils/session-default-title.ts:4`

```ts
export const DEFAULT_SESSION_TITLE_PREFIX = '新会话';
```

**描述**：该常量只在本文件内被消费（`:26`），全 src 无外部引用。导出的死符号（其余两个 utils 的导出都有真实消费方）。

**建议**：去掉 `export`。

**置信**：confirmed

---

### F-mobile-nav-26 | P3 | `apps/mobile/src/navigation/RootNavigator.tsx:93-104`

```ts
function withStackLayout(pageKey: keyof RootStackParamList, Screen: React.ComponentType)
```

**描述**：`Screen` 被声明为无 props 的 `React.ComponentType`，把「屏不接受 props」这一事实从类型系统里抹掉。当前 28 个屏确实都不接 props，所以不产生错误；但未来某个屏需要 route 外的注入 props 时，这里会静默接受并丢弃。同时 `pageKey: keyof RootStackParamList` 强于 `HeaderPageKey`，对 stack 屏是正确收窄（这点是好的）。

**建议**：保持 `React.ComponentType` 现状即可，但建议注释标明「屏一律零 props」这条隐含契约，避免被误当作通用 HOC。

**置信**：intentional（现状无害，仅记录契约）

---

### F-mobile-nav-27 | P3 | `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:117-118`

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps -- mount/会话变化时水合一次；后续刷新由投影自驱
```

**描述**：`load` effect 的依赖是 `[sessionId, hasUnit]`，`hasUnit = unitView != null`。`hasUnit` 从 true→false（单元出表）会**再水合一次全量消息**，与注释「后续刷新由投影自驱」有张力：单元销毁那一刻其实已经由 `unitView.messages` 接管了显示（`:263 displayMessages = unitView?.messages ?? messages`），却又从库里全量拉一遍。子会话历史长时这是一次无谓的全量查询。

**建议**：明确 `hasUnit` 由 true→false 时的预期（是兜底回源还是不需要），据此收窄依赖或加注释说明「单元出表时必须回源」。

**置信**：suspected

---

### F-mobile-nav-28 | P3 | `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:51`

```ts
const SUBAGENT_TRANSCRIPT_HANDLE_ID = 'subagent-transcript';
```

**描述**：handle id 是**模块级常量**，而 attach/detach 的键是 `(sessionId, handleId)`（`:144` `const sid = sessionId`）。如果两个子会话屏同时挂在栈上（主会话 → 子会话 → 孙会话，`onOpenSubagentSession` 用的是 `navigate` 会**再 push 一层**而非 replace，`:169-178`），两层都 attach 同一个 handleId。是否冲突取决于 `SessionStreamUnitManager` 的注册表键实现（本区外）——若按 sessionId 分键则安全，若按 handleId 全局索引则会互相顶掉。

**建议**：核实 `services/session-stream-unit.ts` 的注册表键；如为全局键，把该常量改为按 sessionId 生成。

**置信**：suspected

---

## 争议与存疑

1. **`useUnsavedGuard` 的监听器随 `isDirty` 反复重订阅**（`hooks/useUnsavedGuard.ts:16-36`，依赖含 `isDirty`）。每次首键改动都会 unsubscribe/resubscribe `beforeRemove`。我倾向认为无害（重订阅是同步的，中间无用户可感窗口），但它同时让 `allowLeaveRef` 的语义变得微妙：若 `allowLeaveWithoutPrompt()` 之后因别的原因又发生一次 state 变化触发 effect 重跑，ref 仍在（ref 跨重订阅存活），行为正确。**没有报为问题**，仅记录已核查。

2. **「回填型 route 参数」这条规则到底是不是全仓铁律？** F-mobile-nav-03 判它是残留死参，依据是 `prompt-editor-callback.ts` 的模块注释。但仓库里确实存在**另一个**合法用法（`FileEditor` 的 `onSessionVfsSaved` 只是恰好没人用）。若 W3/L2 认为该注释只约束「AgentEditor ↔ PromptEditor 这一对」，则本条降级为 P3「清理死参」。我保留 P2，因为现状既违反自己写下的规则、又是死代码，两条独立理由都成立。

3. **`resolveChatTabBarStyle` 的双源样式**（`main-tab-bar-style.ts:36`）：主 Tab 的 `tabBarStyle` 由 RootNavigator 的 `screenOptions` 与 ChatTabScreen 的 `useNavigation().setOptions` 两处写，函数注释明说是「共用同一份」的设计。已核对 `buildMainTabBarStyle` 是唯一真源，**不算漂移**，不报。

4. **`TokenUsageStatsScreen` 空态拦全部页签**（`:409-423`）与「流水随时间窗口」的口径：文件头注释写明是「需求①勘误后」的用户定案（`范围空态覆盖全部页签`），即使库里有请求但窗口为空也不让看流水。按协议标 **intentional，不作为问题上报**。同理 `useBatchDeleteConfirm` 的「部分成功语义（已删的不回滚）」也是文件头写明的定案（`:3-5`），标 intentional。

5. **`PromptEditorScreen` 的「form / composer 两变体」**（RULE 未单列条目，代码头 `:1-28` 与 `navigation/types.ts:56-68` 注释一致）：这是用户 2026-09-29 拍板的「输入框全屏只要编辑」定案，`composer` 变体刻意不渲染保存/预览/分段、刻意不拦退出、刻意走伪路径 `composer.md` 激活 tag 胶囊。**标 intentional**，不因「form 变体与 composer 变体代码形态差异大」而报重复实现。唯一与之相关的实质发现是 F-mobile-nav-06（take 的多余求值），那与变体设计无关。

6. **`TokenUsageStatsScreen` / `SubagentSessionScreen` 与 core 的统计口径**：RULE 第 45 条已把命中率分母、模型筛选同源、`usage-cache-model-backfill-v1` 回填等口径写死。本区 UI 侧（`format.ts:hitRate`、`:resolveRangeDays`、`SummaryTab` 的饼图三态 label、`RequestsTab` 的 `${createdAtMs}-${index}` key）与之**逐条对得上**，未发现 UI 侧自行另立口径的情况，故未报。是否与 desktop 端 `TokenUsageStatsView` 逐像素同构，需 W3「双端重复实现」机位对拍。

7. **`ChatTabNavContext.chatSubview: 'list' | 'conversation'` 与 `HeaderContext.ChatHeaderContext.chatSubview: 'sessions' | 'conversation'` 字面量不一致**：因为后者整套是死代码（F-mobile-nav-13），我没有单独立一条，只在 13 里作为「迁移残留」记录。若 L2 决定保留 `HeaderContext.chat` 而非删除，则应另立一条「同名不同义的状态口径」。

8. **`SubagentSessionScreen` 对 W1 域（chat-tab）的两处 import**（F-mobile-nav-11）在本报告里按「架构耦合」定级 P2。如果 L2 掌握「chat-tab 侧这两模块近期就要搬家」的迭代计划，本条应降为「已排期的临时耦合」；我不知道该计划，故按现状定级。
