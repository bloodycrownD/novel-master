---
zone: w9-desktopfeat-pro
agent: 对抗机位·检察官（prosecutor）
files_scanned: 77（apps/desktop/renderer/features/{chat,settings,skills,workspace}，共 18361 行）
independence: 未读 raw/ 任何文件、未读 synth/ 任何文件；全部结论由本机脚本 + 直读代码得出
---

# W9 · desktop features 检察官报告

## 摘要

desktop renderer 的四个 UI feature 域：chat（会话面板/编辑器/输入框/回滚/工具卡）、settings（数据管理/服务商/模型/智能体/技能/搜索/智能排序/用量统计/工作区设置）、skills（新建/编辑/选择器）、workspace（文件树/DnD/目录规则/文件纳入）。全部是纯 renderer 层，不碰 DB/KKV/文件系统，一切经 `@/ipc/client`。本机位的立场是猎杀：**死组件、冗余转发、双端重复实现、状态双源**。

## 职责与边界

- **在区内**：UI 组件与 UI 侧的纯逻辑（表单 ↔ DTO 转换、树 DnD 路径解析、消息块解析、批注 draft 合并）。
- **不在区内**：业务规则的 truth 在 `packages/core`（提示词、回滚、隐藏范围、压缩）与 `apps/desktop/shared/logic/*`（跨端共享纯逻辑）。feature 只做投影与触发。
- **落点**：`features/` 下 4 个目录、77 个生产文件（chat 37/5869 行、settings 25/9828 行、skills 4/709 行、workspace 11/1955 行，**合计 18361 行**）。

## 对外接口

- React 组件出口：`SettingsViews.tsx` 的 8 个 view（`DataManagementView` / `AgentsSettingsView` / `ProvidersView` / `ProviderFormView` / `ProviderDetailView` / `SmartSortRulesView` / `SmartSortRuleEditorView`）、`AgentEditorView`、`SkillsManageView`、`SkillDetailView`、`ConversationPanel`、`ChatComposer`、`SessionDetailDrawer`、`WorkspaceTree` 等。
- 跨 feature 的共享出口：`features/skills/skill-ui.ts`（`toSkillRef` / `parseSkillKey` / `skillDomainLabel` / `dispatchOpenSettingsView`）被 chat 与 settings 两个域同时消费，是本区唯一的合法横向依赖。
- 转发 shim（**有意的单源再导出，不算问题**）：`features/chat/composer-send-intent.ts`（9 行）全文注明「单源在 core」，经 `@shared/logic/chat` 再导出 `resolveComposerSendIntent`。

## 数据访问

本区**不直接**访问存储：全量扫描 `localStorage / indexedDB / require("electron") / ipcRenderer` 的直接引用数为 **0**。数据访问面：

- **119 个 `ipcXxx` 调用**（经 `@/ipc/client`），主要族群：`ipcVfs*` 12 个、`ipcSmartSortRule*` 15 个、`ipcProviderModels*` 11 个、`ipcSkills*` 8 个、`ipcMessages*` 10 个、`ipcCloudSync*` 8 个、`ipcSessions*` 8 个。
- **6 个 main→renderer 事件订阅**：`onAgentStream`、`onComposerAttachmentsSuggest`、`onPromptChatTokenUpdated`、`onUserMessageAppended`、`onVfsStartDragFailed`、`onApplied`。
- 间接落到的存储域（经 main 转发 core，本区不感知表结构）：`chat_message`、`llm_saved_model`、`workplace_dir_rule`、session composer draft、`app_ui` KKV（键 `chatRichText`，见 F-w9-pro-7）。

## 依赖关系

- **区内 import 方向**：`settings/*` ← `chat/*`（`ChatComposer` 引 `@/features/skills/SkillPicker`，`ToolCallCard`/`SkillTypeahead` 引 `@/features/skills/skill-ui`）。无反向依赖，无环。
- **向上依赖**：`@/ipc/client`、`@/providers/ShellNavProvider`（`useShellNav` 是本区唯一的全局 UI 状态源）、`@/components/ui/*`、`@/hooks/*`、`@shared/logic/*`、`@shared/ipc-types`。
- **被谁消费**：只有 `renderer/App.tsx` 与 `renderer/features/chat/ConversationPanel.tsx` / `SessionDetailDrawer.tsx` / `SettingsViews.tsx` 三个 hub；以及 `apps/desktop/test/**` 的集成测试。

