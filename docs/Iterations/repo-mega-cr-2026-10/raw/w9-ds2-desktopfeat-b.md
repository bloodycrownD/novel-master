---
zone: w9-ds2-desktopfeat-b
agent: domain-survey（独立双扫 B）
files_scanned: 77
loc_total: 18361
scan_date: 2026-10-01
repo: D:\Dev\nm-worktree\mcr（worktree，分支 feat/repo-mega-cr）
scope: apps/desktop/renderer/features/（chat / settings / skills / workspace 四个子域全量）
independence: 未读取 raw/ 与 synth/ 下任何文件（本报告仅写 raw/）
---

# W9 独立双扫 B — apps/desktop/renderer/features/ 全量测绘

## 摘要

desktop 渲染进程的**业务特性层**：四个子域共 77 个文件 / 18361 行。`chat/`（38 文件、~7.4k 行）是会话主界面——转录渲染、composer 输入与发送、abort-retain 收口、链接路由；`settings/`（24 文件、~9.9k 行）是设置总栈——服务商/模型/智能体/技能/智能排序/搜索/统计/备份；`skills/`（4 文件）是技能新建与信息编辑；`workspace/`（11 文件）是 VFS 资源管理器——目录树、拖放、右键动作、目录规则。渲染层不碰数据库，全部经 `@/ipc/client` 的 ~110 个 `ipc*` 通道落 main → core。

## 职责与边界

**在边界内**：组件树与 hooks、纯逻辑投影（DTO ↔ 视图模型）、IPC 调用编排与错误呈现、renderer 内的进程内状态（批注草稿 store、批量拖放 staging 表）、DOM CustomEvent 广播。

**在边界外**：SQLite / KKV（core 与 main）、preload bridge、跨组件导航状态（`ShellNavProvider` / `SettingsOverlay`）、共享纯逻辑单源（`@shared/logic/*` 与 `packages/core/src/public/*`）。

**易踩的边界约定（README/注释写明，非缺陷）**：
- 命名陷阱：desktop 的 `workspaceScope: "chat"` 是 core 的 session 域，`"session"` 是 core 的 project 域（`chat/chat-link-route.ts:8-10`）。
- 技能目录已重定位到 VFS meta 域，逻辑路径固定 `/meta/skills/{name}/...`，renderer 直接拼串（`skills/NewSkillModal.tsx:168`、`settings/SkillsManageView.tsx:180`、`settings/SkillDetailView.tsx:230`）。

## 对外接口（导出面）

按子域列出被外部消费的导出（其余为零引用死导出，见 F-17）：

- **chat**：`ConversationPanel`、`runCompaction`、`ChatComposer`、`MessageList`、`MessageEditModal`、`ToolCallCard` / `ToolCallGroupCard` / `MessageAttachmentGroupCard`、`MetricsDetailPopover` / `MetricsDetailPanel` / `useSessionUsageDetail`、`RealPromptPanel`、`SessionDetailDrawer`、`SessionSkillPanel`、`ChatHistorySearchPanel`、`FileReferencePicker`、`SkillPicker`、`SkillTypeahead` / `AtPathTypeahead`、`ComposerAtPathInput` + `renderComposerAtPathHighlightHtml`、`AttachmentDraftChips` / `ComposerStatusChips`、`useConversationBatch`、`useReadOnlyRunProbe` + `READONLY_RUN_PROBE_INTERVAL_MS`、`useWorkspaceFooterReload`。
- **纯逻辑模块（测试直测面）**：`message-blocks.ts`（14 个导出，`buildChatListItems` 是渲染主力）、`conversation-abort-retain.ts`（7）、`composer-send-state.ts`、`composer-body-clear.ts`、`rollback-composer.ts`、`rollback-annotate-restore.ts`、`tool-turn-actions.ts`、`transcript-selectable-role.ts`（14 re-export）、`chat-link-route.ts`、`readOnlyRunProbeLogic.ts`、`flush-run-ui.ts`、`chat-annotate-draft.ts`（批注 store 的 desktop 门面）。
- **settings**：`SettingsViews.tsx` 导出 8 个视图（`DataManagementView` / `AgentsSettingsView` / `ProvidersView` / `ProviderFormView` / `ProviderDetailView` / `SmartSortRulesView` / `SmartSortRuleEditorView`）+ 重导出 `AgentEditorView` / `ModelSamplingView`；`settings-ui.tsx` 15 个原子组件；`settings-nav.ts` 导航单源（`SETTINGS_NAV` / `shouldGuardSettingsNav` / `SettingsNavHandle`）；`TokenUsageStatsView`；`WorkspaceSettingsView`；`SkillDetailView`；`SkillsManageView`；`SearchEngine*`；`AboutView`；`AgentDefinitionEditorForm`（可复用 handle 形态）。
- **skills**：`NewSkillModal`、`SkillInfoEditModal`、`SkillPicker`、`skill-ui`（`skillDomainLabel` / `skillKey` / `parseSkillKey` / `dispatchOpenSettingsView` / `OPEN_SETTINGS_VIEW_EVENT` / `buildNewSkillDoc` / `isValidSkillNameInput` / `toSkillRef`）。
- **workspace**：`WorkspaceTree`（+ 重导出 `WorkspaceContextTarget`）、`WorkspaceHeaderActions`、`DirectoryRuleModal`、`FileInclusionModal`、`workspace-actions.ts`（11 个动作函数）、`workspace-batch-dnd.ts`（拖放编排，模块级全局态）、`workspace-context.ts`（右键菜单项单源）、`vfs-tree-dnd.ts` / `vfs-tree-utils.ts` / `preview-tab-sync.ts` / `useWorkspaceTree.ts`。

