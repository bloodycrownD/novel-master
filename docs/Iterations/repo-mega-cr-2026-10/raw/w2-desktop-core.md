---
zone: desktop-core
agent: domain-survey
files_scanned: 87
scanned_at: 2026-09-30
base_sha: feat/repo-mega-cr @ main(9ca5f5ad)
---

## 摘要

Desktop 渲染进程（Electron renderer）的**骨架层**：React 应用入口与 Provider 树（bootstrap / 主题 / 导航）、三栏 Shell 布局（Chrome / Explorer / ChatRail / Preview）、与 main 进程通信的全部客户端面（preload bridge + IPC channel 映射表 + 147 个薄封装）、agent 流式事件订阅与 UI 生命周期、文件预览与划词批注宿主，以及 `apps/desktop/shared/` 里作为 renderer 唯一 core 出口的薄再导出层（X1 门禁的载体）与全部 IPC DTO 类型。渲染进程不碰数据库，所有领域访问走 `invoke`。

**规模**：87 文件 / 20,844 行（其中 `styles/shell.css` 单文件 8,081 行；TS/TSX 实际约 12.7k 行）。零 `any`（162 文件扫描确认）。

## 职责与边界

- **拥有**：应用骨架、导航状态机（projects → sessions → conversation → subagent-conversation）、预览 tab 生命周期、工作区刷新信号（`treeRefreshToken`）、IPC 客户端契约（channel 名单在此单点定义）、事件订阅（agent stream / agentActivity / workspaceMutated / promptTokenUpdated / userMessageAppended / startDragFailed / composerSuggest）。
- **不拥有**：main 进程 handler 实现、core 领域逻辑、任何数据库访问。
- **硬边界**：`apps/desktop/renderer/**` 严禁 `import "@novel-master/core*"`（X1 门禁，`apps/desktop/eslint.config.mjs:71-88`）；core 入口一律经 `apps/desktop/shared/logic/*` 具名再导出。**该边界当前在 main 上已被打破 9 处**（见 F-1）。
- **RULE 已知设计**（不作问题报）：
  - ShellNavProvider 旁路订阅 agent stream 刷文件树（`docs/apm/RULE.md:41`「子会话写入刷新（desktop）」）——有意为之，标 intentional。
  - `shared/logic/format-token-count.ts` / `usage-stats-format.ts` 是 core 副本（文件头自述 X1 门禁导致的双份实现）——标 intentional。
  - `useAgentStream` 的 `sessionId + acceptRunEvent` 双重守卫（`docs/apm/RULE.md:41`）——RULE 明写，标 intentional。

## 对外接口

| 出口 | 关键符号 | 位置 |
|---|---|---|
| IPC 客户端 | `createInvokeClient()` → 146 个 `ipc*` 薄封装；7 个 `on*` 订阅函数；`getDesktopBridge()`；`vfsScope()` | `renderer/ipc/invoke-registry.ts`、`renderer/ipc/client.ts` |
| 导航 Context | `ShellNavProvider` / `useShellNav()`：`ShellNavContextValue`（46 个成员） | `renderer/providers/ShellNavProvider.tsx:83-189` |
| 运行时 Context | `NovelMasterProvider` / `useNovelMaster()`：`{status, dbPath, error, retry}` | `renderer/providers/NovelMasterProvider.tsx` |
| 主题 Context | `ThemeProvider` / `useTheme()`：`{mode, loaded, setMode, toggleMode}` | `renderer/providers/ThemeProvider.tsx` |
| Scope 同步 | `loadDesktopScope()` / `setDesktopProject()` / `setDesktopSession()` | `renderer/state/desktop-scope.ts` |
| 导航映射 | `NAV_TO_WORKSPACE` / `syncWorkspaceWithNav()` / `railPaneNavTitle()` | `renderer/state/nav-workspace.ts` |
| run 生命周期 | `useAgentRunLifecycle()`：`beginUiRun` / `abortUiRun` / `acceptRunEvent` / `markExternalRunActive|Ended` | `renderer/hooks/useAgentRunLifecycle.ts` |
| 流式底座 | `useAgentStream()`：`{streamingText, streamingThinking, streamingTextRef, onStreamReset}` | `renderer/hooks/useAgentStream.ts` |
| 指标 | `useAgentStreamMetrics()` + `buildAgentStreamMetricsLabel()` + `createDesktopStreamTokenEstimator()` | `renderer/hooks/useAgentStreamMetrics.ts`、`stream-token-estimator.ts` |
| 布局 | `useColumnSplitters()`：`{workspaceRef, columnVisibility, toggleColumn}` | `renderer/hooks/useColumnSplitters.ts` |
| 预览批注 | `isPreviewAnnotateEnabled` / `collectAnnotateRangeForPreviewSelection` / `resolveAnnotateIdsFromClick` / `draftsToRecogitoAnnotations` | `renderer/layout/preview-annotate.ts`、`preview-recogito.ts` |
| Core 薄再导出 | 18 个 `shared/logic/*.ts`，共 180+ 具名符号（chat.ts 一家 101 个） | `apps/desktop/shared/logic/` |
| DTO | `IpcResult<T>`、`IPC_CHANNELS`、全部 Request/Response DTO | `apps/desktop/shared/ipc-types.ts`（1,741 行） |
| Bridge 契约 | `NovelMasterDesktopBridge`（`invoke` / `on` / `off` / `getPathForFile` / `startDrag`） | `src/preload/preload.ts:13-29` + `renderer/global.d.ts` |

## 数据访问

渲染进程**零直接数据访问**。全部经 IPC：

