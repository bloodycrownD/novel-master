---
zone: desktop-features
agent: domain-survey
files_scanned: 77
scope: apps/desktop/renderer/features/{chat,settings,skills,workspace}
lines_scanned: 18361
---

# W2 · desktop-features 按域测绘

## 摘要

Electron renderer 的四个功能域 UI 层。`chat/` 是会话主面板（转录列表、composer、批注草稿 store、
abort-retain 收尾链路、消息批量可见性）；`settings/` 是设置栈全部视图（智能体编辑器、服务商/模型、
搜索引擎、存储迁移、数据统计饼图/图表、备份与云同步）；`skills/` 是技能新建/编辑/选择弹窗与域徽标；
`workspace/` 是 VFS 文件树、右键菜单、目录规则表单、批量拖入/拖出编排。全部通过 `@shared/ipc-types`
的 DTO + `@shared/logic/*` 纯函数层拿数据，renderer 侧被 X1 门禁禁止直接 import core（故
`apps/desktop/shared/logic/` 存在 core 纯函数的 renderer 镜像副本）。

## 职责与边界

- **不碰数据**：无 SQL、无 KKV、无文件直读。唯一"数据访问"是经 `@/ipc/client` 的 invoke；
  唯一的本地状态持久化是 `ipcSessionsSetComposerDraft` / `ipcAppUiSet`。
- **纯逻辑大量已被上提**：绝大多数文件是 `@shared/logic/chat`、`@shared/logic/workplace`、
  `@shared/logic/skills` 的薄 re-export（`chat-annotate-draft.ts`、`composer-at-path.ts`、
  `composer-send-intent.ts`、`transcript-selectable-role.ts`）。
- **真遗留**：本域仍有 ~10 处"本该上提到 `@shared/logic` 却各端各写一份"的纯函数，以及
  一批 0 消费者的孤儿模块（见发现清单 P1-1 / P3 组）。
- **renderer 禁 import core（X1 门禁）** 是 `apps/desktop/shared/logic/usage-stats-format.ts:1-6`
  自述的成因——它把 core 的 `usage-stats-format` 结构等价复制了一份。这条是**有意为之**，标
  intentional；但同域内其它未被上提的重复（toLocalDayKey / hitRate / prompt-macro-input /
  lastRowBilledInput）没有这条借口。

## 对外接口（导出且被外部消费的符号）

| 符号 | 位置 | 消费方 |
|---|---|---|
| `buildChatListItems` | chat/message-blocks.ts:257 | MessageList.tsx、transcript-selectable-role.ts |
| `applyUndoAnnotateRestore` | chat/rollback-annotate-restore.ts:42 | ConversationPanel.tsx:59 |
| `resolveComposerDraftAfterRollbackSuccess` | chat/rollback-composer.ts:14 | ConversationPanel.tsx:58 |
| `handleRunFinishedAbortRetain` / `handleStepCommittedAbortRetain` / `shouldReloadOnRunFinished` | chat/conversation-abort-retain.ts | ConversationPanel.tsx:61-65 |
| `useConversationBatch` | chat/conversation-batch.ts:34 | useAgentStream 链路 |
| `resolveChatLinkAction` | chat/chat-link-route.ts:54 | ShellNavProvider 侧链接路由 |
| `MetricsDetailPopover` / `MetricsDetailPanel` / `useSessionUsageDetail` | chat/MetricsDetailPopover.tsx | ConversationPanel.tsx:69 |
| `SETTINGS_NAV` / `SETTINGS_TOP_LEVEL` / `shouldGuardSettingsNav` / `isSameSkillRef` | settings/settings-nav.ts | SettingsOverlay.tsx |
| `migrationRowValue` / `MIGRATION_ROWS` | settings/migration-row-value.ts:14,34 | SettingsViews.tsx:148-149,593 |
| `TokenUsageStatsView` | settings/TokenUsageStatsView.tsx:371 | SettingsOverlay 视图表 |
| `dispatchOpenSettingsView` / `OPEN_SETTINGS_VIEW_EVENT` | skills/skill-ui.ts:88,94 | App + SettingsOverlay |
| `buildNewSkillDoc` / `isValidSkillNameInput` / `toSkillRef` | skills/skill-ui.ts | NewSkillModal、SkillInfoEditModal、SkillPicker、SkillDetailView |
| `scopeRequestFromTarget` / `createWorkspaceEntry` / `renameWorkspaceEntry` / `deleteWorkspaceEntry` / `loadDirRuleForm` / `setDirRuleEnabled` | workspace/workspace-actions.ts | ExplorerPane、DirectoryRuleModal |
| `syncPreviewTabsWithFileRows` / `markPreviewTabsDeletedUnderPathInList` | workspace/preview-tab-sync.ts | ShellNavProvider / PreviewPane |
| `handleTreeDrop` / `prefetchExportStage` / `finalizeRowDrag` / `moveVfsPathsToDir` | workspace/workspace-batch-dnd.ts | WorkspaceTree.tsx、ExplorerPane.tsx |
| `resolveMoveDestination` / `dropTargetDir` / `isSelfOrAncestorPath` / `NM_VFS_PATHS_MIME` | workspace/vfs-tree-dnd.ts | WorkspaceTree.tsx、ExplorerPane.tsx |