## 数据访问

渲染层**零直接 DB 访问**，全部经 IPC → main → core。实测的通道分布（`rg` 全量提取，本区 1329 处调用点）：

| 域 | 通道 | 落点（core 表 / KKV / 文件） |
|---|---|---|
| 消息 | `ipcMessagesList/Search/Append/Edit/Hide/Show/Delete/Fork/Rollback/SetFloor` | `chat_message`（正文压缩列见 RULE）+ VFS 版本链回滚 |
| 会话/草稿 | `ipcSessionsGet/SetComposerDraft`、`ipcSessionsProjectComposerStatus`、`ipcSessionsRename`、`ipcSessionsSetAgentBinding`、`ipcSessionsSetModelOverride`、`ipcSessionsPull/PushTemplate` | `chat_session`（draft 列）+ `session_kkv` |
| Agent 运行 | `ipcAgentRun/Abort/RunIsActive/ListPicker/SetCurrent/ResolveCurrent`、`ipcAgentRegistry*`、`ipcAgentYamlExport/Import` | agent registry 表 + 全局配置 |
| 工作区 | `ipcWorkplaceBuildListRows/SetDirRule/SetFileRule/GetDirRule/CaptureSessionBlock` | `workplace_dir_rule` + `session_kkv.rule_snapshot`（每次改规则后 main 清 KKV） |
| VFS | `ipcVfsRead/Write/Mkdir/Delete/Rename/ZipExport/ZipImport/ZipPick/ZipImportBytes/CharacterCardImport/Batch*`、`ipcPhysicalList/Read` | `vfs_entry` / `vfs_revision` / `vfs_content_blob`；技能域 `/meta/skills/*` |
| 技能 | `ipcSkillsList/Effective/Read/Write/Edit/Toggle/Delete/AssertCreateName/UpdateInfo` | VFS meta 域（global-meta / project-meta） |
| 统计 | `ipcUsageStatsQuery`（summary/daily/modelBreakdown/hourly/models/requests/sessionDetail） | `chat_message` token 列聚合 |
| 提示词 | `ipcPromptRealPreview/ChatTokenLabel/AgentMeta` | 常驻前缀快照（只读投影） |
| 设置 | `ipcProviders*` / `ipcProviderModels*` / `ipcSearch*` / `ipcPreferences*` / `ipcCompactionConditions*` / `ipcSmartSortRule*` / `ipcBackup*` / `ipcDbStats` / `ipcDbMaintenance` / `ipcCloudSync*` | `llm_saved_model`、搜索 key、云同步配置 store、app-ui KKV |
| 应用 | `ipcAppGetInfo/CheckForUpdates/OpenExternal`、`ipcShellMenuPopup` | — |

**文件路径触点**：技能 ZIP 导出/导入落 `/meta/skills/{name}`（`NewSkillModal.tsx:168`、`SkillsManageView.tsx:180`、`SkillDetailView.tsx:230`）；批量导入 staging 由 main 落在 userData 临时目录（5 分钟 TTL 回收，`vfs-batch.service.ts:241`）。

**renderer 进程内状态**：批注草稿 store（`@shared/logic/chat`，跨组件共享）；批量拖放 staging 表 + `prefetchGeneration`（`workspace-batch-dnd.ts:38-46`，**模块级全局态，不按 project/session 隔离**）。

**跨组件事件总线**（`window.dispatchEvent` / `addEventListener`，均按 sessionId 过滤）：`session-compacted`（`ConversationPanel.tsx:1122`）、`messages-rollback`（`ConversationPanel.tsx:751`）、`context-changed`（`ConversationPanel.tsx:888`）、`open-settings-view`（`skills/skill-ui.ts:95`）。

## 依赖关系