| 通道族 | 数据 | 客户端入口 | main handler |
|---|---|---|---|
| `SCOPE_*` | PersistentState 持久化的 project/session 指针（KVV `nm-desktop-ui` 同族） | `state/desktop-scope.ts:23-40` | `src/main/ipc/handler-registry.ts` |
| `APP_UI_GET/SET` | KKV `nm-desktop-ui`：`theme`、`updates.autoCheck`、`updates.lastCheckAt`、`updates.lastCheckStatus`、`updates.lastCheckRemoteVersion`、`updates.dismissedVersion`、`updates.snoozeUntil` | `ipcAppUiGet/Set`；键名 `shared/desktop-ui-keys.ts:4`、`hooks/useAutoUpdateCheck.tsx:25-29` | 同上 |
| `MESSAGES_*` / `VFS_*` / `WORKPLACE_*` | 会话消息块、工作区树/文件、目录规则 | `ipc/client.ts` | 同上 |
| `AGENT_STREAM` 等 7 个推送 | agent 流式事件、agentActive refcount、工作区变更、prompt token、userMessageAppended、startDrag 失败、composer 建议 | `onAgentStream` / `onAgentActivity` / `onWorkspaceMutated` / `onPromptChatTokenUpdated` / `onUserMessageAppended` / `onVfsStartDragFailed` / `onComposerAttachmentsSuggest`（`ipc/client.ts:189-259`） | `forward-event-bus` |

**文件路径**：渲染进程不碰磁盘。唯一文件系统接触面是 `getPathForFile`（preload `webUtils`）与 `startDrag`（main `webContents.startDrag`），二者都只透传绝对路径、不在 renderer 侧读内容。

## 依赖关系

**import 谁**

- `@shared/ipc-types`（1,741 行 DTO）— 被本区 40+ 文件依赖，是全 desktop 的类型中枢。
- `@shared/logic/*`（18 个薄再导出）— core 的唯一合法出口。
- `@novel-master/core/{events,chat,vfs,provider}` — **9 处直连，其中 6 处在本区**（违规，见 F-1）。
- 第三方：`react-markdown` / `remark-gfm` / `rehype-highlight` / `highlight.js` / `mermaid`（动态 import）/ `@recogito/text-annotator` / `js-tiktoken` / `codemirror`。
- `src/preload/preload.ts` 的类型（经 `global.d.ts` 反向 import 契约）。

**被谁消费**

- `features/**`（约 75 文件，本轮其他机位负责）消费本区的 `useShellNav` / `ipc/client` / `useAgentStream` / `useAgentStreamMetrics` / `useAgentRunLifecycle` / `toast-bus` / `shared/logic/*`。
- `ShellNavContextValue` 是 desktop 渲染层事实上的**单点状态源**：`projectId` / `sessionId` / `workspaceSessionId` / `previewTabs` / `treeRefreshToken` / `footerKey` / `agentConfigRevision` 全从这里发散。

**耦合热点（其他机位需知道）**

1. `ShellNavProvider` 1014 行 / 46 个 context 成员，任何导航字段变更都会牵动整个 Shell 重渲染。
2. `ipc/client.ts` 的 147 项解构导出是**编译期契约面**：新增/删除任一 `ipc*` 必须同步 `invoke-registry.ts` + `client.ts` + `handler-registry.ts` + `ipc-types.ts` 四处，否则漂移。
3. `shared/logic/events.ts` 存在的唯一目的就是给 renderer 提供 `EVENT_AGENT_RUN_FINISHED` 等 4 个符号——而 ShellNavProvider 绕过它直连 core（见 F-1）。

## 发现清单

### F-desktop-core-1 | P1 | apps/desktop/renderer/hooks/useAgentStream.ts:43

```
} from "@novel-master/core/events";
```

**描述**：X1 门禁（`apps/desktop/eslint.config.mjs:71-88`「X1 gate: ban literal @novel-master/core* in renderer only」）在 main 上**已被违反 9 处**，本区占 6 处。实跑 `npx eslint` 确认 6 个 `error`：

```
useAgentStream.ts:26  error  '@novel-master/core/events' import is restricted …
useAgentRunLifecycle.ts:12  error  '@novel-master/core/events' …
useAgentStreamMetrics.ts:30  error  '@novel-master/core/provider' …
ShellNavProvider.tsx:35  error  '@novel-master/core/events' …
ShellNavProvider.tsx:60  error  '@novel-master/core/chat' …
App.tsx:2  error  '@novel-master/core/vfs' …
```

三重问题叠加：(a) 门禁本身形同虚设；(b) CI 显式放行——`.github/workflows/ci.yml:57-59` 的 Lint step 是 `continue-on-error: true`（注释：「lint / typecheck 还有既存错误，先就位但允许失败」）；(c) 讽刺的是 **`shared/logic/events.ts` 这个专为绕过它而建的再导出层，自身 2 个符号零消费**（`EVENT_AGENT_RUN_FINISHED` / `EVENT_AGENT_STEP_COMMITTED` / 两个 payload 类型）——ShellNavProvider 需要的正是它 re-export 的那 4 个符号，却直连了 core。

**影响**：`preload.ts:3` 写明「Renderer must not import @novel-master/core; all domain access goes through invoke」。实际后果是 renderer bundle 会把 core 的 `events` / `chat` / `vfs` / `provider` 模块打进浏览器包（vite 会 tree-shake，但 chat/vfs 不是纯类型模块）。隔离的是沙箱与数据访问，不是模块依赖图。

**建议**：① 短期——把 9 处全部改走 `@shared/logic/*`（events.ts 已备好，vfs.ts / chat.ts / provider.ts 也已备好对应出口，**零新增再导出即可修完**）；② 中期——把 CI Lint 的 `continue-on-error` 去掉或降级为仅放行白名单规则，否则门禁修完也会重新腐化。

