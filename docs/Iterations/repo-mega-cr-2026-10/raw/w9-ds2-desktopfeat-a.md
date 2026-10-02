---
zone: w9-ds2-desktopfeat-a
agent: domain-survey / 独立双扫 A
files_scanned: 77（apps/desktop/renderer/features/** 全量，18361 行，含逐行阅读 + 消费方 grep 核实）
scope: apps/desktop/renderer/features/ 全量测绘（chat / settings / skills / workspace 四个子域）
method: 逐文件读源码 + git grep 核实每个导出符号的消费方 + 追 main/core 侧实现确认行为
independence: 未读取 raw/ 与 synth/ 下任何文件
branch: feat/repo-mega-cr @ worktree D:\Dev\nm-worktree\mcr
date: 2026-10-01
---

## 摘要

desktop renderer 的四个业务面：聊天（会话面板、composer、消息操作、回滚、指标）、设置（工作区/智能体/服务商/搜索/智能排序/技能/统计/备份）、技能（新建/编辑/选择器）、工作区（VFS 树、拖放、目录规则、文件纳入）。全部是「React 组件 + 纯函数逻辑」双层结构：`.tsx` 视图负责渲染与 IPC 编排，`.ts` 模块承载可直测的纯逻辑，多数薄模块是 `@shared/logic/*`（转发 core `public/*`）的二次 re-export。共 77 文件 18361 行，其中约 1218 行（6.6%）在本仓内无任何消费方。

## 职责与边界

- **chat/（37 文件）**：会话主面板 `ConversationPanel` 编排一切——`useAgentStream` 订阅 agent 事件、run 生命周期守卫（uiRunning / freezeCount / abortRetain）、消息列表 reload、消息右键菜单（编辑/复制/置位/分叉/回滚）、composer 草稿水化与持久化、指标条与用量详情弹窗。`ChatComposer` 管输入框、`@路径`/`$技能` typeahead、发送门闩与 annotate chip。`conversation-batch.ts` 给 `useAgentStream` 提供 RAF 合并 sink。回滚语义（undo_send / rewind）、置位、abort-retain 三条生命周期各有独立纯函数模块 + 单测。
- **settings/（25 文件）**：设置栈的各视图。`SettingsViews.tsx` 一个文件里塞了 7 个视图（备份恢复、智能体列表、服务商列表/表单/详情、智能排序列表/编辑器）。导航栈语义（`settings-nav.ts`：SETTINGS_NAV、dirty 守卫）纯函数化。
- **skills/（4 文件）**：`skill-ui.ts` 是域徽标/命名校验/key 编解码/跨组件事件的总入口；新建、编辑信息、选择器三个弹窗。
- **workspace/（11 文件）**：`WorkspaceTree` 渲染三域拼接的文件树 + 内建拖放（自定义 MIME 树内移动 / 原生 startDrag 拖出 / 外部文件批量 ingest）；`workspace-batch-dnd.ts` 用**模块级全局变量**保存拖拽物化态；`workspace-actions.ts` 是 VFS 写操作的唯一入口。

**边界**（本区不做）：IPC 通道定义与 handler（`renderer/ipc/*`、`src/main/ipc/*`）、状态容器（`providers/ShellNavProvider`、`layout/*`）、通用 UI 原子（`components/ui/*`）都在区外；领域规则单源在 `packages/core/src/domain/**` 与 `apps/desktop/shared/logic/*`。

## 对外接口（导出符号）

**被区外消费的（真实接口面）**

| 符号 | 位置 | 消费方 |
|---|---|---|
| `ConversationPanel` | chat/ConversationPanel.tsx:111 | `layout/ChatRail.tsx` |
| `runCompaction` | chat/ConversationPanel.tsx:1106 | `chat/SessionDetailDrawer.tsx:61` |
| `resolveChatLinkAction` 等 | chat/chat-link-route.ts:54 | `providers/ShellNavProvider.tsx` |
| `syncPreviewTabsWithFileRows` / `markPreviewTabsDeletedUnderPathInList` | workspace/preview-tab-sync.ts:10/42 | `providers/ShellNavProvider.tsx` |
| `WorkspaceTree` | workspace/WorkspaceTree.tsx:58 | `layout/ExplorerPane.tsx` |
| `workspaceMenuItems` / `zipImportConfirmMessage` / `parentPathForTarget` | workspace/workspace-context.ts | `layout/ExplorerPane.tsx` |
| `workspace-actions` 全部（create/rename/delete/saveFileInclusion/loadDirRuleForm/saveDirRule/setDirRuleEnabled/defaultDirRuleRequest/emptyDirRuleForm/entryLabelForTarget） | workspace/workspace-actions.ts | 同目录两个 Modal + ExplorerPane |
| `vfs-tree-dnd` 全部 + `NM_VFS_PATHS_MIME` | workspace/vfs-tree-dnd.ts | WorkspaceTree / workspace-batch-dnd / 测试 |
| `workspace-batch-dnd` 全部 | workspace/workspace-batch-dnd.ts | WorkspaceTree / ExplorerPane |
| `vfs-tree-utils` 全部 | workspace/vfs-tree-utils.ts | WorkspaceTree / FileReferencePicker / 测试 |
| `skill-ui` 全部（skillDomainLabel/buildNewSkillDoc/isValidSkillNameInput/toSkillRef/skillKey/parseSkillKey/dispatchOpenSettingsView/OPEN_SETTINGS_VIEW_EVENT） | skills/skill-ui.ts | chat 4 文件 + settings 2 文件 + skills 2 文件 |
| `NewSkillModal` / `SkillInfoEditModal` / `SkillPicker` | skills/ | SessionSkillPanel / SkillsManageView / ChatComposer |
| `SettingsViews` 7 个视图 + `AgentEditorView` / `ModelSamplingView` 重导出 | settings/SettingsViews.tsx:2-5 | `layout/SettingsOverlay.tsx:15,209` 等 |
| `SkillsManageView` / `SkillDetailView` / `WorkspaceSettingsView` / `TokenUsageStatsView` / `SearchEnginesView` / `SearchEngineDetailView` / `AboutView` / `SettingsPanel` 等 15 个 UI 原语 | settings/ | SettingsOverlay + 同目录视图 |
| `SETTINGS_NAV` / `shouldGuardSettingsNav` / `isSameSkillRef` / `SettingsNavHandle` / `SettingsNavState` / `SettingsViewId` | settings/settings-nav.ts | `layout/SettingsOverlay.tsx` |
| `ENGINE_META` / `isEngineId` / `isKeyEngineId` / `engineLabel` | settings/search-engine-meta.ts | 两个搜索视图 |
| `MIGRATION_ROWS` / `migrationRowValue` | settings/migration-row-value.ts | SettingsViews + 测试 |
| `message-blocks` 全部（`buildChatListItems` / `toolCallViewFromUse` / `toolCallSummary` / `vfsToolFilePath` / `skillToolRef` / `resolveToolResultsMessageId` / `messageHasToolUse`） | chat/message-blocks.ts | MessageList / ToolCallCard / tool-turn-actions / 测试 |
| `chat-annotate-draft` 全部 | chat/chat-annotate-draft.ts | ChatComposer / ConversationPanel / rollback-annotate-restore |
| `shouldGuardSettingsNav` 的两个 re-export 类型等 | settings/settings-nav.ts | 同上 |

**区内自消费但对外无消费方（死导出，见发现 F-w9-ds2-9）**

`AgentDefinitionEditorForm`（整文件）、`useTreeLoader` / `useTreeRefreshToken` / `usePreviewSelection`（整文件 `useWorkspaceTree.ts`）、`buildTailBatchRows` / `MessageBatchMode`（整文件 `transcript-selectable-role.ts`）、`hideToolTurn` / `deleteToolTurn`（整文件 `tool-turn-actions.ts`）、`resolveComposerTextAfterRollbackSuccess`（标 `@deprecated`）、`usePickerData`、`ToolCallCard.showFullParams` prop、`MessageList.streamTailGenerating` prop。

## 数据访问

本区**不直接触碰任何表**。所有持久化经 `@/ipc/client` 的 `ipc*` 封装走 main → core。本区能看到的「数据域」只有以下几类（均为 DTO，经 IPC）：

| 域 | 触点 | 证据 |
|---|---|---|
| 会话消息（读/搜索/编辑/回滚/置位/分叉/隐藏/删除/追加） | `ipcMessagesList/Search/Edit/Rollback/SetFloor/Fork/Hide/Show/Delete/TruncateAfter/Append` | chat/ConversationPanel.tsx:27-40；chat/tool-turn-actions.ts:5-9；chat/conversation-abort-retain.ts:6 |
| Composer 草稿 | `ipcSessionsGetComposerDraft` / `ipcSessionsSetComposerDraft`（仅正文 + `@路径`，附件恒空） | chat/ConversationPanel.tsx:322-361 |
| 工作区模板同步 | `ipcSessionsPullTemplate` / `ipcSessionsPushTemplate` | workspace/WorkspaceHeaderActions.tsx:7,41,59 |
| VFS 读写（global/project/session/meta 四域 + physical 只读） | `vfsScope(scope, projectId, sessionId)` + `ipcVfs*` | chat/FileReferencePicker.tsx:66；workspace/workspace-actions.ts:43 |
| 目录规则 / 文件纳入 | `ipcWorkplaceGet/SetDirRule` / `ipcWorkplaceSetFileRule` / `ipcWorkplaceBuildListRows` | workspace/workspace-actions.ts:55-226；chat/FileReferencePicker.tsx:65 |
| 技能 | `ipcSkillsList/Effective/Read/Write/UpdateInfo/Toggle/AssertCreateName` + `ipcVfsZipImportBytes` | skills/*.tsx |
| 智能体注册表 | `ipcAgentRegistryList/Get/Upsert/Delete/CreateBlank/ResolveCurrent/SetCurrent` + `ipcAgentYaml{Export,Import}` | settings/SettingsViews.tsx:705-855；settings/AgentEditorView.tsx:702,1368 |
| Provider / 模型 / 采样 | `ipcProviders*` / `ipcProviderModels*` | settings/SettingsViews.tsx:1035-1502 |
| 智能排序规则 | `ipcSmartSortRule*`（16 个通道） | settings/SettingsViews.tsx:1703-2344 |
| 搜索引擎配置 | `ipcSearchGetConfig` / `ipcSearchSetEngineOrder` | settings/SearchEnginesView.tsx:12 |
| Token 用量统计 | `ipcUsageStatsQuery({kind: summary/daily/modelBreakdown/listModels/hourly/requests/sessionDetail})` | settings/TokenUsageStatsView.tsx:431-583；chat/MetricsDetailPopover.tsx:57 |
| 云同步 / 备份 / 维护 | `ipcCloudSync*` / `ipcBackup{Export,Import}` / `ipcDbStats` / `ipcDbMaintenance` | settings/SettingsViews.tsx:174-405 |
| 偏好 | `ipcPreferences{Get,Set}LlmStream/SubagentStream/ThinkingContext`、`ipcAppUiGet/Set`、`ipcCompactionConditions{Get,Set}` | settings/WorkspaceSettingsView.tsx:2-18 |
| 会话元信息（agent/model 绑定、上下文 token） | `ipcPromptAgentMeta` / `ipcPromptChatTokenLabel` / `ipcSessionsSetAgentBinding` / `ipcSessionsSetModelOverride` | chat/SessionDetailDrawer.tsx:44-51；chat/ChatComposer.tsx:11 |
| agent 流事件（订阅） | `onAgentStream` / `onUserMessageAppended` / `onComposerAttachmentsSuggest` / `onPromptChatTokenUpdated` / `onVfsStartDragFailed` | chat/ChatComposer.tsx:17-18；chat/SessionDetailDrawer.tsx:51 |

**内存态（非持久，但跨组件）**：
- `workspace-batch-dnd.ts:38-46` 五个模块级单例：`activeNativeDrag` / `stagedByPath` / `failedStagePaths` / `prefetchInFlight` / `prefetchGeneration` + `startDragFailedUnsub`。
- `skills/skill-ui.ts:88` `OPEN_SETTINGS_VIEW_EVENT` 走 `window.CustomEvent` 做跨组件跳转（ToolCallCard / SessionSkillPanel → App → SettingsOverlay）。
- `window.CustomEvent` 三条业务通道：`session-compacted`（ConversationPanel:1124 ↔ :289）、`messages-rollback`（:753 ↔ SessionDetailDrawer:189）、`context-changed`（:890/:1129 ↔ SessionDetailDrawer:225）。
- `chat-annotate-draft` 进程内批注草稿 store（与 main 侧各自独立，见 `rollback-annotate-restore.ts:36-37` 注释）。

## 依赖关系

**区内依赖图**

```
chat/  → chat-annotate-draft, composer-at-path(→@shared/logic/chat), message-blocks,
         composer-send-state, message-edit, rollback-composer, rollback-annotate-restore,
         conversation-abort-retain(→flush-run-ui), tool-turn-actions, transcript-selectable-role(死),
         workspace/vfs-tree-utils(仅 FileReferencePicker)
skills/ → skill-ui
workspace/ → vfs-tree-utils, vfs-tree-dnd, workspace-context, workspace-actions, workspace-batch-dnd
settings/ → settings-ui, settings-nav, prompt-macro-input, search-engine-meta,
            migration-row-value, skills/*, workspace/workspace-actions(DirectoryRuleModal, FileInclusionModal),
            chat/tool-turn-actions(无)
```

**出区 import（唯一收敛口）**

- `@/ipc/client`（本区唯一数据出入口，192 处 `ipcXxx()` 调用）
- `@/providers/ShellNavProvider`（ChatComposer / ConversationPanel / SessionDetailDrawer / SessionSkillPanel / WorkspaceTree / WorkspaceHeaderActions / SettingsViews）
- `@shared/logic/*`（chat / agent / prompt / config-forms-agent / provider / search-engines / workplace / vfs / skills / format-token-count / hit-rate / usage-stats-format / events / root / smart-sort / config-forms-stored-config-validity）——**均为 core `public/*` 的二次转发**，本区几乎没有本地领域逻辑
- `@novel-master/core/chat`（chat-link-route）、`@novel-master/core/events`（2 处 type-only）
- `@/components/ui/*`（20 个原子）、`@/hooks/*`（12 个）、`@/utils/*`（6 个）、`@/layout/*`（0 个，反向依赖）

**被谁消费**：`apps/desktop/renderer/App.tsx`、`layout/{ChatRail,ExplorerPane,MainShell,PreviewPane,PreviewAnnotateUi,SettingsOverlay,preview-utils}.tsx`、`providers/ShellNavProvider.tsx`、`hooks/{useAgentStream,useChatMessagesScrollFollow}.ts` + **41 个测试文件**。

**测试覆盖**（`apps/desktop/test/**` 引用 features 的 41 个文件）覆盖了绝大多数纯逻辑模块：message-blocks、composer-at-path、rollback-composer、rollback-annotate-restore、conversation-abort-retain、flush-run-ui、read-only-run-probe、prompt-macro-input、settings-nav-guard、migration-row-value、vfs-tree-utils、vfs-tree-dnd-move、workspace-actions、preview-tab-sync、chat-link-route、composer-body-clear、skill-zip-import、skills-manage-export-menu、token-usage-stats-view、tool-policy-picker、metrics-detail-popover、message-list-stream、chat-composer.integration 等。**未覆盖**：ConversationPanel 的主流程（仅 abort 路径有测试）、WorkspaceTree 组件本体、AgentEditorView（仅有一个源码文本断言测试 `settings-agents-tabs.test.ts`）、SessionDetailDrawer。

## 发现清单

### F-w9-ds2-1 | P1 | features/settings/AgentEditorView.tsx:630,687
```tsx
const dirty = savedBaseline != null && snapshot !== savedBaseline;
...
desc={isBuiltin ? "..." : `编辑 ${displayName}${dirty ? " · 未保存" : ""}`}
```
**描述**：`AgentEditorView` 算出了 dirty 并在标题上显示「· 未保存」，但**从不写 `nav.dirtyViews`**。而设置栈的导航守卫（`settings-nav.ts:158 shouldGuardSettingsNav`）读的正是这个集合，`SettingsOverlay.tsx:78` 用 `dirtyViewsRef` 持有它。全仓 `git grep -F dirtyViews -- apps/desktop/renderer` 显示**唯一写入方是 `SkillDetailView.tsx:140-149`**。也就是说：智能体编辑页是设置里字段最多、改动代价最高的表单，却是唯一没接入 dirty 通道的表单——用户改完 prompt 点返回/点别的菜单项，弹不出「未保存的更改」确认，编辑内容随组件卸载静默丢失。
**建议**：照抄 SkillDetailView 的模式，在 AgentEditorView 里加 `useEffect(() => { dirty ? nav.dirtyViews.add("agentEditor") : nav.dirtyViews.delete("agentEditor"); return () => nav.dirtyViews.delete("agentEditor"); }, [dirty, nav])`。
**置信**：confirmed（两侧 grep 均已实测）

### F-w9-ds2-2 | P1 | features/settings/WorkspaceSettingsView.tsx:164-171, 250-254
```tsx
const scheduleCompactionSave = useCallback(() => {
  if (compactionSaveTimer.current != null) clearTimeout(compactionSaveTimer.current);
  compactionSaveTimer.current = setTimeout(() => { void saveCompaction(); }, 600);
}, [saveCompaction]);   // saveCompaction 依赖 compactionTokenRatio / compactionHideStartDepth
...
onChange={(e) => { setCompactionHideStartDepth(e.target.value); scheduleCompactionSave(); }}
```
**描述**：`onChange` 里 `setState` 是异步的，而紧接着调用的 `scheduleCompactionSave` 是**当前这一帧**闭包里的版本，它捕获的 `saveCompaction` 持有的是**本次按键之前**的 `compactionTokenRatio` / `compactionHideStartDepth`。600ms 后定时器触发，落库的是上一次的值。用户把「0.8」改成「0.85」松手，存下去的还是 0.8；输入框显示 0.85、库里是 0.8，下进设置页又跳回 0.8——「静默丢最后一次输入」。
**建议**：定时器里读 ref 兜底最新值（`latestRef.current` 在 render 期同步赋值），或改 `scheduleCompactionSave(next)` 把新值显式传进 `saveCompaction`。
**置信**：confirmed

### F-w9-ds2-3 | P1 | features/chat/ChatComposer.tsx:189-193 · features/chat/FileReferencePicker.tsx:65-67
```tsx
// ChatComposer.tsx
const result = await ipcWorkplaceBuildListRows(vfsScope("session", projectId, sessionId));
// FileReferencePicker.tsx
const result = await ipcWorkplaceBuildListRows(vfsScope('session', projectId, sessionId));
```
**描述**：desktop 的 `workspaceScope:'session'` 经 main 侧 `resolve-vfs-scope.ts:30-34` 映射为 core **`{kind:"project"}`（项目工作区）**，而 `'chat'` 才映射为 `{kind:"session"}`（会话工作区）。但 core 侧 `@path` 附件的 hydrate 走 `toolCtx.vfs`，按 `run-agent-turn.ts:1036` 注释即 `runtime.sessionVfs(projectId, parentSessionId)` = **core session 域（会话工作区）**。于是：composer 的 `@` 候选与「引用文件」弹窗列出的是**项目工作区**的文件，正文里 `@路径` 却被从**会话工作区**读取——会话工作区（左侧面板默认的「聊天工作区」tab，用户新建会话后写的东西）里的文件根本没法从 composer 引用。对照 mobile：`FileReferencePicker.tsx:87-96 resolveWorkplaceScope` 返回 `{kind:'session', projectId, sessionId}`，与 core 读取侧一致。两侧行为不一致。
**建议**：确认产品意图后统一。若与 mobile 对齐，改 `vfsScope("chat", projectId, sessionId)`；若确实要引用项目工作区模板，则须在 core hydrate 侧支持双域查找，并把 `nav-workspace.ts:27` 里 `session: "会话工作区"` 的标题一并改掉（现标题与实际 scope 相反，见 F-w9-ds2-19）。
**置信**：suspected（代码链路已逐段核实到 core；仍需产品确认「desktop 是否刻意只让引用项目模板」）

### F-w9-ds2-4 | P2 | features/workspace/WorkspaceTree.tsx:96-106
```tsx
if (result.ok) {
  setRows(result.data);
  onRowsLoaded?.(result.data);
  setExpandedDirs(new Set(result.data.filter((row) => row.kind === "dir").map((row) => row.path)));
}
```
**描述**：`reload()` 每次成功都把 `expandedDirs` **整体重置为「所有目录都展开」**。而 `reload` 的触发源有：effect 依赖 `refreshToken`（:112-114）、`notifyWorkspaceMutated()` 触发的父层刷新、以及 `onMutated` 回调。所以用户手动折叠的目录，在任何一次 VFS 变更（agent 写文件、新建、重命名、拖动）之后都会被强制展开，长会话里目录树层级完全丢失。
**建议**：拆分 `setExpandedDirs` 为「首次加载全展开」与「后续 reload 只增不减」两条路径（用 ref 记住是否已初始化，或 `setExpandedDirs(prev => new Set([...prev, ...dirPaths]))`）。
**置信**：confirmed

### F-w9-ds2-5 | P2 | features/chat/ConversationPanel.tsx:757-773
```tsx
setComposerText(prevText => {
  const next = resolveComposerDraftAfterRollbackSuccess(...);
  setComposerAttachments(applyUndoAnnotateRestore(...));   // ← updater 内调 setState + 写模块级 store
  return next.text;
});
```
**描述**：三处问题叠在一起：(a) `setState` updater 必须是纯函数，这里在 updater 内再调 `setComposerAttachments`；(b) `applyUndoAnnotateRestore` 内部会 `addChatAnnotateDraft(sessionId, draft)` **写模块级进程内 store 并 mint 新 id**（`rollback-annotate-restore.ts:58-60`），是有副作用的非幂等操作；(c) React 18 StrictMode / 并发渲染会**重复调用 updater**，结果是同一条回滚把批注草稿恢复两份（新 id 各不相同），且 updater 返回值可能被丢弃。附带问题：`executeRollback` 的 `useCallback` 依赖数组（:778）漏了 `composerAttachments`/`composerText` 相关的所有引用，实际是靠 updater 形式规避——本身说明这条链的状态耦合已经很脆。
**建议**：把 draft 解析与 annotate 反投影提到 updater 之外先算好，再一次性 `setComposerText(x); setComposerAttachments(y);`。
**置信**：confirmed

### F-w9-ds2-6 | P2 | features/chat/SessionDetailDrawer.tsx:621-631, 639-649
```tsx
void ipcSessionsSetAgentBinding({ sessionId, agentId }).then(() => {
  void reload(); notifyAgentConfigChanged();
});
```
**描述**：`IpcResult` 的 `ok` 分支被完全忽略。绑定失败（agentId 不存在 / agent 被并发删除 / DB 写失败）时，抽屉照样 reload 并提示一切正常，用户以为换成功了，直到发消息才发现 agent 没换。同时 `.then` 无 `.catch`，bridge 异常直接变成未处理 rejection。
**建议**：`const res = await ipc...; if (!res.ok) { showToast(res.error.message); return; } …`，并补 `.catch`。
**置信**：confirmed

### F-w9-ds2-7 | P2 | features/settings/SettingsViews.tsx:851-855
```tsx
const def = getRes.data.value;
await ipcAgentRegistryUpsert({ agentId: prompt.agentId, definition: { ...def, name } });
await reload();
```
**描述**：upsert 的结果被丢弃。`validateAgentDefinition` 校验失败（重名、空名、超长）时 upsert 返回 `ok:false`，代码照旧 reload，列表里名字没变、**没有任何 toast**——用户以为改名成功。同文件的 `handleAgentMenuSelect` 里 duplicate 分支（:773-781）也有相同形状的问题。
**建议**：统一检查 `res.ok`，失败走 `toastSettingsError`。
**置信**：confirmed

### F-w9-ds2-8 | P2 | features/settings/SettingsViews.tsx:793-820
```tsx
for (const agentId of agentIds) {
  const res = await ipcAgentRegistryDelete({ agentId });
  if (!res.ok) { toastSettingsError(res.error.message); return; }   // ← 中途 return
}
...
await reload();   // 永远走不到
```
**描述**：批量删除智能体时第 k 个失败，前 k-1 个**已经真删了**，但代码 `return` 掉：不 reload（列表留着已删行的幽灵）、不提示「已删 N 个」、`batch.exit()` 不执行（批量模式卡住）。用户看到的只是一个错误 toast，实际数据已部分变更。
**建议**：记录成功数，失败后仍走 reload + 「已删除 N 个，M 个失败」提示，再 `batch.exit()`。
**置信**：confirmed

### F-w9-ds2-9 | P2 | 全区（多文件）— 约 1218 行死代码
| 死对象 | 行数 | 核实方式 |
|---|---|---|
| `settings/AgentDefinitionEditorForm.tsx`（整文件，与 AgentEditorView 是同一份智能体表单的另一实现） | 1048 | `git grep -F AgentDefinitionEditorForm -- apps packages` 只命中自身 4 处 |
| `workspace/useWorkspaceTree.ts`（`useTreeLoader`/`useTreeRefreshToken`/`usePreviewSelection`） | 67 | 全仓无 import |
| `chat/transcript-selectable-role.ts`（12 个 core 符号的 re-export + `buildTailBatchRows` + `MessageBatchMode`） | 48 | 全仓无 import |
| `chat/tool-turn-actions.ts`（`hideToolTurn`/`deleteToolTurn`） | 55 | desktop 无 import；mobile 有自己的同名实现且有测试 |
| `settings/WorkspaceSettingsView.tsx:315 usePickerData` | 11 | 全仓无 import |
| `chat/rollback-composer.ts:35 resolveComposerTextAfterRollbackSuccess`（已标 `@deprecated`） | 11 | 全仓无 import |

**描述**：desktop 侧有 ~1218 行（占本区 6.6%）没有任何消费方。其中 `AgentDefinitionEditorForm` 最危险——它与在用的 `AgentEditorView` 是同一张表单的两份实现（都 import 同一批 `config-forms-agent` helper、同一套 `AgentWorkplaceBlockCard`/`ToolPolicyPicker`/`PromptMacroTextarea`），一旦有人「修好」死的那份，实际页面不会有任何变化。`useTreeLoader` 还带着 `deps: unknown[]` + eslint-disable 的陈旧用法。
**建议**：删掉或明确标注（若是为 mobile/未来预留，请移到 `_unused/` 或写明原因）；`AgentDefinitionEditorForm` 若确认为 `AgentEditorView` 的前身，应在文件头写明「已被 AgentEditorView 取代，见 <commit>」以免后人误改。
**置信**：confirmed

### F-w9-ds2-10 | P2 | features/workspace/WorkspaceTree.tsx:197-207 + workspace-batch-dnd.ts:61-68
```tsx
onPointerDown={(e) => handleRowPointerDown(e, row)}   // 每一行每一次按下
...
void prefetchExportStage({ scope: req, logicalPath: row.path });
```
**描述**：`prefetchExportStage` 在**任何** pointerdown 时触发（单击选中、右键、拖动起点都一样），它会走 `ipcVfsBatchExportStage` 让 main 侧把该条目**物化到临时目录**。而释放路径只有两条：下次同路径 pointerdown（:170 `releaseStagedExport`）或 dragEnd（:71 `finalizeRowDrag`）。用户只是点了一下文件就移开鼠标 → main 侧临时目录 + renderer 的 `stagedByPath` 条目双双悬挂，直到下次碰同一行。反复浏览目录树 = 每个碰过的路径一份物化副本。另有 `prefetchGeneration`（:45）这个 `Map<string, number>` 只增不删，长会话内单调增长。
**建议**：① 监听 window `pointerup`/`pointercancel`，若本次没有发生 dragstart 则 `releaseStagedExport(row.path)`；② `finalizeRowDrag` 里 `prefetchGeneration.delete(logicalPath)`。
**置信**：confirmed

### F-w9-ds2-11 | P2 | features/skills/NewSkillModal.tsx:65-76, 130-212
```tsx
useEffect(() => { if (open) { setName(""); ... setImported(null); } }, [open, defaultDomain, defaultProjectId, projects]);
...
try { ... } finally { setSaving(false); }   // 无 catch
```
**描述**：两个问题。(a) `projects` 是数组 prop 且进了 effect 依赖：只要父层在弹窗打开期间换了 `projects` 的引用（两个调用方 `SessionSkillPanel.tsx:55 setProjects([...res.data])` 与 `SkillsManageView.tsx:105 setProjects(projectList)` 都在异步里 setState），表单会被**静默重置**（名字、描述、已导入的 ZIP 全丢）。当前两个调用方的 `projects` 都来自 `useState`、只在挂载时 set 一次，所以暂未触发——但这是一颗埋着的雷。(b) `handleConfirm` 只有 `try/finally` 没有 `catch`，`ipcSkillsList` / `ipcSkillsWrite` 抛错（bridge 断连）时是未处理 rejection，弹窗既不报错也不复位。同目录 `SkillInfoEditModal.tsx:93` 有 catch，两处不一致。
**建议**：依赖改成 `projects.length` 或在 `open` 从 false→true 的那次跑（用 prev 开关）；补 catch。
**置信**：confirmed（a 为潜在，b 为现状）

### F-w9-ds2-12 | P2 | features/skills/SkillPicker.tsx:32-52 + features/chat/RealPromptPanel.tsx:56-67
```tsx
const load = useCallback(async () => {
  setLoading(true);
  const res = await ipcSkillsEffective({ projectId });   // 无 try
  setLoading(false); ...
```
**描述**：两处 `load` 都无 try/catch 且由 `void load()` 驱动。`invoke-registry.ts:143 withReq` 只是 `invoke(channel, req)` 的透传，而 `client.ts:17-29 bridge()` 在 preload 未加载时会**同步 throw**（`throw new Error('novelMasterDesktop preload bridge is unavailable…')`），promise 被 reject → `setLoading(false)` 永不执行 → 弹窗永久停在「加载中…」，控制台一条 unhandled rejection。全区共 21 处 `.then(` 形态的 ipc 调用缺 `.catch`（清单见下）。
**建议**：统一包一层 `safeInvoke` 或至少在 `load` 内 try/catch/finally。
**置信**：confirmed（bridge throw 路径已读源码确认）

### F-w9-ds2-13 | P2 | features/settings/SettingsViews.tsx:220-229
```tsx
const timer = window.setInterval(() => { void reloadStatus(); void reloadDbStats(); }, 2000);
```
**描述**：「备份与恢复」页挂载期间每 2 秒两次 IPC，其中 `ipcDbStats` 会真去统计库体积/表行数（main 侧读 sqlite），而 `reloadDbStats` 只在第一次用得上（渲染三个迁移状态行）。页面开着不动就一直烧；窗口切到别的设置页或最小化也不停（无 `document.visibilitychange` 判断）。
**建议**：迁移三行状态改成「首次 + 操作后刷新」，或至少把间隔提到 10s 并在 `document.hidden` 时跳过。
**置信**：confirmed

### F-w9-ds2-14 | P2 | features/chat/message-blocks.ts:100-140, 257-265
```tsx
function lastIncompleteToolAssistant(messages) { for (const m of messages) { ... turnToolResultsComplete(m, messages) ... } }
// turnToolResultsComplete → buildToolResultByUseId(messages)  // 全量扫一遍
```
**描述**：`buildChatListItems` 对每条含 tool_use 的消息调 `resolveUnpairedToolStatus` → `isTurnToolExecuting` → `lastIncompleteToolAssistant`（再遍历全量消息，每条又建一次 `buildToolResultByUseId` Map）。整体 O(n² · blocks)。`buildChatListItems` 在 `MessageList.tsx:137` 每次渲染调用，而流式期渲染频率跟 delta 走（虽然有 `conversation-batch.ts` 的 RAF 合并兜底）。几百条消息的会话切换/展开即明显卡顿。
**建议**：在 `buildChatListItems` 开头建一次 toolUse→result 的 Map 与「最后一条未完成 assistant 的 id」，往下传。
**置信**：confirmed（复杂度可静态推出，未在真机 profile）

### F-w9-ds2-15 | P3 | features/chat/message-blocks.ts:297-299
```tsx
if (hasToolResult && textParts.length === 0 && thinkingParts.length === 0) { continue; }
```
**描述**：tool_result 独占的 user 消息被整条跳过——这是对的（工具卡片挂在 assistant 消息上）。但这个 `continue` 发生在 :314 的 `attachments?.length > 0` 判定**之前**，所以「带 tool_result 又带 attachments（批注 chip）」的 user 消息会被连附件一起丢掉。user_ops 链路已拆除后这条路径很难自然触发，但 annotate 附件仍挂在 user 消息上，属于结构顺序隐患。
**建议**：把 `continue` 改成「跳过但先把 attachments 挂到相邻 assistant 项」，或至少加注释钉住「tool_result 消息恒无附件」这一前提。
**置信**：suspected

### F-w9-ds2-16 | P3 | features/chat/MessageList.tsx:113, 238-240
```tsx
streamTailGenerating: _streamTailGenerating = false,   // 解构后从不使用
...
{uiRunning ? (<p className="chat-message__stream-tail">生成中</p>) : null}
```
**描述**：`ConversationPanel.tsx:999` 认真地往下传 `streamTailGenerating={running}`，`useStreamTailGenerating.ts:9` 更是恒等函数 `return { streamTailGenerating: uiRunning }`，但 `MessageList` 收下就丢（改名前缀 `_`），真正决定「生成中」角标的是 `uiRunning`。三个来源表达同一件事，其中两个是死线。
**建议**：要么删掉这个 prop 与 `useStreamTailGenerating`，要么让角标改读 `streamTailGenerating`（这是 mobile 侧同名 prop 的对齐物，删之前先确认双端 parity 是否有意保留）。
**置信**：confirmed

### F-w9-ds2-17 | P3 | features/chat/ToolCallCard.tsx:12, 55
```tsx
showFullParams?: boolean;
const detail = showFullParams ? JSON.stringify(tool.input, null, 2) : summary;
```
**描述**：`ToolCallGroupCard.tsx:29-36` 渲染卡片时从不传 `showFullParams`，全仓（含 mobile `ToolCallCard.tsx:58,76` 同样形态）没有任何一处把它置 true。完整 JSON 入参展示能力是死的。
**置信**：confirmed

### F-w9-ds2-18 | P3 | features/chat/composer-body-clear.ts:7-10
```ts
/** started/ok 路径是否清正文。恒 false。 */
export function shouldClearComposerBodyAfterAgentStarted(): boolean { return false; }
```
**描述**：恒 false 的函数，`ChatComposer.tsx:396` 用 `if (shouldClearComposerBodyAfterAgentStarted())` 包住一行永不执行的 `onChange("")`。注释明确说这是「B4 契约钉死」的占位（对齐 mobile 晚清），测试 `composer-body-clear.test.ts:12` 也在断言它恒 false。
**置信**：intentional —— 契约占位，**不当问题报**，仅登记以免后续 CR 重复争论。

### F-w9-ds2-19 | P3 | features/../state/nav-workspace.ts:25-29（消费侧：本区 `vfsScope("session",…)`）
```ts
export const WORKSPACE_TITLES: Record<WorkspaceScope, string> = {
  session: "会话工作区", chat: "聊天工作区", physical: "文件浏览器",
};
```
**描述**：`session` 面板标题写「会话工作区」，但它映射到 core `{kind:"project"}`（项目工作区）；真正映射到 core session 域的 `chat` 面板标题是「聊天工作区」。这是全仓最容易误读的命名陷阱，`chat-link-route.ts:8-10` 已专门写了注释警告。本区所有 `vfsScope("session", …)` 调用都要跨过这道坎才正确（见 F-w9-ds2-3）。
**建议**：要么把标题改成「项目工作区 / 聊天工作区」，要么在 `VfsScopeRequest` 上加注释 + 把 `resolveVfsScopeFromRequest` 的映射表做成对照表贴在 `nav-workspace.ts` 旁边。
**置信**：confirmed（命名与实现相反这一事实）

### F-w9-ds2-20 | P3 | features/chat/SessionDetailDrawer.tsx:302-326, 157-175
```tsx
submittingRef.current = true;
const result = await ipcSessionsRename(...);   // 无 catch：抛错则 submittingRef 永不复位
submittingRef.current = false;
```
**描述**：(a) 重命名 IPC 抛错时 `submittingRef` 卡在 true，此后 blur/Enter 全部被 `if (submittingRef.current) return` 挡掉，input 再也提交不了，且 `editingName` 停在 true。(b) :157-175 订阅 `onAgentStream`，**每条 STEP_COMMITTED 都触发一次 `reload()`**（= meta + tokenLabel 两次 IPC），多步 run 下会连续打十几轮。抽屉开着时尤其明显。
**建议**：(a) 补 catch/finally；(b) 对 token 刷新做 300-500ms 防抖。
**置信**：confirmed

### F-w9-ds2-21 | P3 | features/settings/WorkspaceSettingsView.tsx:211-241
```tsx
onChange={async (next) => { setLlmStream(next); await ipcPreferencesSetLlmStream(next); }}
```
**描述**：四个偏好开关都是「先改本地 state、再 await 写盘」，既不检查 `res.ok` 也不 catch。写盘失败 → UI 显示新值、偏好没变，重启后又跳回去，且无任何提示。同一组件 `saveCompaction`（:153）却是检查了 ok 的，标准不统一。
**置信**：confirmed

### F-w9-ds2-22 | P3 | features/settings/SettingsViews.tsx:729-738, 771-772
```tsx
const res = await ipcAgentRegistryCreateBlank({ mode: ... });
if (res.ok) { openAgentEditor(...); await reload(); }   // 失败：什么都不做
const copyId = `agent-${Date.now()}`;
```
**描述**：(a) 新建智能体失败时无 toast，用户点「新建」后界面毫无反应。(b) duplicate 的新 id 用 `Date.now()`：同一毫秒内复制两个 agent 会撞 id，而 upsert 语义是覆盖——第二次会把第一次的副本覆盖掉（且这两处都缺 `saveRes.ok` 检查，失败也无提示）。
**建议**：用 `crypto.randomUUID()` 或 `agent-${Date.now()}-${counter}`；两处补失败提示。
**置信**：confirmed

### F-w9-ds2-23 | P3 | features/settings/ToolPolicyPicker.tsx:36
```tsx
const prevOpenRef = useMemo(() => ({ value: false }), []);
```
**描述**：用 `useMemo` 造一个可变对象当 ref 用（只为省一个 `useRef` 导入）。功能正确但反模式，容易被后人误当成派生值而在 StrictMode 双调用下出错。
**建议**：换成 `useRef(false)`。
**置信**：confirmed

### F-w9-ds2-24 | P3 | features/chat/MetricsDetailPopover.tsx:236-243
```tsx
const top = Math.min(rect.bottom + ANCHOR_GAP, window.innerHeight - VIEWPORT_MARGIN);
const left = Math.max(VIEWPORT_MARGIN, rect.left);
```
**描述**：只钳了上边和左边，没有按面板实际尺寸钳右边/下边；窗口 resize 或滚动时不重算（`useLayoutEffect` 依赖只有 `anchorEl`）。面板宽于剩余空间时会横向溢出视口。同类问题：`ConversationPanel.tsx:630-633` 的消息菜单用硬编码 `window.innerWidth - 180` / `- 200` 钳位，菜单项变多时会截断。
**置信**：confirmed

### F-w9-ds2-25 | P3 | features/chat/ChatHistorySearchPanel.tsx:36, 26-33
```tsx
export function ChatHistorySearchPanel({ projectId: _projectId, sessionId, onClose })
```
**描述**：`projectId` 收下不用（改用 ShellNav 的 `openChatLink`），:40-42 有注释说明为什么安全。属有意为之，仅登记。同文件 `normalizeSeqInput` 用 `Number(trimmed)` 允许小数（输入框 :246/:256 已过滤非数字故当前不可达）。
**置信**：intentional（`_` 前缀 + 注释钉死）

### F-w9-ds2-26 | P3 | features/settings/SettingsViews.tsx:1233-1253, 1278, 1297
```tsx
headers: headersJson.trim() ? JSON.parse(headersJson) : undefined,   // 无提示文案
```
**描述**：`headers` 的 `JSON.parse` 错误直接冒泡到 :1308 的 catch，把 Node 的英文原文（如 `Unexpected token } in JSON at position 3`）当错误文案 toast 给用户；只有 `bodyParams` 那条路径（:1258-1266）有中文兜底。另外 `!res.ok` 时（:1236）静默 return，表单停留在一片空白/默认值上，用户以为 provider 没有配置。
**建议**：给 headers 解析也加中文 reason；加载失败给行内错误。
**置信**：confirmed

### F-w9-ds2-27 | P3 | features/workspace/workspace-batch-dnd.ts:90-105
```ts
export function ensureStartDragFailureToast(): () => void {
  if (startDragFailedUnsub == null) { startDragFailedUnsub = onVfsStartDragFailed(...); }
  return () => { startDragFailedUnsub?.(); startDragFailedUnsub = null; };
}
```
**描述**：每次调用都返回一个新 unsubscribe，且任何一个 unsubscribe 都会把全局订阅干掉。若两个组件同时调用（当前只有一个调用方，尚安全），先退的那个会让后者的清理变成空操作、或让仍在运行的组件失去失败提示。另外 `activeNativeDrag`/`stagedByPath`/`failedStagePaths` 等 5 个模块级单例没有任何测试入口（只有 `isPrefetchInFlightForTest` 一个），回归只能靠 e2e。
**置信**：suspected

### F-w9-ds2-28 | P3 | features/chat/ComposerAtPathInput.tsx:14
```ts
const AT_TOKEN_RE = /@([^\s@$]+)|\$([^\s$@]+)/g;
```
**描述**：高亮正则与 core 的 `findActiveAtQuery` 触发语义是两套独立实现（一个为渲染、一个为查询），两者对「`@` 后紧跟标点」「路径含中文标点」等边界的判定未必一致，可能出现「typeahead 有候选但不高亮」或反之的观感不一致。同类双实现还有 `prompt-macro-input.ts` 与 mobile 同名模块（整段平行）。
**建议**：把高亮 token 化规则改为复用 core 的 `findActiveAtQuery`（或至少抽成 core 单函数），避免双份正则漂移。
**置信**：suspected（未构造边界用例实测）

### F-w9-ds2-29 | P3 | features/skills/NewSkillModal.tsx:168
```tsx
directoryPath: `/meta/skills/${trimmedName}`,
```
**描述**：技能目录前缀 `/meta/skills/` 在 renderer 硬编码，而 RULE.md 记录的单源是 core `domain/skills/logic/skill-paths.ts`。core 若调整逻辑前缀，这里不会跟着变（且只在 ZIP 导入通道生效，手进创建走 `ipcSkillsWrite` 由 core 拼路径——两条通道的路径来源不同源）。
**建议**：从 `@shared/logic/skills` 暴露一个 `skillDirectoryPath(name)` 供两处共用。
**置信**：confirmed

### F-w9-ds2-30 | P3 | features/chat/ConversationPanel.tsx:349-362
```tsx
useEffect(() => { ... void ipcSessionsSetComposerDraft({ sessionId, draftJson }); },
  [sessionId, composerText, composerAttachments, readOnly]);