## 数据访问

本域无直接 DB/KKV 访问。全部经 IPC：

| 数据 | 通道 | 证据 |
|---|---|---|
| 消息列表 / 回滚 / 置位 / 分叉 / 编辑 | `ipcMessagesList` / `ipcMessagesRollback` / `ipcMessagesSetFloor` / `ipcMessagesFork` / `ipcMessagesEdit` | chat/ConversationPanel.tsx:27-33 |
| 消息 hide/show/delete（工具轮次成对） | `ipcMessagesHide` / `ipcMessagesShow` / `ipcMessagesDelete` | chat/tool-turn-actions.ts:6-8 |
| Composer 草稿读写 | `ipcSessionsGetComposerDraft` / `ipcSessionsSetComposerDraft` | chat/ConversationPanel.tsx:36-37,359 |
| 状态条投影 | `ipcSessionsProjectComposerStatus` | chat/ConversationPanel.tsx:37,322 |
| VFS / 工作区规则 | `ipcVfsRead/Write/Mkdir/Delete/Rename` / `ipcWorkplaceGet|SetDirRule` / `ipcWorkplaceSetFileRule` | workspace/workspace-actions.ts:11-18 |
| 树行列表 | `ipcWorkplaceBuildListRows` / `ipcPhysicalList` | workspace/WorkspaceTree.tsx:8-9 |
| 批量拖入/拖出 | `ipcVfsBatchIngestFromPaths` / `ipcVfsBatchExportStage` / `ipcVfsBatchClearStaging` | workspace/workspace-batch-dnd.ts:12-18 |
| 技能 | `ipcSkillsList/Write/AssertCreateName` | skills/NewSkillModal.tsx:18-22 |
| Token 统计 | `ipcUsageStatsQuery`（单 channel 按 kind 分发：summary/daily/hourly/modelBreakdown/requests/models/sessionDetail） | settings/TokenUsageStatsView.tsx:17,431-433,499,544,583,588；chat/MetricsDetailPopover.tsx:57 |
| 存储统计（迁移行数据源） | `ipcDbStats` | settings/SettingsViews.tsx:184,224 |
| 提示词预览 | `ipcPromptRealPreview` | chat/RealPromptPanel.tsx:57 |
| 链接探测 | `ipcVfsRead`（`workspaceScope: "chat"` 先 / `"session"` 后） | chat/chat-link-route.ts:74,90 |
| UI 偏好 | `ipcAppUiGet('chatRichText')` | chat/ConversationPanel.tsx:363 |

## 依赖关系

**import 谁**
- `@shared/ipc-types`（DTO，16 文件）、`@/ipc/client`（invoke，8 文件）
- `@shared/logic/chat`、`workplace`、`skills`、`prompt`、`search-engines`、`vfs`、`agent`、`config-forms-agent`
- `@shared/logic/format-token-count`、`hit-rate`、`usage-stats-format`（X1 门禁下的 core 镜像）
- `@/providers/ShellNavProvider`（工作区/预览/链接路由的接线点）
- `@novel-master/core/events`（仅类型）

**被谁消费**
- `layout/ChatRail.tsx`、`layout/ExplorerPane.tsx`、`layout/PreviewPane.tsx`、`layout/SettingsOverlay.tsx`、
  `providers/ShellNavProvider.tsx`、`hooks/useAgentStream.ts`（经 ConversationPanel）
- 测试：`apps/desktop/test/**`（vfs-tree-dnd-move、token-usage-stats-view、composer-body-clear、
  conversation-panel-abort、skill-zip-import 等）

**依赖异常**：`@novel-master/core/events`（ConversationPanel.tsx:18）与 `@shared/logic/*` 混用，
前者是 type-only，不违反 X1。

## 发现清单

### P0
无。

### P1

**F-desktop-features-1 | P1 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:176`**
```
export const AgentDefinitionEditorForm = forwardRef<
  AgentDefinitionEditorFormHandle,
  AgentDefinitionEditorFormProps