**import 了谁**（外部依赖 Top）：`@/ipc/client`（27 文件）、`@shared/ipc-types`（33）、`@shared/logic/chat`（10）、`@/components/ui/*`（各 2-12）、`@shared/logic/{config-forms-agent, skills, prompt, search-engines, workplace, agent, provider}`、`@/providers/ShellNavProvider`（5）、`@/hooks/{useAgentStream, useAgentRunLifecycle, useAgentStreamMetrics, useBatchSelection, useAutoResizeTextarea, useDesktopAgentActive, stream-token-estimator}`、**`@novel-master/core/*` 直引仅 2 处**：`chat/chat-link-route.ts:19`（`isHttpUrl` / `resolveChatLinkTarget`）与 `chat/conversation-abort-retain.ts:4`（仅 type import）。其余均经 `@shared/logic/*` 镜像——符合 preload 注释「renderer 不得 import core」的架构约定。

**被谁消费**：`renderer/layout/{ChatRail, MainShell, ExplorerPane, SettingsOverlay, PreviewPane, AppMenuBar, PreviewEditorTabs, AppChrome}` + `renderer/App.tsx`。本区不 import `providers/` 与 `layout/`（除 `SessionDetailDrawer` 从 `ConversationPanel` 反向 import `runCompaction`，见 F-18 同族观察）。

## 发现清单

### P1

**F-w9-ds2-desktopfeat-b-1 | P1 | apps/desktop/package.json:11 + apps/desktop/tsconfig.json:8 + .github/workflows/ci.yml:63 | confirmed**
```json
"typecheck": "tsc --noEmit -p tsconfig.json"     // package.json:11
"include": ["src/main/**/*", "shared/**/*"]     // tsconfig.json:8
```
CI 的 `npm run typecheck --workspaces --if-present` 对 desktop 只跑 `tsconfig.json`，其 `include` **不含 `renderer/`**；`tsconfig.renderer.json` 存在但没有任何 npm script / CI 步骤引用它；`build` 走 `vite build`（esbuild 只转译不查类型）。实测 `npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json`：**全 renderer 813 条错误，其中本区 160 条**（TS18046 `unknown` 125 / TS2345 8 / TS2540 8 / TS2322 6 / TS7006 6 / TS6133 4 / TS2559 1 / TS2704 2）。后果：整个渲染层长期无类型门禁。
建议：加 `typecheck:renderer` 脚本并进 CI；先按文件分批清账（`SettingsViews.tsx` 79 条 / `AgentEditorView.tsx` 25 条 / `ModelSamplingView.tsx` 18 条 / `AgentDefinitionEditorForm.tsx` 12 条占本区 84%）。

**F-w9-ds2-desktopfeat-b-2 | P1 | chat/ChatHistorySearchPanel.tsx:106 + :264 | confirmed**
```tsx
setError(result.error ?? '查询失败');   // :106  error 是 IpcErrorPayload 对象
...
{error}                                  // :264  React 渲染对象子节点
```
`ipcMessagesSearch` 返回 `IpcResult<ChatMessageDto[]>`（`shared/ipc-types.ts:218`），`!result.ok` 分支的 `result.error` 是 `{code, message, ...}` 对象，而 `error` state 声明为 `string | undefined`。tsc 已报 `TS2345`（被 F-1 掩盖）。运行时：查询失败 → 渲染 `<p>{error}</p>` 传对象 → React 抛 **"Objects are not valid as a React child"** → 整个查找聊天记录面板白屏。
建议：`setError(result.error.message || '查询失败')`。

**F-w9-ds2-desktopfeat-b-3 | P1 | skills/skill-ui.ts:21-35 | confirmed**
```ts
export function buildNewSkillDoc(name: string, description: string): string {
  return ["---", `name: ${name}`, `description: ${description}`, "---", ...].join("\n");
}
```
桌面端**未做 YAML 转义**。同款函数的 mobile 版已修（`apps/mobile/src/components/skills/skill-ui.ts:48-58` 有私有 `yamlScalar = JSON.stringify` 并注释"仅本文件 buildNewSkillDoc 消费"）；core 单源 `packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts:10-11` 明确写"值一律写 YAML 双引号标量……含冒号 / 引号 / 换行的描述不会破坏解析"。触发：`NewSkillModal` 的描述是 `<textarea rows=3>`，用户输入含 `: `、`#`、`"`、换行即产出非法 front matter → 技能刚落库就是 `valid: false`（列表标「无效 · front matter 不可解析」，且 `SkillsManageView.tsx:146` 的「编辑信息」对无效技能禁用）。
建议：桌面端复用 `withSkillFrontMatterValues` 或直接抄 mobile 的 `yamlScalar`；两侧合并为 `@shared` 单源。