---

## 发现清单

### F-w9-pro-1 | P1 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:1`（**1048 行整文件**）

引文：

```ts
/**
 * 智能体定义编辑表单（复用 config-forms/agent，供全局智能体与项目专属配置共用）。
 */
```

描述：这是编队线索里那条「1048 行孤儿表单」的**独立复核结论——确认成立**。三重证据：

1. **零消费者**：本机位自建的 import-specifier 精确解析器（支持相对路径 + `@/` 别名，见 §方法）从 `apps/` 与 `packages/` 全部生产文件的可达性闭包出发，该文件**不在可达集合内**；`rg "AgentDefinitionEditorForm" apps packages` 只命中它自己与四份 `docs/Iterations/**` 文档，**测试也没有**（`apps/desktop/test/`、`packages/core/test/` 全无）。
2. **它是 `AgentEditorView.tsx` 的逐行孪生**：用「长度 ≥12 字符的实质行」做集合比对，`AgentDefinitionEditorForm.tsx` 的 628 条实质行里有 **477 条（76.0%）原样出现在 `AgentEditorView.tsx`**——包括从 `@shared/logic/config-forms-agent` 导入的同一批 18 个 helper（`definitionToForm` / `buildAgentDefinitionFromForm` / `toolsSelectionFromDefinition` / `mapPersistTextBlocks` …）与同一个 `applyDefinitionToFormState` 的 18 个 setter 清单（`AgentDefinitionEditorForm.tsx:82-113` vs `AgentEditorView.tsx:116-140` 的 26 个 `useState`）。
3. **它更旧**：`AgentEditorView` 额外持有 `skillsEnabled` / `skillsPrefixText` / `description` 三个字段（`AgentEditorView.tsx:131-137`），孤儿表单里一个都没有——说明活版本是在孤儿版本之后继续演进的，快照停在中途。

补充：文件头注释宣称的复用对象「项目专属配置」本身已于 v1.4.26 下线（`docs/apm/RULE.md:38`「项目智能体（已下线）」）。**注释与现实都不成立**。

建议：整文件删除（连带 F-w9-pro-2）。它还在向 `PromptMacroChips` 提供唯一的引用，是那条死代码链的根。

置信：confirmed

---

### F-w9-pro-2 | P2 | `apps/desktop/renderer/features/settings/PromptMacroChips.tsx:23`

引文：

```tsx
export function PromptMacroChips({ ... }: PromptMacroChipsProps) {
```

描述：67 行组件，全仓唯一 import 点是**已经死了的** `AgentDefinitionEditorForm.tsx:54`（`import { PromptMacroChips } from "./PromptMacroChips";`）。删掉 F-w9-pro-1 之后它自动变成零消费者文件。注意 `PromptMacroTextarea`（同目录，L28）是**活的**（`AgentEditorView.tsx:81` 在用），两者只有 `…Textarea` 活着，别一起删。

建议：随 F-w9-pro-1 一并删除。

置信：confirmed

---

### F-w9-pro-3 | P2 | `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts:7`

引文：

```ts
export function usePreviewSelection() {
```

描述：67 行、三个 hook（`usePreviewSelection` L7 / `useTreeRefreshToken` L30 / `useTreeLoader` L37），**全仓零调用**（三个函数名在 apps+packages 中除本文件外零命中）。`WorkspaceTree.tsx` 已经把三件事各自内联：预览选择改成从 `useShellNav()` 取（`WorkspaceTree.tsx:67-68` 的 `previewFile` / `selectPreviewFile`）、刷新令牌改成组件 prop（`WorkspaceTree.tsx:42` 的 `refreshToken: number`）、加载态改成手写 `reload` + `useEffect`（`WorkspaceTree.tsx:90-114`）。这是一次做了一半就放弃的抽取。

建议：删除整文件；三个 hook 的现役等价物已在 `ShellNavProvider` 与 `WorkspaceTree` 内，不要"补回"。

置信：confirmed

---

### F-w9-pro-4 | P2 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts:12`

引文：