**置信**：confirmed（实跑 eslint + 逐条文本核实）

---

### F-desktop-core-2 | P1 | apps/desktop/renderer/ipc/invoke-registry.ts:204

```
ipcProjectsGetAgentConfig: withReq<ProjectGetAgentConfigRequest, IpcResult<ProjectAgentConfigDto>>(invoke, IPC_CHANNELS.PROJECTS_GET_AGENT_CONFIG),
```

**描述**：**10 个 IPC 端到端零消费**。三侧全在（channel 常量 + DTO 类型 + main handler + renderer 薄封装 + client.ts 再导出），唯独没有任何 renderer 代码调用它们。实测（`grep -rln` 全 apps/desktop，排除 client.ts / invoke-registry.ts 自身）每个符号**只有 2 处命中，就是定义它的两行**：

| 符号 | 通道 | main handler |
|---|---|---|
| `ipcProjectsGetAgentConfig` | `PROJECTS_GET_AGENT_CONFIG` | `handler-registry.ts:235` |
| `ipcProjectsUpdateAgentConfig` | `PROJECTS_UPDATE_AGENT_CONFIG` | `handler-registry.ts:237` |
| `ipcSessionsGetAgentBinding` | `SESSIONS_GET_AGENT_BINDING` | `handler-registry.ts:253` |
| `ipcWorkplaceCaptureSessionBlock` | `WORKPLACE_CAPTURE_SESSION_BLOCK` | `handler-registry.ts:293` |
| `ipcMessagesHideRange` | `MESSAGES_HIDE_RANGE` | `handler-registry.ts:303` |
| `ipcMessagesShowRange` | `MESSAGES_SHOW_RANGE` | `handler-registry.ts:304` |
| `ipcMessagesTruncateAfter` | `MESSAGES_TRUNCATE_AFTER` | `handler-registry.ts:305` |
| `ipcSmartSortRuleExportRules` | `SMART_SORT_RULE_EXPORT_RULES` | `handler-registry.ts:415` |
| `ipcSmartSortRuleImportRules` | `SMART_SORT_RULE_IMPORT_RULES` | `handler-registry.ts:416` |
| `ipcSkillsEdit` | `SKILLS_EDIT` | `handler-registry.ts:429` |

`ipcProjectsGetAgentConfig` / `ipcProjectsUpdateAgentConfig` 尤其可疑——`docs/apm/RULE.md:38` 记载「项目智能体（已下线）… v1.4.26 起已移除 UI 入口和解析分支，DB 列置空保留」。这两个通道是那次下线的**残留尾巴**：UI 拆了，IPC 面与 handler 留着。

**影响**：146 个通道的映射表是人工维护的白名单，10 条僵尸项（6.8%）稀释了对账信噪比——这正是 W1 报告「`ipcProjectsGetAgentConfig` 等零消费」线索的全量坐实。

**建议**：逐条判定「下线残留」vs「未接线功能」。项目智能体那两条（`PROJECTS_*_AGENT_CONFIG`）按 RULE「已下线」可直接摘除；`MESSAGES_HIDE_RANGE` / `SHOW_RANGE` / `TRUNCATE_AFTER` 需确认是否被 compaction / 置位的主路径替代（core 侧可能有等价服务方法，renderer 走的是别的口）——这一条**我无法在本区定论，已列入「争议与存疑」**。

**置信**：confirmed（零消费部分）／retirement 判定 suspected

---

### F-desktop-core-3 | P1 | apps/desktop/renderer/App.tsx:344

```jsx
onToggleSettings={() => setSettingsOpen(open => !open)}
```

**描述**：设置页的「未保存的更改」守卫可被绕过。`SettingsOverlay` 专门实现了 `guardedNav` 单一守卫入口，覆盖四个 Overlay 分发点（侧导航 / 返回 / 关闭按钮 / 跨组件事件）——`SettingsOverlay.tsx:126-134` 的注释把这个设计写得很清楚。但 AppChrome 的 ⚙ 按钮走的是 `App.tsx:344` 的 `setSettingsOpen(open => !open)`，**直接翻转 open，完全不经过 `SettingsOverlay.handleClose`**，因此 `guardedNav({nextViewId:"workspace"}, ...)`（`SettingsOverlay.tsx:239`）被整个跳过。

`SettingsOverlay` 是常驻挂载的（`App.tsx:359-365` 只传 `open` prop，没有条件渲染），所以后果是：dirty 子页（如 skillDetail）**不卸载也不重置**——`viewId` / `pageStack` / `navStateRef.current` 全部保留，编辑中的内容静静躺在被 `hidden` 的 DOM 里，用户以为关掉了。下次打开时守卫也不会再问（`dirtyViewsRef` 从没被清，但 viewId 没变，守卫的 `nextViewId !== currentViewId` 判据不触发）。

用户只要在技能详情页改了东西、点右上角 ⚙ 而不是 ×，未保存的更改就静默留存且无任何提示。

**建议**：`AppChrome` 的 toggle 改为「开 → 直接开；关 → 走 `SettingsOverlay` 暴露的 close 通道」，最小改法是 App 侧持有 `settingsCloseRequest` token 递增，SettingsOverlay 内 `useEffect` 监听该 token 调 `handleClose`（保持守卫在 Overlay 内单点）。

**置信**：confirmed

---

### F-desktop-core-4 | P2 | apps/desktop/renderer/providers/ShellNavProvider.tsx:590