**F-w9-ds2-desktopfeat-b-4 | P1 | settings/WorkspaceSettingsView.tsx:139-171 + :250-277 | confirmed（代码层；需运行时复核）**
```tsx
const saveCompaction = useCallback(async (nextEnabled = compactionEnabled) => {
  ... { tokenRatio: Number(compactionTokenRatio), ... }
}, [compactionEnabled, compactionTokenRatio, compactionHideStartDepth]);

const scheduleCompactionSave = useCallback(() => {
  compactionSaveTimer.current = setTimeout(() => { void saveCompaction(); }, 600);
}, [saveCompaction]);

onChange={(e) => { setCompactionTokenRatio(e.target.value); scheduleCompactionSave(); }}
```
`onChange` 里 `setState` 与 `scheduleCompactionSave()` 处于**同一次渲染的闭包**中：定时器捕获的是本帧的 `saveCompaction`，它读的是**本次击键之前**的 `compactionTokenRatio`。用户输入 "0.8" 的三次击键分别排程了保存 `""` / `"0"` / `"0."` 的定时器，最后落地的是 `"0."` → `Number("0.")` = 0。「Token 比例」与「隐藏起始深度」两栏的**最后一次输入永远丢失**。
建议：定时器内用 ref 读最新值，或 `setTimeout(() => saveCompaction(nextEnabled, nextRatio, nextDepth), 600)` 显式传参。

**F-w9-ds2-desktopfeat-b-5 | P1 | renderer/ipc/invoke-registry.ts:474-525 → 本区 125 处 | confirmed**
```ts
ipcProvidersList: noArg(invoke, IPC_CHANNELS.PROVIDERS_LIST),          // 无泛型 → unknown
ipcProvidersGet: withReq<{ providerId: string }, unknown>(invoke, ...),
ipcProviderModelsGetSaved: withReq<{ savedModelId: string }, unknown>(invoke, ...),
```
服务商 / 模型 / agent-registry / YAML / 云同步 / 备份 / db 统计这一整组通道**没有声明响应类型**，全部返回 `Promise<unknown>`。后果：本区 125 条 `TS18046`（`'res' is of type 'unknown'`），且所有调用点只能靠 `res.ok` / `res.data` 盲取——`AgentEditorView.tsx:335` 直接 `agentRes.data.value as AgentDefinition`、`ModelSamplingView.tsx:135-193` 连查五处、靠 `typeof` 现场防御才没炸。
建议：给这组通道补真实 DTO（`ProviderListItemDto` / `SavedModelDto` / `AgentRegistryGetResponse` 等，`shared/ipc-types.ts` 已有多数），逐条消除 `as` 断言。

### P2

**F-w9-ds2-desktopfeat-b-6 | P2 | chat/ConversationPanel.tsx:755-771 | confirmed（机制）/ suspected（实际触发）**
```tsx
setComposerText(prevText => {
  const next = resolveComposerDraftAfterRollbackSuccess({ text: prevText, ... }, ...);
  setComposerAttachments(applyUndoAnnotateRestore(sessionId, ...));   // updater 内调 setState
  return next.text;
});
```
reducer 内做副作用（另一个 setState + 改进程内批注 store）。`main.tsx:12` 全局包了 `<StrictMode>`，dev 下 React 会对 state updater **双调用**做纯度检测 → `applyUndoAnnotateRestore` 跑两次 → `undo_send` 分支向 store 追加两份反投影草稿，而 core 的 `addChatAnnotateDraft`（`packages/core/src/domain/chat/logic/chat-annotate-draft-store.ts:101-111`）是**无条件 append、无去重** → composer 上出现重复批注 chip。`rewind` 分支是 `clearChatAnnotateDrafts`，幂等，不受影响。
建议：把两次 setState 提到 updater 外（先算 `next`，再依次 set）。

**F-w9-ds2-desktopfeat-b-7 | P2 | settings/AboutView.tsx:161-163 + settings/settings-ui.tsx:271-289 | confirmed**
```tsx
<SettingsStatus>{formatStatusLabel(lastStatus, lastRemote)}</SettingsStatus>   // AboutView:161
export function SettingsStatus({ message, error, inline }) {                   // settings-ui:271
  if (!message && !error) return null;
```
`SettingsStatus` 只认 `message` / `error` 两个 prop，不接受 children，且两者皆空时 `return null`。结果：**「检查更新」的结果状态行永远不渲染**——用户点「立即检查」后除了弹窗（仅在有新版本时）没有任何状态反馈。
建议：`<SettingsStatus message={formatStatusLabel(lastStatus, lastRemote)} />`。