```ts
export async function hideToolTurn(
```

描述：55 行，`hideToolTurn`（L12）/ `deleteToolTurn`（L42）**desktop 侧零调用点**。但 mobile 的孪生文件 `apps/mobile/src/components/chat/tool-turn-actions.ts` 是**活的**（被 mobile 聊天流程使用）。也就是说「assistant tool_use 回合与其 tool_result user 消息成对 hide/delete」这条业务规则，目前在 desktop 侧没有落地实现，只剩一份没人调的实现残骸。风险是：将来谁在 desktop 上重做这个交互，很容易照着这份死代码写，而它可能已经落后于 mobile 的版本（两边的 `resolveToolResultsMessageId` 调用形态已不同：desktop `tool-turn-actions.ts:47-52` 先判再删，mobile `tool-turn-actions.ts:40-41` 同）。

建议：删除 desktop 侧文件；行为真源以 mobile 那份为准（或两边都下沉到 `@shared/logic/chat`，见 F-w9-pro-9）。

置信：confirmed（死代码事实）／suspected（行为是否真的缺失——本机位未逐屏核对 desktop 右键菜单是否另有实现）

---

### F-w9-pro-5 | P3 | `apps/desktop/renderer/features/chat/transcript-selectable-role.ts:30`

引文：

```ts
/** 将会话消息映射为 tail 批量行。 */
export function buildTailBatchRows(
```

描述：48 行整文件零消费者。文件本体（L1-24）是 `@shared/logic/chat` 的纯 re-export shim（可见性/尾批 13 个函数全部转发），L26-47 是唯一有实质内容的 `buildTailBatchRows`，而它没人调。也就是说 desktop 侧的 tail 批量选中/删除链路要么走的是别的入口，要么这条 UI 已经下线。

建议：删除整文件；若 tail 批量 UI 仍在用，应改为直接从 `@shared/logic/chat` 引（shim 本身也无价值）。

置信：confirmed

---

### F-w9-pro-6 | P2 | 死导出（11 处，函数/常量级）

以下符号在全仓（`apps/` + `packages/`，含测试）除自身声明处外**零引用**，且在其所属文件内也只出现一次（即声明本身）——是真死代码，不是「导出但内部自用」：

| 符号 | file:line | 行数 |
|---|---|---|
| `SettingsToolbar` | `features/settings/settings-ui.tsx:95` | 组件 |
| `usePickerData` | `features/settings/WorkspaceSettingsView.tsx:315` | 11 |
| `isDescendantPath` | `features/workspace/vfs-tree-utils.ts:59` | 12 |
| `hasNmVfsMime` | `features/workspace/vfs-tree-dnd.ts:90` | 4 |
| `hasFileDrag` | `features/workspace/vfs-tree-dnd.ts:95` | 4 |
| `isPrefetchInFlightForTest` | `features/workspace/workspace-batch-dnd.ts:85` | ~4 |
| `getActiveNativeDrag` | `features/workspace/workspace-batch-dnd.ts:107` | 4 |
| `applyTextEditToContentBlocks` | `features/chat/message-edit.ts:24` | ~25 |
| `resolveComposerTextAfterRollbackSuccess` | `features/chat/rollback-composer.ts:35` | ~11 |
| `buildTailBatchRows` | `features/chat/transcript-selectable-role.ts:30` | 18 |
| `usePreviewSelection` / `useTreeRefreshToken` / `useTreeLoader` | `features/workspace/useWorkspaceTree.ts:7 / 30 / 37` | 整个文件（已单列 F-w9-pro-3） |

两条值得单独点名的：

- `isPrefetchInFlightForTest`（`workspace-batch-dnd.ts:85`）名字里就写着 "ForTest"，但**测试根本没引它**——是一个连测试都没接上的测试钩子。
- `usePickerData`（`WorkspaceSettingsView.tsx:315-325`）的函数体与同文件 `openPicker`（L122-137）**逐行同义**：都是 `ipcModelListPicker` / `ipcAgentListPicker` 取 rows。是一次没清理干净的抽取。

建议：随对应文件/组件一并删；若团队希望保留测试钩子，先把测试写出来再留。

置信：confirmed

---

### F-w9-pro-7 | P2 | 状态双源：`chatRichText` 偏好两处各持一份