```js
const exitSubagentSession = useCallback(() => {
  showNavView("conversation");
}, [showNavView]);
```

**描述**：退出子会话视图时**没有清 `subagentSessionId`**，而这个字段被外部当作「当前是否处于子会话视图」的判据用。`WorkspaceHeaderActions.tsx:33`：

```js
const isSubagentView = subagentSessionId != null;
const showSync = panelScope === "chat" && !isSubagentView;
```

后果：从子智能体卡片进入子会话视图 → 返回父会话后，`subagentSessionId` 仍是旧的 child id，`isSubagentView` 恒真，**父会话工作区的「从项目工作区同步」/「推送到项目工作区」入口永久消失**，且没有任何办法恢复（除非再进一次子会话）。`openProject` / `openSession` / `goBackToProjects` / `goBackToSessions` 同样都不清它，切项目切会话后该污染继续累积。

**建议**：`exitSubagentSession` 里补 `setSubagentSessionId(undefined); setSubagentSessionName(undefined);`；更稳妥的是在 `openProject` / `openSession` / 两个 `goBackTo*` 里也一并重置（子会话 id 属于「导航展示态」，换上下文就该清）。

**置信**：confirmed

---

### F-desktop-core-5 | P2 | apps/desktop/renderer/layout/PreviewPane.tsx:172

```js
useEffect(() => {
  void loadFile();
  setMode("read");
}, [loadFile]);

useEffect(() => {
  if (previewFile && !previewFile.isDeleted) {
    void loadFile();
  }
}, [treeRefreshToken, previewFile, loadFile]);
```

**描述**：三个叠加缺陷。

**(a) 重复取数**：两个 effect 都调 `loadFile()`，且 `loadFile` 的身份随 `previewFile` 变化 → 每次切换预览文件、每次 `treeRefreshToken` 递增，都会**发两次 `ipcVfsRead`**，结果互相覆盖。`loadFile` 内部 `setContent` / `setFileMissing` 是无条件写。

**(b) 无请求序号守卫 → 竞态串内容**：`loadFile` 是无取消的 async。快速连点两个文件时，先发的 A 请求若后于 B 返回，会把 A 的内容 `setContent` 到当前激活的 B tab 上。`previewFile` 被闭包捕获，所以不会报错，只会**静默显示错文件的内容**。`PreviewPane` 没有任何 `cancelled` 标志或 request-id 比较（对比同仓 `useAgentStream.ts:343` 的 `cancelled` 写法，这里是遗漏）。

**(c) 错误路径静默**：`loadFile` 的 `try` 只有 `finally`，没有 `catch`。非 `NOT_FOUND` 的错误码（`CONFLICT` / 权限 / IPC 抛错）会走到「既不 setContent 也不 setFileMissing」的分支——**上一个文件的内容继续显示在当前文件的预览区**，用户无从察觉读失败了。且 IPC reject 时 `void loadFile()` 产生 unhandled rejection。

**建议**：合并两个 effect 为一个；引入 `requestIdRef` 或 `cancelled` 标志做 stale 丢弃；`catch` 里兜底 `setFileMissing(true)` + `showToast`。

**置信**：confirmed

---

### F-desktop-core-6 | P2 | apps/desktop/renderer/hooks/useAutoUpdateCheck.tsx:70

```js
useEffect(() => {
  if (ranRef.current) return;
  ranRef.current = true;
  const timer = setTimeout(() => { ... }, AUTO_CHECK_DELAY_MS);
  return () => clearTimeout(timer);
}, []);
```

**描述**：实例级 `ranRef` 幂等标志 + StrictMode 双调用 = **开发环境下自动更新检查永不执行**。`main.tsx:11-15` 确认 `<StrictMode>` 包裹整个 App。React 的 mount 序列是：effect① → cleanup① → effect②。effect① 置 `ranRef=true` 并注册 2s 定时器；cleanup① **清掉该定时器**；effect② 撞上 `ranRef.current === true` 直接 return。于是**没有任何定时器存活**。

这精确命中 `docs/apm/RULE.md:82`「验收断言的『牙齿』」第 ② 条的镜像形态——进程/实例级去重标记被同一条生命周期的第一次调用消费掉，导致正向路径永远不可观测。

**影响**：所有本地开发与 QA 期间，「发现新版本」toast / 结果弹窗 / 自动检查偏好开关全部静默失效。生产构建无 StrictMode 双调用故不受影响——也就是说，**这个 bug 恰好只在开发者看得见的地方发生，在用户那里不发生**，极难被报告。

**建议**：去掉 `ranRef`，改用 `useState` 的惰性初始化或把清理改成「不清定时器、只置 cancelled 让回调内部自我退出」。

**置信**：confirmed

---

### F-desktop-core-7 | P2 | apps/desktop/renderer/layout/preview-annotate.ts:407

```js
export function applyAnnotateHighlights(root, drafts, options?) {
```

**描述**：本文件 980 行里约 **520 行在生产路径不可达**，仅被测试保活。三段证据：

1. `applyAnnotateHighlights`（407-503）+ 其私有工具链 `registerCssAnnotateHighlight` / `rangesIntersect` / `collectMatchDomRanges` / `createCharRange` / `wrapAllPlainMatchesFlat` / `wrapOccurrencesInDomain` / `collectUnmarkedTextDomains` / `isTableWhitespaceOnlyText` / `isInsideAnnotateMark` / `wrapRange`（505-979）——**全仓唯一调用方是 `test/preview-annotate.test.ts`**，生产零引用。
2. `isPreviewAnnotateDomSearchFallbackEnabled()`（54-56）恒返回 `false`，而它在**活路径** `resolveAnnotateIdsFromClick`（566）里被调用 → 该 `if` 之后 570-714 的 `resolveIdsFromHighlightHitTest`（145 行）与 mark 回退分支**永不执行**。
3. 模块级 `activeHighlightEntries`（110）只被 `registerCssAnnotateHighlight` 写，只被上述死路径读 → 恒为空数组。