**F-w9-ds2-desktopfeat-b-8 | P2 | settings/AgentEditorView.tsx:762 / AgentDefinitionEditorForm.tsx:560 / SettingsViews.tsx:2407 | confirmed**
```tsx
<SettingsField label="专属模型"
  hint="默认(跟随) 表示使用会话操作抽屉 / 我的里设置的当前模型。">   // AgentEditorView:762
```
`SettingsField`（`settings-ui.tsx:231-242`）props 为 `{label, children, narrow?, row?}`，无 `hint`。三处调用点的说明文案被静默丢弃（tsc `TS2322`）。注：`ManageHeader` 的 `hint` 是支持的（`SettingsViews.tsx:888/1124/1558/1951` 正常），只有 `SettingsField` 这一路漏了。
建议：给 `SettingsField` 补 `hint?: string` 渲染，或调用点改走 `SettingsFormSection.desc`。

**F-w9-ds2-desktopfeat-b-9 | P2 | settings/SkillsManageView.tsx:359-370 | confirmed**
```ts
for (const ref of target.refs) {
  const res = await ipcSkillsDelete(ref);
  if (!res.ok) { showToast(res.error.message); break; }   // 失败即中断
}
batch.exit();
showToast("已删除技能");                                  // 无条件成功 toast
```
批量删除在第 N 个失败时 `break`，随后仍弹「已删除技能」——内置技能 `agent-config` 不可删除（见 RULE「保留名门」），用户批量删选中项时必然命中「删到内置技能中断 + 报成功」。
建议：统计成功/失败数，按结果给文案。

**F-w9-ds2-desktopfeat-b-10 | P2 | workspace/DirectoryRuleModal.tsx:37-46 vs apps/mobile/src/services/fill-policy-mobile.ts:7-10 | confirmed**
```ts
// desktop：不识别 "full" → 回落 DEFAULT_WORKPLACE_DIR_RULE.fillPolicy（= "header"）
function normalizeFillPolicy(fillPolicy: FillPolicy | undefined): UiFillPolicy { ... }
// mobile：注释明写 "legacy `full` maps to `hidden` in UI"
export function normalizeFillPolicyForMobile(...) { if (fillPolicy === 'full') ... }
```
`"full"` 仍是 core 合法枚举（`packages/core/src/domain/workplace/model/workplace-types.ts:28`）。两端把 legacy 值映射到**不同**目标（desktop→`header`、mobile→`hidden`），且 desktop 的 `FILL_POLICIES` 选项里没有 `full`（`:31-35`）。后果：一条 `fillPolicy="full"` 的规则，用户在桌面端打开目录规则表单随便改个排序方向点保存，就静默落库成 `header`；同一操作在移动端落成 `hidden`——同一条规则双端保存结果不一致。
建议：把 legacy 映射抽到 `@shared/logic/workplace` 单源并统一目标值。

**F-w9-ds2-desktopfeat-b-11 | P2 | workspace/WorkspaceTree.tsx:99-105 | suspected**
```tsx
setExpandedDirs(new Set(result.data.filter(r => r.kind === "dir").map(r => r.path)));
```
每次 `reload()`（scope 切换 / `refreshToken` 变化 / 任何 `onMutated` 触发的刷新）都把展开集合重置为「全部目录」，用户手动折叠的状态被丢弃；配合 `isTreeRowVisible` 的全展开语义，大工作区每次刷新都全量渲染整棵树。
建议：`setExpandedDirs(prev => new Set([...prev, ...newDirs]))`（并集）。

**F-w9-ds2-desktopfeat-b-12 | P2 | workspace/WorkspaceTree.tsx:197-207 + workspace-batch-dnd.ts:166-203 | confirmed（代码）/ suspected（影响面）**
```tsx
onPointerDown={(e) => handleRowPointerDown(e, row)}   // WorkspaceTree:265
// handleRowPointerDown → prefetchExportStage({ scope, logicalPath: row.path })
```
**任何** pointerdown——单击选中、右键、滚动中的误触——都会把该行文件整份物化到 main 的 userData 临时目录（`ipcVfsBatchExportStage` → `stageVfsBatchExport` 复制文件）。renderer 侧的 `stagedByPath` 只在 `dragstart` / `dragEnd` / `prefetch` 重入时清理，纯点击不触发任何清理 → 点击 N 个不同行 = renderer 侧 N 条 staging 记录常驻（main 侧有 5 分钟 TTL 兜底删目录，见 `vfs-batch.service.ts:241`，但 IPC 往返与磁盘复制成本每次都真付）。
建议：改成拖动势延迟预取（`pointerdown` 记起点、`dragstart`/`dragmove` 超阈值再物化），或在 `pointerup` 且未进入拖拽时释放。