引文：

```ts
// features/chat/ConversationPanel.tsx:362
useEffect(() => {
  ipcAppUiGet('chatRichText')
    .then(res => setChatRichText(res.ok && res.data != null ? res.data !== 'false' : true))
    .catch(() => undefined);
}, []);
```

描述：同一个 app-UI KKV 偏好被两个组件各读各的：

- **写方 + 设置页读方**：`features/settings/WorkspaceSettingsView.tsx:34` 定义 `KEY_CHAT_RICH_TEXT = "chatRichText"`，L67 读、L239 写。
- **聊天页读方**：`features/chat/ConversationPanel.tsx:205` 自己 `useState` 存一份，L362-370 **依赖数组为空**，只在挂载时取一次，之后**没有任何失效通道**（本区没有 `onAppUiChanged` 之类订阅，`useShellNav` 也没有把偏好纳进 `agentConfigRevision`——`ShellNavProvider.tsx:562-565` 的 `notifyAgentConfigChanged` 只被 agent/session 绑定变更触发，`WorkspaceSettingsView.tsx:294/308` 正是模型/agent 切换处）。

用户可见后果：在设置页关掉「富文本消息」后，**已挂载的聊天面板会一直按旧值渲染，直到应用重启或会话切换**。这是本区最典型的一处「同一事实两处持有、一处有写权一处只快照」。

建议：偏好提升为单一订阅源（`ShellNavProvider` 持有 + `useShellNav()` 读），或 main 侧在 `ipcAppUiSet` 后广播变更事件，两处都从广播读。至少不要用 `[]` 依赖做一次性快照。

置信：confirmed（代码事实）／行为后果未跑真机验证，标 suspected

---

### F-w9-pro-8 | P2 | 状态双源 + 魔法字符串：`hasModel` 一个谓词两处判定

引文：

```ts
// features/chat/ChatComposer.tsx:111（渲染期，走缓存 state）
setHasModel(result.data.modelLabel !== "未选择模型" && result.data.modelLabel !== "—");

// features/chat/ChatComposer.tsx:350（点击发送时，重新拉一次 IPC）
if (modelCheck.ok && (modelCheck.data.modelLabel === "未选择模型" || modelCheck.data.modelLabel === "—"))
```

描述：同一个「有没有模型」的谓词在本文件里被写了两遍、极性相反、走**两条不同的数据通道**：

- `hasModel` 是 `useState`（L101），只在 `[checkModel, sessionId, agentConfigRevision]` 变化时刷新（L117-119），喂给 `inputDisabled`（L450）与 `sendDisabled`（L452）——即**按钮的可用态**。
- `send()` 里 L348 现场重发一次 `ipcPromptAgentMeta`，用**新鲜值**做真正的门禁。

后果有两层：① 缓存的 `hasModel` 过期时，按钮会呈现错误的可用态（配置了模型却显示"请先配置模型"占位，或反之）；② `"未选择模型"` / `"—"` 是 main 与 mobile 各自硬写的**哨兵字符串**（`apps/desktop/src/main/ipc/handlers/prompt.ts:83`、`agent.ts:85`、`apps/mobile/src/services/chat-agent-meta.ts:76`），renderer 侧用字面量反推「没模型」。main 一旦改文案，renderer 会静默地把"无模型"判成"有模型"（按钮可点 → 进 `runAgent` 才被第二道门拦住，用户看到的是点了没反应），或反向（永远显示占位）。这条哨兵没有共享常量。

建议：把「是否已配置模型」下沉为一个共享谓词（core 出 `hasModel: boolean` 字段或 shared 常量），删掉 renderer 侧的两份字面量比较；`sendDisabled` 与发送门禁共用同一判据。

置信：confirmed

---

### F-w9-pro-9 | P2 | 双端重复：`message-blocks.ts` 两端逐行 60% 相同

描述：`apps/desktop/renderer/features/chat/message-blocks.ts`（331 行）与 `apps/mobile/src/components/chat/message-blocks.ts` 做了同样的「消息块解析 + tool_use/tool_result 配对」纯逻辑。实测：以 desktop 侧为准的 205 条实质行（长度 ≥12、非注释非 import 行）中，**123 条（60.0%）在 mobile 侧逐行原样存在**，包括 `ToolCallView` 接口全文、`MessageListItem`、`messageHasToolUse`、`resolveToolResultsMessageId` 的整个函数体。