更值得注意的是：仓库里有两条测试**专门断言 PreviewPane 不接线这些函数**——`test/preview-annotate-source-anchor.test.ts:336-339` 与 `test/preview-recogito-md.test.ts:78-81` 的 `assert.doesNotMatch(pane, /applyAnnotateHighlights/)`。也就是说，维护成本（~520 行代码 + ~30 条测试用例）买的是一条「不许接线」的负向断言。

文件头 `1-6` 与 `51` / `58` 的 `@deprecated SPEC R5` 注释表明这是**有意保留**的（等后续迭代可能重启 fallback）。按 PLAN 协议我标 `intentional`，但仍作为 P2 记录——保留 520 行 + 30 条用例只为守一条负向断言，成本收益比值得主代理复核。

**置信**：intentional（保留决策）/ confirmed（不可达事实，实测引用数）

---

### F-desktop-core-8 | P2 | apps/desktop/renderer/hooks/useColumnSplitters.ts:342

```js
const toggleColumn = useCallback((key: ColumnKey) => {
  setColumnVisibility((prev) => {
    ...
    materializedRef.current = false;
    commitColumnWidths(workspace, snapColumnWidthsForVisibility(workspace, next), next);
    return next;
  });
}, [...]);
```

**描述**：两个问题。

**(a) 副作用写在 setState updater 里**。`commitColumnWidths` → `applyWorkspaceLayout` 直接写 `document.getElementById(...).style` 与 `workspace.style.gridTemplateColumns`。React 的 updater 必须是纯函数：StrictMode 下会被调用两次（这里等于重复做一次布局计算，幂等所以不炸），更重要的是并发渲染下 React 可能丢弃这次 updater 的结果——副作用已经发生却不对应任何 commit。同时 `materializedRef.current = false` 也是渲染期 ref 写。

**(b) 窄视口下 toggle 状态与实际显示发散**。`layoutVisibility`（287-293）在 `narrowViewport`（`innerWidth <= 900`）时把 `preview` 强制按 false 处理，但 `columnVisibility.preview` 保持 true。于是窄窗口下点「左侧栏」按钮：`toggleColumn('preview')` 把 `columnVisibility.preview` 从 true 翻成 false，而显示层早已强制隐藏 preview——**用户的这一次点击在屏幕上看不到任何变化**，真正被关掉的是 explorer。同时 AppChrome 的按钮 `is-active` class 读的也是 `columnVisibility`（`AppChrome.tsx:91`），显示为「已隐藏」但实际可见。

**建议**：(a) 把 DOM 写入移出 updater，放到 `useEffect([columnVisibility])`；(b) `toggleColumn` 读写 `layoutVisibility` 而非 `columnVisibility`，或把窄视口下的 preview 按钮置 disabled。

**置信**：confirmed

---

### F-desktop-core-9 | P2 | apps/desktop/renderer/providers/ShellNavProvider.tsx:436

```js
setPreviewTabs((prev) => {
  ...
  setActivePreviewKey((activeKey) => { ... });   // ← updater 内再调 setState
  return next;
});
```

**描述**：三处同款 React 反模式（本区共 3 个）：

| 位置 | 外层 updater | 内层调用 |
|---|---|---|
| `ShellNavProvider.tsx:436`（`closePreviewTab`） | `setPreviewTabs` | `setActivePreviewKey` |
| `ShellNavProvider.tsx:464`（`closePreviewTabsUnderPath`） | `setPreviewTabs` | `setActivePreviewKey` |
| `SettingsOverlay.tsx:102`（`popView`） | `setPageStack` | `setViewId` |

`SettingsOverlay` 那处后果最实：设置页的「返回」按钮退栈时，`setViewId(prev)` 在 `setPageStack` 的 updater 内部执行。React 18/19 的 StrictMode 会双调用 updater，`setViewId` 因此被调两次；并发模式下 React 可以先跑 updater 再丢弃结果，此时 `viewId` 已经翻了而 `pageStack` 没退——**退栈后页面标题与实际渲染的 view 对不上**。

修法统一：把两个 state 合并成一个 `{previewTabs, activePreviewKey}` / `{viewId, pageStack}` 对象，或在 updater 外用局部变量算好再一次性提交。

**置信**：confirmed（反模式与三处位置）／行为后果 suspected（需实机复现）

---

### F-desktop-core-10 | P2 | apps/desktop/renderer/App.tsx:189

```js
const result = await ipcVfsZipExport(req);
```

**描述**：全域「浮动 promise + 无 catch」的系统性缺口。`handleWorkspaceAction` 是 `async`，但被 `void handleWorkspaceAction(menu, item.action)` 调用（`App.tsx:405`）；`ipcVfsZipExport` 抛错时 `void` 丢弃的 promise 变成 unhandled rejection，**用户看不到任何反馈，弹窗已关**。同类点位（实测）：