```
**描述**：`draftJson` 只由 `composerText` 决定（附件恒空），但 `composerAttachments` 进了依赖——每次状态条变化（workplace 纳入状态刷新、annotate chip 增删）都会重发一次内容完全相同的草稿写 IPC。同时该写入是 `void`  fire-and-forget，无节流、无失败处理，长文本草稿在每次按键时都全量写库。
**建议**：依赖去掉 `composerAttachments`，或对写入做 300ms 防抖。
**置信**：confirmed

### F-w9-ds2-31 | P3 | features/workspace/WorkspaceHeaderActions.tsx:37-53
```tsx
const pullTemplate = useCallback(async () => {
  if (workspaceSessionId) { const result = await ipcSessionsPullTemplate(...); ... }
  finally { setBusy(false); setConfirmKind(null); }
```
**描述**：`workspaceSessionId` 为空时整个 if 跳过，用户点「初始化」→ 确认框关闭、**没有任何反馈**（既没成功 toast 也没失败 toast）。拉取/推送本身也缺 `.catch`。
**置信**：confirmed

### F-w9-ds2-32 | P3 | features/settings/settings-nav.ts:158 / layout 侧（越界，仅记录）
**描述**：`shouldGuardSettingsNav` 的第二分支（ref 覆写型）依赖「当前 view 已在 skillDetail 且动作会覆写 viewingSkillRef」。这条分支与 F-w9-ds2-1 呼应：如果 AgentEditorView 接上 dirty 通道，需复核守卫对 `agentEditor` 的两个分支是否都成立（目前只按 viewId 判别，不区分 editor 内子态）。
**置信**：suspected（跨 zone，仅提示 reduce 阶段合并）

## 争议与存疑

1. **F-w9-ds2-3（composer 引用域）是本轮最需要产品拍板的一条。** 代码链路我已逐段核实到 core（`resolve-vfs-scope.ts` → `{kind:"project"}`；`agent-runner.ts:444 vfs: toolCtx.vfs` → `run-agent-turn.ts:1036` 注释 → `create-desktop-runtime.ts:181 sessionVfs → {kind:"session"}`），mobile 侧对照也读了。但「desktop 刻意让 composer 只引用项目模板」是否是有意设计（比如配合「初始化/推送到项目工作区」的模板语义），只有用户能定。若判为有意，`nav-workspace.ts` 的面板标题就该改；若是疏漏，两处 `vfsScope("session",…)` 都要改成 `"chat"`。
2. **F-w9-ds2-14 的性能严重度未实测。** O(n²) 是静态可推的，但 desktop 侧 `useConversationBatch` 的 RAF 合并可能已经把渲染频率压到可接受范围。我没有跑真机 profile，所以只给 P2 而非 P1，且置信写 confirmed 指的是「复杂度结构成立」而非「已观测到卡顿」。
3. **F-w9-ds2-9 的删除建议需要产品/作者确认。** `AgentDefinitionEditorForm` 与 `transcript-selectable-role`/`tool-turn-actions` 这类「整文件无消费方」的模块，可能是给 mobile 同步用的模板（mobile 确有一份几乎同形的 `tool-turn-actions.ts` 且带测试）。若是双端同步源，删之前要确认仓外（未来 mobile 分支）是否引用。
4. **`conversation-abort-retain.ts` / `flush-run-ui.ts` 的 abort-retain 三段式收口我判定为 intentional。** 那一大段注释（`shouldReloadOnRunFinished` :37-58、`ConversationPanel.onRunFinished` :411-421）把「发送→立刻停止」这个具体失败场景推演得很完整，且有 `conversation-panel-abort.test.ts` + `conversation-abort-retain.test.ts` 覆盖。我**没有**把它报成问题，只提示：这段逻辑的正确性依赖 `runId === ""` 这个 core 侧约定，core 若改了前奏终态的 runId 形态，这里会静默失效（无契约测试跨仓钉住）。
5. **覆盖率缺口没进发现清单。** `ConversationPanel`（1131 行，仅 abort 路径有测试）、`WorkspaceTree`（361 行，0 组件测试）、`SessionDetailDrawer`（664 行，0 测试）、`SettingsViews` 7 个视图（2508 行，仅 `migration-row-value` 被抽出直测）是本区最大的未测面。我按「发现」schema 只给了症状级条目（F-3/6/7/8），没单独立一条「测试缺口」——留给 W9 reduce 阶段决定要不要在 ledger 里单开一类。
6. **未越界核查的两处**：`ShellNavProvider` 里「子会话写入刷新」旁路订阅（RULE.md 有记载）、`apps/desktop/src/main/ipc/resolve-vfs-scope.ts` 的映射表我只读未评，属 main 域（w1/w2 机位）。