关键论据：desktop 这个文件**不含任何平台依赖**——它只 import `@shared/logic/chat`、`@shared/logic/root` 和 `@shared/ipc-types` 的类型（L4-6），零 React、零 DOM、零 RN。也就是说它本来就没有必须留在 renderer/features 的理由。

注意：`docs/apm/RULE.md:12` 记的是「user_ops 操作日志已拆除，遗留附件在展示层直接丢弃」，并点名 `apps/mobile/src/components/chat/message-blocks.ts` 为丢弃口径所在——即这条口径**只在 mobile 落了两端中的一端**（desktop 的过滤口径需另行核对，本次未逐行比对，可能已在别处补齐）。`docs/apm/memory/20260830-mobile-cr-dedup-abstraction.md` 说明团队做过一次 mobile 侧去重抽象，但这一份没被收编。

建议：把 `message-blocks.ts` 下沉到 `apps/desktop/shared/logic/`（或 core 的纯逻辑域），两端共用；顺带核对 RULE.md:12 的 user_ops 丢弃口径是否两端齐备。

置信：confirmed（重复事实）／suspected（是否已有第三处实现承担了 desktop 的丢弃口径）

---

### F-w9-pro-10 | P3 | 冗余：`resolveDropTargetDir` 是纯转发别名 + 两个路径前缀谓词并存

引文：

```ts
// features/workspace/workspace-batch-dnd.ts:384
export function resolveDropTargetDir(
  rowPath: string | null,
  rowKind: "dir" | "file" | null,
): string {
  return dropTargetDir(rowPath, rowKind);
}
```

描述：两个问题叠在一起。

① `resolveDropTargetDir`（L384-389）**零逻辑**，只是 `vfs-tree-dnd.ts:73` 的 `dropTargetDir` 换个名字再导出。唯一消费者 `WorkspaceTree.tsx` 从 `workspace-batch-dnd` 引这个别名（L28），而同一次 import 块（L32-36）里已经从 `vfs-tree-dnd` 引了 `encodeVfsDragPayload` / `decodeVfsDragPayload` / `NM_VFS_PATHS_MIME`——同一目录树下两个模块各引一次，没有理由绕这一层。

② 路径前缀判定在本区有两种写法且语义互补：`vfs-tree-dnd.ts:36` 的 `isSelfOrAncestorPath`（自身或祖先，活的）与 `vfs-tree-utils.ts:59` 的 `isDescendantPath`（严格后代，死的）。后者 `childPath.startsWith(`${ancestorPath}/`)` 的写法与前者 `targetDir.startsWith(`${sourcePath}/`)` 逐字相同，只是取反——同一规则的两份实现，一份在用一份已死。

建议：删 `resolveDropTargetDir`，`WorkspaceTree` 直接引 `dropTargetDir`；删 `isDescendantPath`。

置信：confirmed

---

### F-w9-pro-11 | P3 | 过度导出：24 个符号 `export` 了但只有本文件用

描述：本区有 24 个符号只在自身文件内被引用，导出无意义——它们把内部实现细节抬成了模块公共 API，后续容易被误当稳定入口。清单（`file:line`）：

`chat/chat-link-route.ts:32/39/45`、`chat/conversation-abort-retain.ts:60`、`chat/conversation-batch.ts:19/28`、`chat/MessageAttachmentGroupCard.tsx:7`、`chat/readOnlyRunProbeLogic.ts:14`、`chat/rollback-composer.ts:4`、`chat/useReadOnlyRunProbe.ts:12/14`、`settings/migration-row-value.ts:25`、`settings/PromptMacroChips.tsx:11`、`settings/PromptMacroTextarea.tsx:17`、`settings/settings-nav.ts:134`、`workspace/vfs-tree-dnd.ts:8`、`workspace/workspace-batch-dnd.ts:27/32/61/111/115/242`（另有 4 个在已死的 `AgentDefinitionEditorForm.tsx:61/66/72/176`，随 F-w9-pro-1 消失）。