| 文件:行 | 表达式 |
|---|---|
| `App.tsx:189 / 307 / 323` | `await ipcVfsZipExport` / `ipcVfsZipImport` / `ipcVfsCharacterCardImport` |
| `App.tsx:229-250` | `await createWorkspaceEntry` / `renameWorkspaceEntry` |
| `App.tsx:283` | `await deleteWorkspaceEntry` |
| `layout/PreviewPane.tsx:151/333` | `await ipcPhysicalRead` / `await ipcVfsWrite` |
| `layout/ChatRail.tsx:84` | `await ipcAgentAbort`（`void stopSubagentRun()`，子智能体「停止」按钮） |
| `providers/ThemeProvider.tsx:64` | `await ipcAppUiSet`（`void toggleMode()`，主题切换按钮） |
| `hooks/useAutoUpdateCheck.tsx:130/141/153` | `await ipcAppOpenExternal` / `ipcAppUiSet` |
| `hooks/useDesktopAgentActive.ts:87` | ✅ 已 `.catch(() => undefined)`（正确范式，可作模板） |

Electron 的 `ipcRenderer.invoke` 在 main 侧 handler 抛错时**一定 reject**（不吞成 `IpcResult`），所以这不是理论风险。

**建议**：统一一个 `runGuarded(fn, onError)` 包装（内部 `try/catch` + `showToast(formatUserError(...))`），把上表点位逐个套上；`useDesktopAgentActive.ts:87` 已是现成范式。

**置信**：confirmed

---

### F-desktop-core-11 | P2 | apps/desktop/renderer/layout/ChatRail.tsx:160

```js
for (const id of ids) {
  await ipcProjectsDelete({ id });
}
```

**描述**：批量删除**完全忽略 `IpcResult.ok`**。`IpcResult<T>` 是 `{ok:true,data} | {ok:false,error}` 的判别联合（`shared/ipc-types.ts:218-220`），但 `deleteSelectedProjects`（160-177）/ `deleteSelectedSessions`（179-199）/ `handleConfirmAction` 的 `delete-project`（249-256）与 `delete-session`（258-267）四个分支都直接 `await` 后丢弃返回值。

后果：删 5 个项目时若第 3 个因外键/占用失败，**前 2 个已真删、后 2 个未删，UI 不弹任何错误**，`exitProjectBatch()` 照常执行清空选中态，用户以为全删成功。批量删除项目会连带删其下所有会话（确认文案 `ChatRail.tsx:763` 明说），**部分成功的数据后果不可逆**。

同类静默：`loadProjects`（114-124）/ `loadSessions`（126-136）在 `!result.ok` 时既不更新列表也不提示，只在 `finally` 里关 loading。

**建议**：循环内判 `ok`，收集失败 id 列表，`finally` 后一次性 `showToast(\`成功 N / 失败 M\`)`；至少要有 exit-code 语义的 toast。

**置信**：confirmed

---

### F-desktop-core-12 | P2 | apps/desktop/renderer/layout/AppMenuBar.tsx:14

**描述**：本区实测出的一组「零消费」死代码/死导出，合计可删约 60 行 + 29 条再导出：

| 符号 | 位置 | 实测引用数 |
|---|---|---|
| `AppMenuBar`（41 行整组件） | `renderer/layout/AppMenuBar.tsx:14` | **0**（全仓无 import；`preload.ts:17` 的 `inWindowMenuBar: false` 说明它是被关掉的内置菜单栏 UI 的残骸） |
| `useStreamTailGenerating`（11 行整文件） | `renderer/hooks/useStreamTailGenerating.ts:8` | **0**（唯一函数体就是 `{streamTailGenerating: uiRunning}` 的恒等包装） |
| `estimateSoftRangeForPreviewSelection` | `renderer/layout/preview-annotate.ts:302` | **0**（连测试都没有；文件头自述「保留给旧调用兼容」） |
| `refreshWorkspaceTrees` | `renderer/providers/ShellNavProvider.tsx:167/547/874/960` | **0**（context 上挂着、value 里塞着，标注 `@deprecated 使用 notifyWorkspaceMutated`，无任何消费方） |
| `shared/logic/chat.ts` 29 条再导出 | `shared/logic/chat.ts` | 101 条再导出中 29 条无生产消费（22 条全仓零引用：`AnnotateQuoteContext` / `FlatTextIndex` / `BuildAnnotatedSource*` / `offsetToSourceLineCol` / `splitSourceLines` / `wrapUserVfsActionsForStorage` 等；7 条 test-only：`ANNOTATE_SOFT_RANGE_*_PADDING` / `buildAnnotateAttachmentFromDraft` / `USER_VFS_TURN_ACK_TEXT` 等） |
| `shared/logic/format.ts` 2 条 | `shared/logic/format.ts` | `slidingTokenRate` / `SLIDING_TOKEN_RATE_WINDOW_MS` 零引用；`formatCharCount` / `formatStreamElapsed` test-only（`formatStreamElapsed` 是本文件头注释里专门说「desktop hook 不再保留本地副本」的那一个，现在只有测试在用） |
| `shared/logic/config-forms-agent.ts` 1 条 | — | `DEFAULT_WORKPLACE_ASSISTANT_TEXT` 零引用 |

barrel 宽再导出本身是 X1 门禁的设计后果（renderer 不能直连 core，只能过这一层），所以**不建议整体收窄 barrel**；但 22 条「全仓零引用」的可以安全摘。

**置信**：confirmed

---

### F-desktop-core-13 | P3 | apps/desktop/renderer/providers/ShellNavProvider.tsx:7-25

```
import {

  createContext,

  useCallback,

  useContext,
```

**描述**：文件被某种逐 token 换行格式化工具处理过——**每个 import 符、每个语句、每个对象成员、每个依赖项各占一行且行间空行**。1014 行的文件里约一半是空行与单 token 行，真实的逻辑密度不足 500 行。`ShellNavProvider` 是全 desktop 引用最广的 Provider（46 个 context 成员），这种格式让 diff 完全失去可读性：任何一行改动在 review 里都淹没在空白里。`apps/desktop` 有 `format:check` 脚本且 CI 里 Format 是 blocking（`ci.yml:54-55`），说明 prettier 配置与这个产物不自洽。