**F-w9-ds2-desktopfeat-b-13 | P2 | chat/message-blocks.ts:100-140 + chat/MessageList.tsx:137 | confirmed（复杂度）**
```tsx
const listItems = buildChatListItems(messages, { agentRunning, runUiStopped: !uiRunning });  // MessageList:137，无 useMemo
```
`buildChatListItems` 内部对**每条带 tool_use 的助手消息**调 `resolveUnpairedToolStatus` → `isTurnToolExecuting` → `lastIncompleteToolAssistant`（自身又对每条助手消息调 `turnToolResultsComplete` → `buildToolResultByUseId(messages)`，每次重建全表 Map）。最坏 O(n³)；`buildToolResultByUseId` 已经在 `buildChatListItems:263` 建好一份却没被复用。叠加 `MessageList` 未 memo：流式期间 `streamingText` 每帧变化 → `ConversationPanel` 重渲 → 整条转录每帧全量重算。
建议：`buildChatListItems` 内部把 `results` Map 作为参数透传给 `turnToolResultsComplete`；`MessageList` 包 `useMemo([messages, agentRunning, runUiStopped])`。

**F-w9-ds2-desktopfeat-b-14 | P2 | chat/message-blocks.ts:58-81 + chat/tool-turn-actions.ts:29/35/50 | suspected**
```ts
if ([...required].every((id) => resultIds.has(id))) return message.id;   // 要求单条消息含全部 result
```
`resolveToolResultsMessageId` 只接受「同一条 user 消息里含全部 tool_result」的形态。若工具结果被拆到多条 user 消息（续跑/分叉/历史导入等），返回 `undefined` → `hideToolTurn` / `deleteToolTurn` 只处理助手消息，**遗留孤立的 tool_result user 消息**可见。
建议：改为收集所有命中 `required` 的后继 user 消息 id 列表，逐条 hide/delete。

**F-w9-ds2-desktopfeat-b-15 | P2 | settings/settings-nav.ts:104-116 + SettingsViews.tsx:717/1130/1157/1285/1444/1722 + SkillsManageView.tsx:131/393 | confirmed**
```ts
export interface SettingsNavState {
  readonly editingAgentId?: string;      // settings-nav.ts:105  声明 readonly
  ...
}
// SettingsViews.tsx:717
nav.navState.editingAgentId = agentId;   // 6+ 处就地改共享对象（tsc 报 TS2540）
```
设置导航的「当前编辑目标」不是 state，而是 `SettingsOverlay` 用 `useRef` 持有的**单一可变对象**，各视图直接就地赋值。没有响应式更新，语义完全依赖「`nav.push()` 触发重渲染后 `navStateRef.current` 被重读」这条隐式链路；`handleClose` 又整体 `navStateRef.current = {}` 换对象（`SettingsOverlay.tsx:244`）。`dirtyViews` 为此专门拆成独立永不变引用的 Set（`settings-nav.ts:93-99` 注释自陈），说明这个坑已经被踩过一次并局部打了补丁，但 `navState` 本体没修。
建议：`navState` 改 `useState`（或每次 push 传 payload），字段去掉 `readonly`。

**F-w9-ds2-desktopfeat-b-16 | P2 | chat/SessionDetailDrawer.tsx:302-324 | suspected**
```tsx
submittingRef.current = true;
const result = await ipcSessionsRename({ id: sessionId, title: trimmed });
submittingRef.current = false;      // 无 try/finally
```
IPC 抛错时 `submittingRef` 永久停在 `true` → `commitRename` 开头即 return，**该抽屉内重命名彻底失效**直到重新挂载。同族无 try/finally 的还有 `DirectoryRuleModal.tsx:96-115`（`.then().finally()` 无 `.catch`）、`SettingsViews.tsx:193-212`（`reloadConfig` 只有 finally）、`TokenUsageStatsView.tsx:493-527`。
建议：统一 `try { ... } finally { submittingRef.current = false }`。（注：main 侧 handler 普遍有 `try/catch → IpcResult`，故 IPC 抛错概率低；但 preload bridge 缺失/序列化失败等路径仍会 reject。）

**F-w9-ds2-desktopfeat-b-17 | P2 | 全区 12 处零引用导出 | confirmed**
`chat/message-edit.ts::applyTextEditToContentBlocks`、`chat/rollback-composer.ts::resolveComposerTextAfterRollbackSuccess`（自标 `@deprecated`）、`chat/transcript-selectable-role.ts::buildTailBatchRows` 与 `MessageBatchMode`、`settings/WorkspaceSettingsView.tsx::usePickerData`、`settings/settings-ui.tsx::SettingsToolbar`、`workspace/useWorkspaceTree.ts::usePreviewSelection` / `useTreeRefreshToken` / `useTreeLoader`（整个文件 67 行三 hook 全死）、`workspace/vfs-tree-dnd.ts::hasNmVfsMime` / `hasFileDrag`、`workspace/vfs-tree-utils.ts::isDescendantPath`、`workspace/workspace-batch-dnd.ts::isPrefetchInFlightForTest` / `getActiveNativeDrag`。实测方式：全仓 `apps/desktop` + `packages` + `apps/cli` + `apps/mobile/src` 语料计数 ≤1（即只有定义处）。
建议：删除；`applyTextEditToContentBlocks` 本身还有逻辑缺陷（丢弃首个之后的全部 text block；无 text block 时新正文根本不落进去），若要复活必须先修。