>(function AgentDefinitionEditorForm(
```
整个 1048 行文件是**孤儿**：全仓（含测试）零 importer、零测试引用（`AgentDefinitionEditorForm` /
`AgentDefinitionEditorFormHandle` 的全部 7 处命中都在文件自身）。它与 `AgentEditorView.tsx`
（1382 行）内联的同一套智能体定义表单是近逐字重复——两份各自持有 `savedBaseline` state 并用
**逐字相同**的一行判 dirty：
- `AgentEditorView.tsx:630` → `const dirty = savedBaseline != null && snapshot !== savedBaseline;`
- `AgentDefinitionEditorForm.tsx:340` → 同一行

即设置里存在两套共约 2400 行的智能体编辑器，其中一套从未被挂载。
**建议**：先确认 `AgentEditorView` 是否计划迁到 Form 组件（Form 已具备 `onDirtyChange` /
`isDirty` handle，而 AgentEditorView 都没用，见 F-3）；若不迁，直接删 Form 文件；若迁，
删 AgentEditorView 里的内联副本。删前用 `git log` 确认 Form 不是被回滚掉的半成品。
**置信**：confirmed

**F-desktop-features-2 | P1 | `apps/desktop/renderer/features/skills/skill-ui.ts:21-35`**
```
export function buildNewSkillDoc(name: string, description: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
```
桌面端把 name/description **裸拼**进 YAML front matter。mobile 的孪生实现
（`apps/mobile/src/components/skills/skill-ui.ts:53-71`）已修：
```
function yamlScalar(value: string): string { return JSON.stringify(value); }
...
`name: ${yamlScalar(name)}`,
```
并注明「description 含冒号 / 引号 / 换行时不会破坏 front matter 解析」。core 的
`packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts:10-11` 把这条定为口径：
「值一律写 YAML 双引号标量（JSON 字符串即合法 double-quoted scalar），含冒号 / 引号 / 换行的
描述不会破坏解析」。

后果链：桌面端 `NewSkillModal.tsx:199` 用裸拼模板写盘 → 用户描述里出现半角 `": "`（如
`"Note: 写作"`，全角 `：` 不触发）时，`parseSkillFrontMatter`
（`packages/core/src/domain/skills/logic/parse-skill-front-matter.ts:51`）YAML 解析抛错 →
返回 `valid:false, invalidReason:"front matter 不可解析：…"` → 技能**刚建出来就在管理列表里显示
无效**。`NewSkillModal` 对 description 只校验非空（`canSubmit`），无字符集拦截。
**建议**：`buildNewSkillDoc` 复用 core 的 `withSkillFrontMatterValues`（`@shared/logic/skills`
已再导出）或照抄 mobile 的 `yamlScalar`；更彻底的做法是把 `buildNewSkillDoc` 整体上提到
`@shared/logic/skills` 消掉双份模板（现在两端的"使用说明"正文文案也已漂移：desktop 一句注释，
mobile 五行 bullet）。
**置信**：confirmed

**F-desktop-features-3 | P1 | `apps/desktop/renderer/features/settings/AgentEditorView.tsx:630`**
```
const dirty = savedBaseline != null && snapshot !== savedBaseline;
...
: `编辑 ${displayName}${dirty ? " · 未保存" : ""}`
```
`dirty` 只用来在标题上挂个「· 未保存」角标，**没有上报到设置导航守卫通道**。而
`settings-nav.ts:99` 定义的 `SettingsNavHandle.dirtyViews` 是 `SettingsOverlay.tsx:127`
「统一导航守卫入口」的唯一读侧（经 `shouldGuardSettingsNav`，settings-nav.ts:158）。全仓
`dirtyViews.add` 只有一处调用：
```
apps/desktop/renderer/features/settings/SkillDetailView.tsx:142:    nav.dirtyViews.add("skillDetail");
```
即：技能详情页编辑后离开会弹「有未保存的更改，离开将丢弃。是否继续？」，**智能体编辑器
（设置里最大的一块编辑面）不会**——切走/关设置/点导航全部静默丢弃编辑。这正是
`SettingsOverlay.tsx:127` 注释里说的"统一守卫"没覆盖到的漏网 view。
（`AgentDefinitionEditorForm` 提供了现成的 `onDirtyChange` prop，AgentEditorView 也没接。）
**建议**：AgentEditorView 起一个与 SkillDetailView 同款的 effect 往 `nav.dirtyViews` 写
`"agentEditor"`，或在 `SETTINGS_TOP_LEVEL` 之外把守卫改成"有 dirty 的 view 白名单"。
**置信**：confirmed

### P2

**F-desktop-features-4 | P2 | `apps/desktop/renderer/features/settings/prompt-macro-input.ts:25-138`**
`isWhitelistRootMacroInner` / `findWhitelistMacroRanges` / `tryAtomicMacroDelete` /
`insertTextAtSelection` / `PROMPT_INSERTABLE_MACROS` / `WhitelistMacroRange` 与
`apps/mobile/src/components/agent/prompt-macro-input.ts:28-161` **逐字同构**（仅 prettier
引号风格与空行差异）。文件头自述"（与 Mobile prompt-macro-input 对齐）"，并已把宏白名单
`ALLOWED_DYNAMIC_ROOT_MACROS` 从共享层取（desktop 走 `@shared/logic/prompt`、mobile 走
`@novel-master/core/prompt`）——**只把常量提上去了，解析层没提**。
**建议**：整份上提到 `@shared/logic/prompt`（X1 门禁要求 renderer 不 import core，正好这个
共享层就是为此存在）。desktop 独有的 `renderPromptMacroHighlightHtml`（:70，产 HTML 给
高亮层）可留在 desktop。
**置信**：confirmed

**F-desktop-features-5 | P2 | `apps/desktop/renderer/features/chat/MetricsDetailPopover.tsx:26-40`**
```
/** 单行计费口径输入（与 core BILLED_INPUT_SUM_SQL 的单行版一致）。 */
function lastRowBilledInput(last: NonNullable<SessionUsageDetailDto["last"]>): number {
  ...
  // anthropic 的 input_tokens 不含 cache，须加回 cache 双列；其余协议
  // prompt 已含 cached（与统计页口径一致，公式单源随 tl 后续抽 core）。
```
同一条计费公式的**第三份副本**：`packages/core/src/service/chat/impl/usage-stats.service.ts:40`
（`BILLED_INPUT_SUM_SQL`，权威）+ `apps/mobile/src/components/sheet/MetricDetailSheet.tsx:28`
（`MetricDetailSheet.tsx:28` 同名同义）。注释自己承认"公式单源随 tl 后续抽 core"——即
**已知待办，不是 intentional 设计**。RULE「用量统计层」条目已把该口径写死为 core 单源。
**建议**：随该 TODO 一起把单行版公式也放进 core 导出，双端各留一行 re-export。
**置信**：confirmed

**F-desktop-features-6 | P2 | `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:51-64`**
```
function toLocalDayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  ...
function dayKeyOffset(offsetDays: number): string { ... }
```
与 `apps/mobile/src/screens/stack/token-usage/format.ts:35` (`toLocalDayKey`) / `:44`
(`localDayKeyOffset`) 逐字重复。同域的
`apps/desktop/shared/logic/usage-stats-format.ts` **本来就是为统计页纯函数而设的镜像层**
（首行自述"统计页展示层纯函数（desktop 侧）"），却没收这两个；`formatDurationMs` /
`formatHitRate` 收了，`toLocalDayKey` 没收。日期键是 `selectedDay` 与 `dailyBuckets` 的
匹配键（:615, :1000），双份漂移会直接表现为"点柱钻取不到当天"。
**建议**：把 `toLocalDayKey` / 日偏移 / `parseLocalDate` 收进 `usage-stats-format.ts`，
desktop 与 mobile 各自 re-export；顺带把 mobile 的 `formatTokensPerSecond`（:102）也收
（desktop 侧副本见 F-24）。
**置信**：confirmed

**F-desktop-features-7 | P2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:221-229`**
```
useEffect(() => {
  const timer = window.setInterval(() => {
    void reloadStatus();
    void reloadDbStats();
  }, 2000);
  return () => { window.clearInterval(timer); };
}, [reloadStatus, reloadDbStats]);
```
备份与恢复视图挂载期间，**每 2 秒**无条件打两条 IPC：
- `ipcCloudSyncGetLocalStatus`（:175）
- `ipcDbStats`（:184）→ `getDbMaintenanceStats`（`apps/desktop/src/main/services/db-maintenance.service.ts:26`）
  = 一次 `fs.stat` + `maintenance.getStorageStats()`（PRAGMA freelist）+ `sampleBlobBinaryStatus`
  + `sampleMessageCompactionStatus`。

无 `isAgentActive` 守卫、无 `document.visibilityState` 暂停、无值 diff——`reloadDbStats` 无条件
`setDbStats(...)`（新对象），导致整个 DataManagementView 每 2 秒重渲一次。存储迁移状态行
（任务点名的「存储迁移行」，`SettingsViews.tsx:593-618`）就挂在这个轮询上。
**建议**：拉长到 10-15s；或加 `document.hidden` 早退；或对 `fileBytes`/`reclaimableBytes`/
各 status 做 diff 后才 setState；或只在"有任一迁移未完成"时才高频轮询。
**置信**：confirmed

**F-desktop-features-8 | P2 | `apps/desktop/renderer/features/workspace/WorkspaceTree.tsx:197-207`**
```
const handleRowPointerDown = useCallback((e, row) => {
  if (isPhysical) { return; }
  e.stopPropagation();
  // 失败时 prefetchExportStage 内部已 toast
  void prefetchExportStage({ scope: req, logicalPath: row.path });
}, [isPhysical, req]);
```
`onPointerDown` 无条件触发 `prefetchExportStage` → `ipcVfsBatchExportStage` →
**把该文件完整物化到 userData 临时目录**（`vfs-batch.service.ts:295-332`：mkdir + 逐文件
copy + startDrag 路径组装）。触发条件只是"鼠标按下任意树行"：单击选中、右键弹菜单、
方向键浏览都会各物化一次整个文件。

清理侧只在 `onDragEnd`（:267-270 → `finalizeRowDrag`）里做，而 HTML5 `dragend` 在"按下+抬起
无位移"时**不触发**，所以普通单击的 staging 只能等 main 侧兜底：
```
apps/desktop/src/main/services/vfs-batch.service.ts:240-241
/** 未显式清理时 main 侧兜底回收 staging 目录。 */
const STAGING_TTL_MS = 5 * 60 * 1000;
```
这个 5 分钟 TTL 是**有意的兜底**（标 intentional，不当问题报），但它只兜住磁盘，不兜住
"每次点击都做一次全文件磁盘物化"的成本，也不兜 renderer 侧 `stagedByPath` 的条目滞留
（:191）——5 分钟内再拖同一行会用已 TTL 删除的 `filePaths` 调 `startDrag`（:231）。
**建议**：把 prefetch 触发从 `pointerdown` 改到能区分"真的要拖"的信号（`dragstart` 里
同步发起代价已高，可考虑 pointerdown + 阈值位移/定时器取消），或至少在 `onClick`
/`onContextMenu` 时 `releaseStagedExport(row.path)`。
**置信**：confirmed

**F-desktop-features-9 | P2 | `apps/desktop/renderer/features/workspace/WorkspaceTree.tsx:99-105`**
```
setExpandedDirs(
  new Set(
    result.data.filter((row) => row.kind === "dir").map((row) => row.path),
  ),
);
```
`reload()` 把 `expandedDirs` 整体重置为"所有目录全展开"，用户的折叠状态被无条件丢弃。
`reload` 的触发方包含 `refreshToken`（:112-114）与 `onMutated`（:146-148 →
`notifyWorkspaceMutated`，agent 每次写盘都触发）——即**智能体每写一个文件，用户手动折叠的
目录就全部重新弹开**。`treeExpandRequest` effect（:116-127）只能"加不能减"，救不回折叠态。
**建议**：`setExpandedDirs` 改为在 prev 基础上并集（保留折叠），或按"用户已显式折叠集合"
（`collapsedDirs: Set<string>`）与"全展开默认"取差。
**置信**：confirmed

**F-desktop-features-10 | P2 | `apps/desktop/shared/logic/hit-rate.ts:12`**
```
export function hitRate(cacheRead: number | null, billed: number): number | null {
  if (cacheRead == null || billed <= 0) { return null; }
  return cacheRead / billed;
}
```
mobile 孪生 `apps/mobile/src/screens/stack/token-usage/format.ts:55`：
```
export function hitRate(cacheRead: number, billed: number): number | null {
  if (billed <= 0) { return null; }
  return cacheRead / billed;
}
```
**语义分叉**：单行请求无 cache 列（`cacheRead == null`）时，desktop 显示「—」、mobile 会算出
0%（或 NaN 取决于调用方是否先 `?? 0`）。这是同一个产品指标在两端给两个答案的典型双实现漂移。
`formatHitRate` 两份逐字相同。RULE「用量统计层」条目把计费口径写为 core 单源，但命中率
**展示**函数从没被收上 `@shared`。
**建议**：合并到 `@shared/logic/hit-rate`（desktop 侧已是该形态），mobile 改为 re-export；
调用方对 null 的处理口径须一并拍板（建议统一「—」）。
**置信**：confirmed

### P3

**F-desktop-features-11 | P3 | `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts:1`（整文件）**
`usePreviewSelection` / `useTreeRefreshToken` / `useTreeLoader` 三个 hook 全仓零引用
（`useWorkspaceTree` 这个名字本身在仓内也只出现在文件名里）。67 行整文件孤儿。
对照：`usePreviewSelection` 的能力实际由 `providers/ShellNavProvider` 承担。
**建议**：删文件。**置信**：confirmed

**F-desktop-features-12 | P3 | `apps/desktop/renderer/features/workspace/vfs-tree-utils.ts:59`**
`isDescendantPath` 零引用。**建议**：删。**置信**：confirmed

**F-desktop-features-13 | P3 | `apps/desktop/renderer/features/workspace/vfs-tree-dnd.ts:90,95`**
`hasNmVfsMime` / `hasFileDrag` 零引用——两个调用点各自内联了同样判断：
- `WorkspaceTree.tsx:154-155` → `types.includes("Files") || types.includes(NM_VFS_PATHS_MIME)`
- `ExplorerPane.tsx:69` → `types.includes("Files") || types.includes(NM_VFS_PATHS_MIME)`
**建议**：改用 helper（顺带消掉两处 `"Files"` 字面量），别直接删。**置信**：confirmed

**F-desktop-features-14 | P3 | `apps/desktop/renderer/features/workspace/vfs-tree-dnd.ts:36-47`**
```
if (sourcePath === targetDir) { return true; }   // :40
if (sourcePath === "/") { return true; }          // :43
return targetDir === sourcePath || targetDir.startsWith(`${sourcePath}/`);  // :46
```
:46 的第一个析取项 `targetDir === sourcePath` 与 :40 完全重复，永不可达为新分支。
**建议**：删掉该析取项。**置信**：confirmed

**F-desktop-features-15 | P3 | `apps/desktop/renderer/features/chat/message-edit.ts:24`**
`applyTextEditToContentBlocks` 零引用（生产与测试皆无）——`MessageEditModal` 走的是
`ipcMessagesEdit`（ConversationPanel.tsx:31）。**建议**：删。**置信**：confirmed

**F-desktop-features-16 | P3 | `apps/desktop/renderer/features/chat/rollback-composer.ts:34-45`**
```
/** @deprecated 使用 {@link resolveComposerDraftAfterRollbackSuccess} */
export function resolveComposerTextAfterRollbackSuccess(
```
自标 `@deprecated` 且零引用。**建议**：删。**置信**：confirmed

**F-desktop-features-17 | P3 | `apps/desktop/renderer/features/chat/transcript-selectable-role.ts:30`**
`buildTailBatchRows` 零引用；同文件的 `MessageBatchMode` 也仅本文件出现。
**建议**：确认 tail 批量模式是否已整体退役，是则连 `MessageBatchMode` 一起删。**置信**：suspected

**F-desktop-features-18 | P3 | `apps/desktop/renderer/features/settings/settings-ui.tsx:95-107`**
`SettingsToolbar` 零引用；其 class `settings-toolbar` 在同文件 :86 已被内联使用。
**建议**：删组件，保留 :86 的内联。**置信**：confirmed

**F-desktop-features-19 | P3 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:315`**
`usePickerData` 零引用。**建议**：删（注意它可能有配套 state 一并可清）。**置信**：confirmed

**F-desktop-features-20 | P3 | `apps/desktop/renderer/features/chat/MessageList.tsx:113`**
```
streamTailGenerating: _streamTailGenerating = false,
```
解构即弃（`_` 前缀），组件内"生成中"尾巴实际由 `uiRunning` 驱动（:238）。
上游 `ConversationPanel.tsx:610,999` 仍在传 `streamTailGenerating={running}`，而
`useChatMessagesScrollFollow.ts:126,134` 是它的**另一个**真实消费方。
**建议**：从 `MessageListProps` 与两处调用点删掉该 prop（scroll hook 那条链留着）。**置信**：confirmed

**F-desktop-features-21 | P3 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:347-360`**
```
  }, [sessionId, composerText, composerAttachments, readOnly]);
```
草稿持久化 effect 的依赖里有 `composerAttachments`，但函数体写死 `attachments: []`——
`composerAttachments` 是幽灵依赖。状态条（workplace/annotate chip）每次随流式更新而变，
每次都触发一次多余的 `ipcSessionsSetComposerDraft` 写库。
**建议**：从依赖数组去掉 `composerAttachments`（若将来真要持久化 attach 再加回）。
**置信**：confirmed

**F-desktop-features-22 | P3 | `apps/desktop/renderer/features/settings/migration-row-value.ts:34-62`**
四个状态文案（`'—'` / `'已完成'` / `'进行中（剩余 N 条）'` / `'已完成（N 条需人工处理）'`）与
三态 tone 映射，与 `apps/mobile/src/screens/stack/storage-config-migration-values.ts:23-59`
逐字重复（仅字段名 `text` vs `value`、解构风格不同）。桌面用 `MIGRATION_ROWS` 驱动，
mobile 是两个独立函数——同一批字面量在两个仓内各存一份。
**建议**：把文案+tone 收进 `@shared/logic`（或 core `db-maintenance` 导出），两端共用。
**置信**：confirmed

**F-desktop-features-23 | P3 | `apps/desktop/renderer/features/skills/skill-ui.ts:10-18`**
`skillDomainLabel(domain, overridden)` 与 mobile `apps/mobile/src/components/skills/skill-ui.ts:14`
的 `skillDomainBadgeLabel` 是同三态（全局 / 项目 / 项目·覆盖全局）的两份实现，分支顺序相反、
函数名不同。`buildNewSkillDoc`（见 F-2）与 `isValidSkillNameInput` 也是双份
（mobile 侧后者散在别处）。**建议**：随 F-2 一并把 `skill-ui` 整体上提。**置信**：confirmed

**F-desktop-features-24 | P3 | `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:93-98,47-48`**
```
function formatTokensPerSecond(v: number | null): string { ... return "—"; }
const MODEL_OPTION_ALL = "__all__";
const MODEL_OPTION_UNLOGGED = "__unlogged__";
```
与 mobile `apps/mobile/src/screens/stack/token-usage/format.ts:102`
（`formatTokensPerSecond(v, emptyText)`，多一个空态参数）与 `:23-24`（两个哨兵常量 +
`MODEL_OTHER_KEY`）重复。desktop 侧把空态硬编码成 `'—'`，mobile 侧由调用方传——
若统一文案需改两端。`REQUESTS_PAGE_SIZE` 双端不同（desktop 50 / mobile 10）是**有意的**
平台差异，不算问题。
**建议**：随 F-6 一起收进 `usage-stats-format` 共享层。**置信**：confirmed

**F-desktop-features-25 | P3 | `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:85,107,111`**
`isPrefetchInFlightForTest`（自标 `@internal 测试辅助`，但仓内无任何测试引用它）、
`getActiveNativeDrag`、`clearActiveNativeDrag`（:371 内部直接改模块变量，绕过了这个 setter）
三者零外部引用。**建议**：前两个删；`clearActiveNativeDrag` 要么用起来要么删。**置信**：confirmed

**F-desktop-features-26 | P3 | `apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:387,438-460,509-511`**
`loadError` 是**单一 state 槽**，被两条互不相干的链路共用：`reload`（汇总/图表，:439/443/448/458）
与 `loadRequests`（流水分页，:510/519）。后果两条：
1. 流水分页失败会把汇总链路的错误文案顶掉（反之亦然），用户看到的报错可能属于另一个页签的数据。
2. `reload` 的三条错误早退（:438-449）都发生在 `setHourlyBuckets(null)`（:471）与
   `setSelectedSliceKey(null)`（:474）**之前**——筛选已变但查询失败时，上一轮的按天图、饼图
   选中态、小时钻取会**原样留在屏幕上**，只是上面多了一行红字，看起来像新数据。
**建议**：`loadError` 拆成 `summaryError` / `requestsError`；`reload` 失败路径也先清
`hourlyBuckets` / `selectedDay` / `selectedSliceKey`。**置信**：confirmed

**F-desktop-features-27 | P3 | `apps/desktop/renderer/features/chat/MetricsDetailPopover.tsx:235-243`**
```
useLayoutEffect(() => {
  const rect = anchorEl.getBoundingClientRect();
  setPosition({ top, left });
}, [anchorEl]);
```
弹窗位置只在 `anchorEl` 变化时算一次，**无 scroll / resize 重定位**。聊天区滚动时弹窗会与
指标条脱开；窗口缩放后可能停在视口外。**建议**：监听 `scroll`（capture）+ `resize` 重算，
或改用 CSS `position: fixed` + 锚点属性。**置信**：confirmed

**F-desktop-features-28 | P3 | `apps/desktop/renderer/hooks/useStreamTailGenerating.ts:9` 与
`apps/mobile/src/hooks/useStreamTailGenerating.ts:11`**
两端同一个一行 hook：`return { streamTailGenerating: uiRunning }`，无任何逻辑。
**建议**：并入 `useChatMessagesScrollFollow` 或直接删（调用方传 `uiRunning` 即可）。**置信**：confirmed

**F-desktop-features-29 | P3 | `apps/desktop/renderer/features/chat/composer-body-clear.ts:7-10`**
```
/** started/ok 路径是否清正文。恒 false。 */
export function shouldClearComposerBodyAfterAgentStarted(): boolean {
  return false;
}
```
唯一生产调用点 `ChatComposer.tsx:396` 因此是**恒假分支**。文件头与 ChatComposer:395 的注释
都写明这是"B4 契约钉死"的故意设计（`composer-body-clear.test.ts:12` 断言其返回 false）。
**标 intentional**（依据：同文件 :2-5 的 B4 说明 + :7 注释 + ChatComposer:395 注释 + 配套测试），
不当缺陷报。仅提示：RULE「验收断言的牙齿」条目下，这类"实现恒定、测试断言恒定值"的钉死
在契约翻转时不会提醒任何人，若将来要恢复"started 清正文"，得记得同步删这层恒假间接。
**置信**：intentional

**F-desktop-features-30 | P3 | `apps/desktop/renderer/features/chat/message-blocks.ts:58-110`**
同一文件里两套 tool_use↔tool_result 配对算法：
- `resolveToolResultsMessageId`（:58）——逐条 user 消息、要求**一条消息内集齐全部** toolUseId、
  跳过 `seq <= assistant.seq` 的消息；
- `turnToolResultsComplete`（:100）——经 `buildToolResultByUseId`（:83）建**全表** Map，
  再 `required.every(id => results.has(id))`，不要求同一条消息、也不看 seq。

后者是前者的超集（更宽松）。两者的差异被 `lastIncompleteToolAssistant`（:112）放大成
"哪条 assistant 卡片显示 pending"的行为差异。`hideToolTurn`（tool-turn-actions.ts:29,35）与
`deleteToolTurn`（:48）用严格版决定"要不要连带 hide/delete tool_result 消息"——
即**配对判据不同源**。若某轮的 tool_result 被拆进两条 user 消息（协议允许），
严格版找不到配对消息 → 隐藏/删除只动 assistant，tool_result 残留可见。
**建议**：统一到一套判据（推荐全表 Map + per-assistant 过滤 `seq >`），让"卡片状态"与
"成对 hide/delete"共用。
**置信**：suspected

### 合计

P0×0　P1×3　P2×7　P3×20

## 争议与存疑

1. **F-1（AgentDefinitionEditorForm 孤儿）到底是废弃还是待迁移？** 我只能确认它零引用。
   若 git 历史显示它是被 `AgentEditorView` 内联重构"取代"的中间产物，处置是删；
   若 `AgentEditorView` 正计划瘦身迁到它，处置相反。**需要 W5 reduce 或主代理查
   `git log --follow` 定案**，我按代码现状报"死代码 + 双份"两条事实，不替产品拍板。

2. **F-2 的实际触发概率未实测。** YAML plain scalar 遇到 `: `（半角冒号+空格）必炸我有把握；
   但"用户在桌面端新建技能时会不会真打半角冒号"我没有真机证据。建议 W6 验证代理用
   `parseText('name: a\ndescription: Note: x', 'yaml')` 直接跑一次坐实，
   再决定 P1 分级是否需要下调。

3. **F-3 是否算 P1 取决于产品口径。** 「未保存的 agent 定义被静默丢弃」在功能上确实是数据丢失，
   但 `SettingsOverlay.tsx:127` 的注释只承诺"统一守卫入口"，从未承诺覆盖所有 view。
   若产品认为 agentEditor 走的是"标题栏 ·未保存 提示 + Ctrl+S"这条轻量路、不需要弹窗，
   那这就不是缺陷而是取舍。我按"与 skillDetail 行为不一致 + 通道已备好未接"报 P1，
   保留下调空间。

4. **F-7 的 2 秒轮询未见任何 guard 文档。** 注释只说"使 Agent 运行中等标志与 main 进程一致"，
   没有写"拍板接受"。但它也不像疏忽（代码里已有吞异常、已有 `dbStats` 失败保留旧值的处理），
   更像是"先这样"的临时态。我标 confirmed（机制确凿）但 P3→P2 的边界靠主代理裁决——
   若 `getBlobBinaryStatus` 在稳态下走 KKV 标记零 COUNT（像 `sampleMessageCompactionStatus`
   那样，:39 注释就明说了），那实际成本可能只有一次 `fs.stat` + PRAGMA freelist，
   严重性应下调。**我没读 `getBlobBinaryStatus` 的实现**，这是本次测绘的已知缺口。

5. **F-17（`buildTailBatchRows` / `MessageBatchMode`）判为 suspected。** 消息批量 hide/delete
   的 UI 入口在 `SessionDetailDrawer` / `ChatHistorySearchPanel` 一带，我只做了全仓符号检索
   （确认零引用），没有逐个组件核对"是否还有另一条不叫这个名的批量实现"。可能存在同名不同符号的
   活路径。留给 W3「死路径狩猎」机位复核。

6. **未覆盖的子集（诚实声明）**：`SettingsViews.tsx`（2508 行）我只定点读了状态块与迁移行
   （:160-230, :585-640），服务商/模型/智能排序/云同步的表单逻辑未逐行读；
   `AgentEditorView.tsx`（1382 行）与 `SearchEngineDetailView`/`SearchEnginesView` 只做了
   符号级追踪，未逐行。这三个大文件的**字段级**问题（表单校验、并发保存、脏状态）不在本轮
   结论覆盖范围内，建议 W3 补一台机位专读 settings 表单层。