**建议**：跑一次 `npm run format -w @novel-master/desktop` 归一；若 prettier 不会合并，说明是编辑器插件的手工产物，加 `.prettierignore` 或在 AGENTS.md 记一条。

**置信**：confirmed

---

### F-desktop-core-14 | P3 | apps/desktop/renderer/layout/ChatRail.tsx:389-399

**描述**：`handleListMenuSelect` 的 `useCallback` 依赖数组里有 6 个**函数体内完全没用到**的符号（`loadProjects` / `projectId` / `goBackToProjects` / `loadSessions` / `sessionId` / `showNavView`）；`handleNamePromptConfirm`（313-321）同样多挂了 `projectName` / `openSession`。都是重构后残留——旧版本在这里做过删除+导航联动，后来挪进了 `handleConfirmAction`。无害（多余依赖只会多触发 memo 重算），但会让后续维护者误以为这些值被读。

顺带一条真问题：`<li role="button" tabIndex={0}>` 内部嵌 `<button className="chat-list__menu-btn">`（`ChatRail.tsx:551-557`），button 套在 role=button 里是无效嵌套（屏幕阅读器与键盘导航都会失灵）。

**建议**：删多余依赖；把菜单按钮移出 `<li>` 或把 `<li>` 改成 `<div>` + 内部独立可聚焦项。

**置信**：confirmed

---

### F-desktop-core-15 | P3 | apps/desktop/renderer/components/ui/toast-bus.ts:39

**描述**：模块级**单一** `hideTimer` + `emit` 全量广播。连续两次 `showToast`（间隔 < 3200ms）时第二次会 `clearTimeout` 掉第一次的定时器并**替换** toast 内容——第一条消息（含它的 `actionLabel` / `onAction` 回调）被静默吞掉，用户从未看到。`useAutoUpdateCheck.tsx:116-119` 的「发现新版本 + 查看按钮」正好是带 action 的 toast，最容易被后到的普通 toast（如保存成功）顶掉。

另一处：`emit` 遍历 `listeners` 时不复制集合，若某个 listener 在回调里 `subscribeToast`/`退订` 会改到正在遍历的 Set。JS 的 Set 迭代容忍增删，实际不会崩，但语义上是脆的。

**建议**：改成 toast 队列（最多堆 N 条，串行显示），或至少对「有 action 的 toast」加保护不被普通 toast 顶替。

**置信**：confirmed

---

### F-desktop-core-16 | P3 | apps/desktop/renderer/hooks/useColumnSplitters.ts:15

```js
const COLUMN_SPLITTER_SIZE = 0;
```

**描述**：splitter 宽度常量是 0，导致所有 splitter 相关算术成为 no-op：`getDefaultColumnWidths`（`total - 0*2`）、`getWorkspaceUsableWidth`、`clampColumnWidths` 的 `splitterCount` 项、两个 `if (vis.preview && vis.chat)` 分支里的 `tracks.push(\`${COLUMN_SPLITTER_SIZE}px\`)` 实际 push 的是 `"0px"`。`applyWorkspaceLayout` 里 col 索引仍会为 0px 的 splitter 分配一列，grid 里存在零宽轨道。

同时 `bindSplitter`（456-486）的 `onMouseDown` 内部往 `document` 注册 `mousemove` / `mouseup`，而 cleanup（485）**只解绑 `mousedown`**。若在拖拽中途该 effect 卸载（`layoutVisibility` 变化会触发 cleanup，见依赖数组 557），`document` 上的两个监听器泄漏且 `is-dragging` / `is-column-resizing` 两个 body class 永不移除（鼠标样式卡在 col-resize）。

**建议**：把 `document` 监听器的解绑也放进返回值；`COLUMN_SPLITTER_SIZE` 若确实是 0 就加注释说明「splitter 用 0px 轨道 + CSS 负 margin 实现」，否则核对是否本该是 4-8px。

**置信**：confirmed

---

### F-desktop-core-17 | P3 | apps/desktop/renderer/components/MermaidMarkdown.tsx:280

**描述**：三处小问题。

**(a) 每个 `MermaidMarkdown` 实例建一个 `MutationObserver`**（289-295）观察 `documentElement[data-theme]`。长会话里每条 assistant 消息一个实例 → 几十个 observer 常驻；主题切换时每个都触发一次全量重渲（进而每个都重跑 `scanMermaidFences` 与 react-markdown 解析）。

**(b) SVG 缓存无字节上限**：`SVG_CACHE_MAX = 150`（126）按条数限，但 mermaid 大图 SVG 可达数十 KB～数百 KB，150 条最坏可占几十 MB，且 `failedErrorCache` / `failedAtCache` 同步持有。注释说「防长会话内存只增不减」——条数封住了，字节没封住。

**(c) `resetMermaidCacheForTests`（272-277）清 `inflight` 时不取消在途 promise**：`resolveMermaidSvg` 的 `.then` 仍会在 reset 之后 `writeCacheKey(key, svg)` 重新填回缓存，测试间隔离不干净（跨用例污染的经典形态）。

`dangerouslySetInnerHTML`（385）注入的是 `mermaid.render` 的产物且 `securityLevel: "strict"`（217），风险可控，不单列。

**建议**：把 theme observer 提到一个模块级单例 + 订阅者列表；(b) 改成按累计字节数淘汰；(c) 给 `inflight` 加 generation token，reset 时 bump。

**置信**：confirmed

---

### F-desktop-core-18 | P3 | apps/desktop/renderer/providers/ThemeProvider.tsx:67