### P3

**F-w9-ds2-desktopfeat-b-18 | P3 | chat/MessageList.tsx:113 + chat/ConversationPanel.tsx:999 | confirmed** — `streamTailGenerating` prop 收下即弃（`_streamTailGenerating`），调用方仍在传；死 prop。

**F-w9-ds2-desktopfeat-b-19 | P3 | chat/ToolCallCard.tsx:8,31 | confirmed** — `ToolCallStatus` 含 `"interrupted"`，但 `toolCallViewFromUse` 只产出 `pending/success/error`，`resolveUnpairedToolStatus` 只产出 `pending/error`；`statusLabel` 的 `interrupted → "已中断"` 分支不可达。

**F-w9-ds2-desktopfeat-b-20 | P3 | chat/SessionDetailDrawer.tsx:279,293 | confirmed** — `setAgentRows(result.data.rows)` / `setModelRows(result.data.rows)` 赋 readonly 数组到可变 state 类型（`TS2345`）；运行时无害。

**F-w9-ds2-desktopfeat-b-21 | P3 | chat/useReadOnlyRunProbe.ts:54 + chat/readOnlyRunProbeLogic.ts:12 | confirmed** — `queryActive` 返回 `Promise<IpcResult<boolean>>`（联合类型 `ok:true` 才带 `data`），却声明为 `Promise<RunActiveQueryResult>`（`{ok, data}`），`TS2322`。运行时 `first.ok && first.data` / `!first.ok` 判据仍正确，仅类型不匹配。

**F-w9-ds2-desktopfeat-b-22 | P3 | workspace/DirectoryRuleModal.tsx:101 / settings/AgentDefinitionEditorForm.tsx:126-127 / AgentEditorView.tsx:271 | confirmed** — `form.ruleEnabled` / `promptForm.customAttachEnabled` 类型是 `boolean | undefined`，直接灌进 `boolean` state（`TS2345`），Switch 变非受控。对比同文件 `AgentEditorView.tsx:273` 的 `promptForm.skillsEnabled ?? true` 有兜底，此处漏了。

**F-w9-ds2-desktopfeat-b-23 | P3 | chat/ChatComposer.tsx:200,218 | intentional（有依赖写法需知）** — effect 依赖写布尔表达式 `activeAt != null` / `activeSkill != null`：只在「有没有未完成 @/$ 查询」翻转时重取列表行，输入查询词变化不重取（候选在 `typeaheadCandidates` 本地 filter）。这是有意的请求节流，但依赖数组里出现表达式会让 ESLint exhaustive-deps 永久告警且语义不可读，建议加注释固化（当前无注释）。

**F-w9-ds2-desktopfeat-b-24 | P3 | settings/SettingsViews.tsx:221-229 | suspected** — `DataManagementView` 无条件 2 秒轮询 `ipcCloudSyncGetLocalStatus` + `ipcDbStats`（后者含 `stat(dbPath)` + `PRAGMA freelist_count` + KKV 标记读 + blob 采样缓存判定），页面失焦/后台也照跑。

**F-w9-ds2-desktopfeat-b-25 | P3 | workspace/workspace-batch-dnd.ts:371 | suspected** — `handleTreeDrop` 的非回落分支只 `clearActiveNativeDrag()`，不调 `clearStagingOnMain` / `removeStagedByRoot`（对比上方回落分支 `:359-361` 是全清的）。目前靠 `dragend → finalizeRowDrag` 兜底；若 dragend 因故不触发，main 侧 staging 目录会挂到 TTL。

**F-w9-ds2-desktopfeat-b-26 | P3 | workspace/workspace-batch-dnd.ts:218-223 | confirmed** — 注释说"prefetch 已失败且无 staged → toast（不可静默）"，但 `failedStagePaths.has()` 分支只 `delete` 标记就 `return false`，**不弹任何 toast**。注释与行为不符。

**F-w9-ds2-desktopfeat-b-27 | P3 | chat/ChatHistorySearchPanel.tsx:36 | confirmed** — `projectId` prop 收下改名 `_projectId` 后完全不用（链接路由统一走 ShellNavProvider 上下文，注释 :40-42 已说明）。死 prop，可删以免误导。

**F-w9-ds2-desktopfeat-b-28 | P3 | chat/ConversationPanel.tsx:347-360 | confirmed** — 草稿持久化 effect 依赖数组含 `composerAttachments`，但写入体恒为 `attachments: []`；每次 chip 变化都会白跑一次 `ipcSessionsSetComposerDraft`。