值得点名的是 `useReadOnlyRunProbe.ts:12` 的 `READONLY_RUN_PROBE_INTERVAL_MS`（30s 轮询间隔）与 `workspace-batch-dnd.ts:61` 的 `releaseStagedExport` —— 后者是导出状态清理函数，外部改不到就没法在测试或错误路径上兜底。

建议：改回非导出（`knip` 已在本仓配置，见 `knip.json`，可作为门限）。优先级低，批量清理。

置信：confirmed

---

### F-w9-pro-12 | P3 | 疑似重复实现：会话内技能面板 vs 设置·技能管理页

引文：

```tsx
// features/chat/SessionSkillPanel.tsx:159
{skillDomainLabel(row.domain, row.overridden)}
```

描述：`SessionSkillPanel.tsx`（188 行，会话抽屉内嵌）与 `settings/SkillsManageView.tsx`（402 行）都独立实现了「技能列表行 = 域名徽标 + 有效性标签 + 启用开关 + 打开详情」，两者都直连 `ipcSkillsEffective` / `ipcSkillsToggle` 并各自维护 `busyNames` / `reload`。重叠的是**渲染与交互契约**，不是纯函数，抽公共组件的收益存在但不大。

**不作为缺陷上报**：`docs/Iterations/agent-skills/spec.md` 明确设计了这两个入口（会话内快速切换 vs 设置全量维护），是产品有意为之的分工。列此仅为让 reduce 代理知道本机位看过并放过。

置信：suspected（有意设计，但确有实现重叠）

---

## 争议与存疑

1. **本机位的第一版工具给出过错误结论，已自纠并留档**。最初的 import 正则 `(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*['"]…` 不跨行，导致多行 import 块解析失败，把 `RealPromptPanel`、`SessionSkillPanel` 等**活组件**误报成死代码；随后又因 `@/` 别名未解析、`resolveSpec` 对绝对路径提前 return null、`Set` 当数组用等三处 bug 多报 33 个「不可达」文件。最终版本已修正（真实路径映射表 + `@/` 别名 + 绝对路径分支 + 跨行正则），结论 5 个死文件，全部经 `rg` 人工复核过。**若其他机位引用了本区的死代码数字，请以本报告的复核结果为准。**

2. **「1048 行孤儿表单」线索的措辞需要修正一处**：该文件实测 **1048 行**（`Get-Content | Measure` 类工具会因末尾换行报 1047，两者不矛盾）。但线索若指"孤儿"是**组件级别**则成立——本机位确认它连测试都没有，完全无引用。若线索声称它是"表单组件"，则需要更正：它是一个**自包含的 forwardRef 表单 + handle 契约**（`AgentDefinitionEditorFormHandle` 含 `buildDefinition/isDirty/markSaved`），设计上是给 `AgentEditorView` 当子组件用的；活版本 `AgentEditorView.tsx:112` 是直接把同一套 `useState` 铺在自己身上的，两者的组件边界从未真正接上。

3. **`tool-turn-actions.ts`（F-w9-pro-4）的"功能缺失"我没能证实**。我只证明了 desktop 侧这份实现无调用点，没有逐屏核对 desktop 的消息右键菜单是否有另一条 hide/delete 路径（`ConversationPanel.tsx:38` 有 `ipcMessagesHide/Show/Delete` 的导入）。**辩护者若能指出活路径，这条应降级为 P3 纯死代码。**

4. **RULE 里的双端条目不构成本区的重复问题**。`DirectoryRuleModal.tsx`（desktop）对 `DirectoryRuleSheet.tsx`（mobile）、`TokenUsageStatsView.tsx` 对 `TokenUsageStatsScreen.tsx`，`docs/apm/RULE.md:30/45` 都写明是双端并行的既定设计，聚合源在 core。**不报。**

5. **未覆盖的部分**（诚实标注）：本机位没有逐行通读 `SettingsViews.tsx`（2507 行）与 `AgentEditorView.tsx`（1381 行）——两者的重复判定只做了对 `AgentDefinitionEditorForm.tsx` 的单向量化。这两个大文件内部是否还有互相重复的子逻辑（例如 `ProviderFormView` 与 `ProviderDetailView` 之间），本报告**未做结论**，留给 W5 reduce 或专门的横切机位。