```js
const toggleMode = useCallback(async () => {
  await setMode(mode === "light" ? "dark" : "light");
}, [mode, setMode]);
```

**描述**：`toggleMode` 闭包捕获 `mode`，而 `setMode`（62-65）里 `await ipcAppUiSet(THEME_KEY, next)` 未 catch，且 `AppChrome.tsx:109` 用 `void toggleMode()` 调用。快速双击主题按钮时，两次调用读的是**同一个陈旧 `mode`**，第二次计算出与第一次相同的目标值 → 第二次点击被吞（视觉上「按了没反应」）。IPC 失败时则静默 unhandled rejection，主题已切换但**没落盘**，下次启动回退。

另：`skipRebootstrap` 那条同型问题在 `NovelMasterProvider.tsx:140`——`<button onClick={retry}>` 把 MouseEvent 当 `options` 传进 `(options?: {skipRebootstrap?: boolean})`，靠「MouseEvent 上没有这个属性所以读到 undefined」侥幸工作，类型上是错的。

**建议**：`toggleMode` 改用 `setModeState(prev => ...)` 的函数式更新 + 独立持久化；`retry` 包一层 `() => retry()`。

**置信**：confirmed

---

## 争议与存疑

1. **F-2 的 6 条消息通道是否真的可摘**。`MESSAGES_HIDE_RANGE` / `MESSAGES_SHOW_RANGE` / `MESSAGES_TRUNCATE_AFTER` 在 renderer 侧零消费，但按 `docs/apm/RULE.md:15-16`，隐藏/压缩区间与回滚都由 **core 侧服务**执行（`message-set-floor-range.ts` / `resolve-hide-message-range.ts` / `message-transcript-effects.service.ts`），不经过 desktop IPC。所以这三条**很可能是「设计上就不该由 UI 直接调」的正确分层**，而不是死代码——与 `PROJECTS_*_AGENT_CONFIG`（RULE 明写「已下线」）性质不同。**我不下结论，建议由 core-tool 机位或 reduce 阶段核实：core 侧是否另有等价方法、desktop 的 hide/show 批量 UI 走的是哪个通道**（ChatRail 里有批量删除，`tool-turn-actions.ts` 消费了 `ipcMessagesHide` / `ipcMessagesShow`，单条口在用、批量口在闲置，这个形态更像「批量 UI 尚未接线」而非「分层退役」）。

2. **F-7 的 520 行保留是否划算**。代码注释（`preview-annotate.ts:1-6, 51, 58`）明确标了 `@deprecated SPEC R5` 并说明「保留纯函数供单测与兼容」，按协议属 intentional。但仓库为守这条负向断言付出了 2 个专门测试文件 + 约 30 条用例。**取舍是产品/迭代决策不是代码缺陷**，我按 intentional 记录并把成本量化，供主代理判断是否值得发起一次清理迭代。

3. **preload「通用 on()」条目**。派单提示提到 RULE 有该条目，但我在 `docs/apm/RULE.md` 全文（113 行）中**未检索到**名为「preload 通用 on()」的条目；`docs/Iterations/` 与 `docs/apm/` 下也只匹配到 W1 报告 `raw/w1-desktop-main.md`。我按代码本身判断：`preload.ts:33-59` 的 `WeakMap<callback, listener>` 设计是正确且有注释交代动机的（`off()` 必须能反查同一个 wrapper，否则 `removeListener` 永不命中），唯一边角风险是「同一 callback 订阅两个 channel 时，任一 disposer 会 `delete` 掉 WeakMap 条目，导致另一条 `off()` 找不到 listener 而泄漏」——当前 renderer 侧无人调用 `off()`（实测 0 引用），所以不构成现实缺陷。**若 W1 报告里那条 RULE 另有约定，请以那份为准，我这条只按代码陈述。**

4. **子会话双面板常驻的内存代价**。`ChatRail.tsx:666-726` 的父/子两个 `ConversationPanel` 用 `hidden` 属性切换而**不卸载**（`ChatRail.tsx:74-79` 注释称「Bug 2 keep-alive」为有意设计）。代价是两个面板各自持有一条 `useAgentStream` 订阅、一套 transcript 拉取与 RAF batch 缓冲。RULE 与代码注释都表明这是为了保住 `streamingText` local state 的刻意选择，**我标 intentional 不报**，但如果 W3 的「缓存失效生命周期」机位在量内存，这里会是一个数据点。

5. **ShellNavProvider 的 workspaceMutated 旁路订阅**。`ShellNavProvider.tsx:330-349` 绕过 `useAgentStream` 守卫直接监听 `STEP_COMMITTED` / `RUN_FINISHED` 刷文件树。这正是 `docs/apm/RULE.md:41` 写明的设计，**标 intentional**。唯一可提的实现细节：它只按 `projectId` 匹配（session scope 不比对 sessionId），意味着**同项目下任意会话的子 agent 写入都会触发当前面板的文件树刷新**——100ms 防抖（`ShellNavProvider.tsx:193`）兜住了抖动，代价是跨会话的无关刷新。属可接受取舍，记录备查。

## 附：本区扫描脚本

脚本落在 `tmp/`（已 `.gitignore`），供其他机位复用：
`tmp/w2-recon.mjs`（invoke-registry ↔ 消费方对账）、`tmp/w2-x1.mjs`（renderer 直连 core 扫描）、`tmp/w2-reexport.mjs` + `tmp/w2-reexp-all.mjs`（barrel 死再导出）、`tmp/w2-dead.mjs`（符号引用计数）、`tmp/w2-list.mjs`（文件/行数清单）。