**F-w9-ds2-desktopfeat-b-29 | P3 | chat/conversation-batch.ts:47-59 | confirmed** — `flushRef.current = () => {...}` 在**渲染体内**给 ref 赋值（闭包捕获当帧 `onTextFlush/onThinkingFlush`）。并发渲染下被丢弃的渲染可能留下陈旧闭包；React 18 官方不保证渲染期写 ref 的可见性。当前靠「flush 回调都是 useCallback 且语义幂等」侥幸无害。

## 争议与存疑

1. **`setDirRuleEnabled` 只传 `ruleEnabled` 会不会清空其它字段？——不会，非缺陷。** `workspace-actions.ts:221-225` 只发 `{...req, logicalPath, ruleEnabled}`，`sortField` 等为 `undefined`。core `packages/core/src/service/workplace/impl/workplace.service.ts:133-152` 用 `input.sortField ?? existing?.sortField ?? DEFAULT_WORKPLACE_DIR_RULE.sortField` 逐字段合并，`upsertDirRule` 拿到完整行。**标 intentional**，不是问题。

2. **目录规则表单不提供启用开关、`emptyDirRuleForm` 初始 `ruleEnabled: false`——与 RULE 一致。** RULE「工作区与存储层 · 目录规则」写明「无规则行 = rule_off」「启停由文件管理菜单的快捷开关负责，根目录规则不可关闭」。`DirectoryRuleModal.tsx:166-167` 的注释与 `rootRuleLocked → ruleEnabled: true`（`:101,:128`）都是拍板产物。**标 intentional**。

3. **批注 store 在 main / renderer 双进程各持一份、回滚时两侧清空语义不同——已拍板。** `chat/rollback-annotate-restore.ts:36-38` 注释明写「main 进程的 annotate store 与 renderer 是各自独立的进程内 store，main 侧仍按 Bug1 既定逻辑无条件清；本函数只负责 renderer 侧的语义对齐」。**标 intentional**，但 F-6 的 StrictMode 双调用会在这套已对齐的语义上再叠一层重复，仍需修。

4. **`ConversationPanel.tsx:409-454` 的「前奏终态强制 reload」大段注释** 是 r3-run-1 步骤 4 的拍板产物（`runId === ''` 时 `shouldApplyTranscriptReload` 两个判据都不满足，会导致「消息凭空消失」），代码与注释一致。**标 intentional**，非逻辑缺陷。

5. **F-13 的实际严重度取决于转录长度**，未实测。50 条以内基本无感；若产品允许上千条消息的会话，建议按 P2 处理并补一条「长转录流式帧率」的性能断言。

6. **F-12 的 staging 成本取决于单文件体积。** core 的批量导入会跳过非 UTF-8 文件（`workspace-batch-dnd.ts:278`），故 VFS 内以文本为主；但 ZIP 导入可带入大文本文件。是否需要「超过 N MB 不预取」的门限，未与产品确认。

7. **`tool-turn-actions.ts` 的 `hideToolTurn` / `deleteToolTurn` 在 `features/` 内无调用方**（全仓计数 2 = 定义 + 测试），推测由 `layout/ChatRail` 或后续批量模式消费；未在本次范围内核实，若确为死路径应与 F-17 合并处理。

8. **`ipcMessagesHideRange` / `ipcMessagesShowRange` / `ipcMessagesTruncateAfter` / `ipcWorkplaceCaptureSessionBlock` 四个通道在客户端已注册（`invoke-registry.ts:94,96,86`）但本区零调用**（`handleWorkplaceCaptureSessionBlock` 在 main 侧注释自称「已退役，UI 入口将在 Step 9 删除」）。是否还有其他消费方（`layout/`）需跨区确认，本区只报「本区无调用」。

## 附：实测方法说明

- 行数/文件数：`node` 脚本遍历 `git ls-files apps/desktop/renderer/features` 逐文件 `split('\n').length` 求和 = **18361 行 / 77 文件**。
- 类型错误分布：`npx tsc --noEmit -p apps/desktop/tsconfig.renderer.json`（原始输出留档 `tmp/w9b-tsc.txt`），按路径前缀过滤出本区 160 条，按文件聚合如 F-1 所列。
- 死导出：全仓语料（`apps/desktop` + `packages` + `apps/cli` + `apps/mobile/src`，`*.ts/tsx/mjs/js`）符号计数 ≤1 判定为零引用。
- scratch 脚本落在 `D:\Dev\nm-worktree\mcr\tmp\`（`w9b-*.mjs` / `w9b-tsc.txt`），仓库 `.gitignore` 已忽略 `tmp/`；未写盘根、未写家目录、未做任何 git 写。