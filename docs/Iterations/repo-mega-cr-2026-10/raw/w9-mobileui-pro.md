---
zone: w9-mobileui-pro
agent: 对抗机位·检察官（猎杀死组件 / 冗余 / 状态双源 / 与 desktop 重复的纯逻辑）
files_scanned: 102
---

# w9 · mobileui-pro（检察官报告）

## 摘要

本区是 mobile 的**展示层与交互骨架**：102 个文件（components/ 除 chat/、theme/、errors/、debug/），
覆盖通用 UI 原子（ModalShell / PickerListModal / Form* / Buttons / SegmentedControl）、
业务卡片（Agent 编辑器、VFS 文件管理器、技能与 provider 表单）、
WebView 桥壳（CodeEditorWebView / RichDocumentWebView / *Bridge）、
以及主题 token、错误格式化、`__DEV__` 打点。数据一律经 `runtime` 服务或
`@novel-master/core` 拿，本区自己不落库；唯一的本地"状态"是表单草稿、
弹层开关与草稿 store 的投影。本机位立场：找**死代码、同一逻辑的三四份拷贝、
以及 props/state 双源**。

## 职责与边界

- **职责**：渲染与交互编排。表单字段→core `config-forms` DTO 的映射、
  VFS 列表行的展示映射（`vfs-row-mapper.ts`）、批注草稿 store 的读写编排、
  桥协议 encode/decode 与 WebView 生命周期、主题 token 分发、错误文案格式化。
- **边界（不做）**：不直接访问 SQLite / KKV（经 `runtime.*` 与 `storage/*`）；
  不做 markdown 渲染语义（`prepare-transcript-rich-html.ts` 只做管线编排，
  markdown-it 配置与 fence 规则在本区但语义属于"渲染层"）；
  不做 sanitizer 白名单策略的**决策**（`sanitize-rich-html.ts` 是策略执行点，
  策略本身与 desktop 同源）。

## 对外接口（关键导出）

| 符号 | 位置 | 消费方 |
|---|---|---|
| `ModalShell` / `AppModal` | `components/ui/ModalShell.tsx`, `AppModal.tsx` | 全 app 弹层骨架 |
| `PickerListModal` / `PickerListLoadResult` | `components/ui/PickerListModal.tsx` | AgentPickerModal / ModelPickerModal / SkillPicker / DirectoryRuleSheet |
| `FormField/FormTextInput/FormSelectField/FormChipGroup/FormSwitchRow/FormSectionCard/ScreenFormLayout/StickyFormFooter/FormOverlayProvider` | `components/form/*` | 各表单屏 |
| `CollapsibleCard` / `Buttons` / `SegmentedControl` / `ElevatedCard` / `ConfigListCard` / `card-styles` | `components/ui/*` | 各列表/结果卡片 |
| `VfsFileManager` / `VfsFileManagerHandle` | `components/vfs/VfsFileManager.tsx` | FileEditorScreen / SkillPanelScreen |
| `FileMarkdownPreview` / `RichDocumentWebView` / `CodeEditorWebView` / `*Bridge` | `components/vfs/*` | FileEditorScreen |
| `useTheme` / `ThemeProvider` / `tokensForMode` | `theme/*` | 全 app（`useTheme()` 命中 60+ 文件） |
| `formatError` / `toastMessage` | `errors/*` | 全 app 错误文案出口 |
| `resetRunTiming/rollbackTimingLog/bootTimingLog` | `debug/run-timing.ts` | chat 链路 + services（`__DEV__` 门控） |

## 数据访问

本区**不直接触碰表 / KKV**，全部经注入：

- KKV `nm-desktop-ui` / key `theme` → `theme/ThemeProvider.tsx:41`（`appUi.get`），写 `:71`。
- KKV `vfsMarkdownPreviewEngine` → 经 `storage/vfs-markdown-preview-engine.ts`，
  读点 `components/vfs/FileMarkdownPreview.tsx:149`（`readVfsMarkdownPreviewEngine`）。
- 批注草稿 store（core `chat-annotate-draft`）→ `FileMarkdownPreview.tsx:170`
  `listChatAnnotateDrafts`、`:182` `subscribeChatAnnotateDraft`、`:212` `addChatAnnotateDraft`、
  `:250` `removeChatAnnotateDraft`、`:270` `updateChatAnnotateDraft`。
- VFS / workplace 列表 → `VfsFileManager.tsx:319-321`（`vfs.list` + `workplace.buildListRows`
  + `workplace.getDirRule` 三路 `Promise.all`），`:326` `runtime.smartSortRule.listCompiledRules`。
- 无本地文件路径读写。

## 依赖关系

- **import 谁**：`@novel-master/core/{vfs,workplace,chat,agent,provider,skills,prompt,config-forms/*}`、
  `../../runtime/novel-master-context`、`../../hooks/useRuntime`、`../../storage/*`、
  `../../services/*`（`vfs-operations` / `workplace-operations` / `vfs-zip` / `app-toast`）、
  `../chat/*`（本区少数几处反向 import，见 F-07）。
- **被谁消费**：`apps/mobile/src/screens/**`（30+ 屏）、`navigation/**`、`App.tsx`。
- **反向依赖（components → screens）**：仅 2 处，见 F-07。
- **被 desktop 复制的纯逻辑**：见 F-02/F-03/F-04/F-05/F-06。

---

## 发现清单

### F-w9-mobileui-pro-1 | P2 | apps/mobile/src/components/batch/ListBatchBar.tsx:15

```tsx
export function ListBatchBar({selectedCount, onCancel, onDelete}: Props) {
```

**描述**：整文件（52 行）零引用。全仓 `git grep ListBatchBar` 只命中定义行本身；
`__tests__` 也没有。它的职责（批量栏 取消 / 已选 N 项 / 删除）已被
`components/batch/ManageHeader.tsx:74-128` 的 `batchMode` 分支完整覆盖，
且 ManageHeader 多了 `onSelectAll` / `actions[]` / `tone` / `hint`，是当前唯一在用的批量栏。
`git ls-files` 下 VfsFileManager / ProjectDrawer / AgentList / ProvidersScreen /
SkillsSettingsScreen / SmartSortRulesScreen / ChatSessionListPanel 七处调用点
**全部**传的是 `ManageHeader`。

**建议**：删除 `ListBatchBar.tsx`。它与 ManageHeader 是同一概念的两个实现，
留着只会诱导后来者改错文件（尤其两者的 `bar/batchRow/batchActions` 样式几乎同构）。
**置信**：confirmed（零引用 + 逐调用点核对）。

---

### F-w9-mobileui-pro-2 | P2 | apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts:146

```ts
export function agentDisplayNameFromWire(raw: unknown, agentId: string): string {
```

**描述**：同一个"从 wire 尽力读 name，读不到回退 id"的函数在仓里存在**四份**：

| 副本 | 位置 | 导出 |
|---|---|---|
| A | `apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts:146` | export，消费方 `AgentEditorForm.tsx:48,153` |
| B | `apps/mobile/src/components/agent/AgentList.tsx:61` | 模块私有，消费方 `:197` |
| C | `apps/desktop/renderer/features/settings/AgentEditorView.tsx:99` | 模块私有 |
| D | `apps/desktop/src/main/ipc/handlers/agent-registry.ts:51` | 模块私有，消费方 `:80,184` |

A 与 B **逐字符相同**（只有 `export` 前缀与参数换行差异，已 diff 验证）。
C 与 D 逐字符相同但**语义有别**：它们多一条 `!Array.isArray(raw)` 判定
（A/B 用 `'name' in raw`，对数组同样返回 true——数组带 `name` 属性时会误读，
实际 registry 的 raw 是对象故当前不可见，但两端口径已经漂了）。

**建议**：把这条"wire 尽力读字段"提到 core（`domain/agent/logic/` 下与
`assessAgentDefinitionWire` 同居），四份全部改为引用；顺手统一数组判定口径。
**置信**：confirmed（四份位置与 A≡B 的等价性均已 diff）。

---

### F-w9-mobileui-pro-3 | P2 | apps/mobile/src/components/agent/prompt-macro-input.ts:1

```ts
import {ALLOWED_DYNAMIC_ROOT_MACROS} from '@novel-master/core/prompt';
```

**描述**：与 `apps/desktop/renderer/features/settings/prompt-macro-input.ts`
**逐函数重复**（62% 行重合，137 行 vs 139 行）。重复的是纯逻辑、无平台差异：
`isWhitelistRootMacroInner`（mobile:28 / desktop:25）、
`findWhitelistMacroRanges`（mobile:47 / desktop:37）、
`tryAtomicMacroDelete`（mobile:111 / desktop:93）、
`insertTextAtSelection`（mobile:149 / desktop:125）。
desktop 那份的注释自己写着"与 Mobile prompt-macro-input 对齐"——
即**已知的双份维护**。两端测试也各写一份同构断言
（`apps/mobile/__tests__/prompt-macro-input.test.ts`、
`apps/desktop/test/prompt-macro-input.test.ts`，helper `backspaceOnce` /
`deleteForwardOnce` 也逐字重复）。

**补充（这一份还是 mobile 侧的半死代码）**：mobile 的 `splitPromptMacroSegments`
（:77）与 `tryAtomicMacroDelete`（:111）在 mobile 生产代码里**已无调用方**——
`PromptMacroTextInput.tsx:5-8` 的文件头注释明说这两块"随 WebView 化整体退役"，
实际宏高亮/原子删都搬进 web bundle（`src/web/composer-input/webview/runtime/editor.ts:149`）。
仅剩 `__tests__` 在 import（`prompt-macro-input.test.ts:5`、`atomic-range-delete.test.ts:7`），
而 `atomic-range-delete.test.ts:79-98` 那条用例的标题就是
"T-AD5：宏白名单区间源与 tryAtomicMacroDelete 逐组等价"——**用一个退役实现的
副本去验证它的泛化版 `tryAtomicRangeDelete`**，等价性断言本身成了孤儿契约。
真正在 mobile 侧存活的只有 `findWhitelistMacroRanges`（被 web editor.ts:23 import）
与 `PROMPT_INSERTABLE_MACROS` / `insertTextAtSelection`（被 PromptMacroTextInput.tsx:45,131 消费）。

**建议**：① 把 `findWhitelistMacroRanges` / `insertTextAtSelection` /
`PROMPT_INSERTABLE_MACROS` 提到 `packages/core/config-forms/prompt`（desktop 已有
`apps/desktop/shared/logic/prompt.ts` 作薄再导出的先例，mobile 走 core exports 即可）；
② 删除 mobile 侧 `splitPromptMacroSegments` / `tryAtomicMacroDelete` / `PromptMacroSegment`
及其专属测试，把 `atomic-range-delete.test.ts` 的 T-AD5 等价性用例改成
"泛化版对**已知边界用例**"的断言，不再依赖已退役实现。
**置信**：confirmed（逐函数位置 + 生产零引用 + 测试引用清单均已核）。

---

### F-w9-mobileui-pro-4 | P2 | apps/mobile/src/components/provider/SamplingForm.tsx:22

```ts
function numStr(value: number | undefined): string {
```

**描述**：与 `apps/desktop/renderer/features/settings/SamplingForm.tsx:11`
逐函数重复：`numStr`（22/11）、`parseNumber`（26/15）、`patchOpenAi`（58/24）、
`patchAnthropic`（69/35）、`patchGemini`（80/46），以及三档协议字段矩阵
（openai 3 项 / anthropic 4 项 / gemini 4 项，标签文案与键名完全一致：
`temperature` / `top_p` / `top_k` / `max_tokens` vs `topP` / `topK` / `maxOutputTokens`）。
两端唯一差异是渲染壳（RN `FormTextInput` vs `<input type=number>`）。
这段是纯数据变换——把"某协议的采样参数字段清单"和"合并/覆盖规则"编码在 JSX 里，
两端各写一遍；将来加一个协议字段要改两个 app。

**建议**：把 `SAMPLING_FIELDS_BY_PROTOCOL`（协议 → `{key, label}[]` 描述表）与
`patchSampling(protocol, prev, key, value)` 提到 core（`domain/provider/logic/`），
两端组件只做 map 渲染。这是与 F-03 同型的"配置表单描述数据应回 core"问题。
**置信**：confirmed。

---

### F-w9-mobileui-pro-5 | P2 | apps/mobile/src/components/agent/ToolPolicyPicker.tsx:41

```ts
function buildTriggerLabel(selected: readonly string[]): string {
```

**描述**：与 `apps/desktop/renderer/features/settings/ToolPolicyPicker.tsx:12`
**逐字符相同**（含 `TOTAL = BUILTIN_TOOL_CATALOG.length` 与三档文案
`未选择工具（0/N）` / `全部工具（N/N）` / `已选工具（M/N）`）。
**更关键的是整条交互逻辑也重复**：两端都有同一套"draft 仅在 sheet 从关到开那一刻
用 selected 初始化一次"的 `prevOpenRef` + `useEffect` 守卫
（mobile:61-68，desktop:36-43，desktop 甚至用 `useMemo(() => ({value:false}), [])`
假冒 ref）、同一套 `draftSet` / `filtered`（大小写无关的 name+description 子串过滤）、
同一套 toggle / close / confirm。desktop 那份的注释写着
"与 mobile 一样占满表单空间""改造前是搜索框 + 列表 inline 常驻"——
明确记录了这是**照着 mobile 改的**，改完两边就分叉了。
本文件 259 行 vs desktop 152 行，差的 100 行是 ModalShell/insets 渲染，逻辑层一模一样。

**建议**：抽 `usePickerDraftState(selected)`（draft + 打开沿用 selected 的守卫）
与 `buildTriggerLabel` 到 core/shared；两端只保留壳。
**置信**：confirmed。

---

### F-w9-mobileui-pro-6 | P2 | apps/mobile/src/components/sheet/DirectoryRuleSheet.tsx:258

```ts
function clampCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) { return 0; }
  return Math.min(1000, Math.max(0, n));
}
```

**描述**：`clampCount` 与 `apps/desktop/renderer/features/workspace/DirectoryRuleModal.tsx:48`
逐字符相同。同文件上方还有**第二份双端重复**：
- `SORT_FIELDS`（mobile:41 / desktop:19）——**且顺序不同**：mobile 把 `smart` 排第一
  （"智能排序列表首项"是它的默认 sortField），desktop 把 `name` 排第一。
- `FILL_POLICIES`（mobile:53 / desktop:31）值域一致，但 mobile 多一层
  `normalizeFillPolicyForMobile`（`apps/mobile/src/services/fill-policy-mobile.ts:7`）
  把 legacy `full` 映射到 `hidden`，desktop 是本地 `normalizeFillPolicy`（:37）
  把 `full` 落到 `DEFAULT_WORKPLACE_DIR_RULE.fillPolicy`（= `header`）。
  **同一个 legacy 值两端映射到不同的现行值**。
- 两侧 UI 布局也重复：排序方式行、头部/尾部数量输入、其余文件填充 chip 行
  （mobile:144-198 vs desktop 的等价 JSX），连"启停由文件管理菜单负责、表单内不提供开关"
  的注释都是同一句。

**建议**：把三张选项表 + `clampCount` + `normalizeFillPolicy` 收进 core
`domain/workplace/logic/default-dir-rule.ts` 旁（`DEFAULT_WORKPLACE_DIR_RULE` 已在那里）。
legacy `full` 的映射必须**先拍板一个值**再两端共用——当前 mobile→`hidden`、
desktop→`header` 是一处真实的口径分叉，属行为 bug 不是纯冗余（见「争议与存疑」）。
**置信**：confirmed（重复 confirmed；`full` 映射分叉 confirmed）。

---

### F-w9-mobileui-pro-7 | P2 | apps/mobile/src/components/charts/PieChart.tsx:22

```ts
import {styles} from '@/screens/stack/token-usage/styles';
```

**描述**：两处 **components 反向依赖 screens**，破坏了本仓明确写下的分层
（`navigation/ChatTabNavContext.tsx:4`：「写入值；AppHeader 等 chrome 组件只从本文件读，
**避免 components 反向依赖 screens**」）：

1. `components/charts/PieChart.tsx:22` → `@/screens/stack/token-usage/styles`
2. `components/sheet/MetricDetailSheet.tsx:15` → `@/screens/stack/token-usage/format`
   （`hitRate` / `formatHitRate`，注释还写着"公式单源"——单源在 screens 里，
   组件层要公式就得反向 import 屏）

后果具体：把统计页的私有样式/格式化挪进 `components/` 或 core，
必须同时改这两个组件；且这两个组件已无法被非统计页复用而不牵进屏层。

**建议**：`hitRate` / `formatHitRate` 与统计页 `styles` 上移到
`packages/core/common/usage-stats-format.ts`（desktop 已有同名文件
`apps/desktop/shared/logic/usage-stats-format.ts`，
且 `packages/core/src/common/usage-stats-format.ts:19` 已有 `formatDurationMs` 的同款——
desktop 的 `shared/logic/usage-stats-format.ts:22` 与 core 的 `:19` 也是逐字重复，
三份同源）；`styles` 那份若只服务图表，移到 `components/charts/` 自身。
**置信**：confirmed。

---

### F-w9-mobileui-pro-8 | P2 | apps/mobile/src/components/vfs/VfsFileManager.tsx:178

```tsx
const [rows, setRows] = useState<MappedVfsRow[]>([]);
```

**描述**：**状态双源**。同一份"当前目录的工作区元数据"在本组件里存了**两份**：

- `rows`（:178，`: MappedVfsRow[]`，展示态，已 map 过的 UI 行）
- `worktreeRows`（:277，`: WorkplaceListRow[]`，原始 DTO）

二者由 `reload`（:334 `setWorktreeRows(allRows)` + :384 `setRows(mapped)`）
**分别**写入，并靠 `metaByPath`（:335）临时搭桥。问题在三处：

1. **目录规则开关的手工双写**：:705-711 改 `worktreeRows` 的 `ruleState`，
   :712-716 改 `rows` 的 `ruleEnabled`/`badge`——两处 `setX(prev => prev.map(...))`
   必须永远同步，一次漏改就是 UI 与数据源打架。
2. **菜单行的来源分叉**：:593-601 `menuRow` 先在 `rows` 里找，找不到**再**用
   `worktreeRows` 现算一个 `mapWorktreeRow(metaForMenu, countFilesInDir(...))`。
   于是同一个菜单行有两个可能来源，取决于它此刻在不在可见列表里
   （例如刚被规则切换 patch 过、或刚 reload 完还没 remap）。
3. **派生依赖 currentPath**：`applyWorktreeRowsToVisibleList`（:296-302）依赖
   `currentPath`，闭包里读的是渲染帧的 `currentPath`；`reload` 也依赖它（:395）。
   目录切换时二者都重建，容易出现"worktreeRows 已是新目录、rows 还是旧目录 remap 结果"的中间帧。

**建议**：`worktreeRows` 作为唯一真源保留，`rows` 改为
`useMemo(() => rowsFrom(worktreeRows, vfsEntries, currentPath, dirRule), [...])` 纯派生，
删掉所有 `setRows`；规则开关只改 `worktreeRows`，UI 自动跟随。
**置信**：confirmed（三处双写/分叉均已定位到行）。

---

### F-w9-mobileui-pro-9 | P2 | apps/mobile/src/components/vfs/vfs-row-mapper.ts:31

```ts
export function parentLogicalPath(path: string): string | null {
```

**描述**：路径工具三件套（`parentLogicalPath`:31 / `isDirectChild`:43 / `entryName`:48）
与 `apps/desktop/renderer/features/workspace/vfs-tree-utils.ts:42/54/87`
**逐字符相同**。desktop 那份文件头还写着
`VFS tree row display helpers (aligned with mobile vfs-row-mapper)`——
又一次"对齐式双份维护"，desktop 已经先抽成了 `vfs-tree-utils.ts`，
mobile 这份却仍在原地。相邻的 `isSelfOrAncestorPath` / `resolveMoveDestination`
（`vfs-move-path.ts:6/23`）同样与 `apps/desktop/renderer/features/workspace/vfs-tree-dnd.ts:36/53`
逐字符相同——mobile 文件头还坦承"**从 desktop vfs-tree-dnd 拷贝，暂不抽 core**"。
这四条是纯字符串运算、零平台依赖、且直接决定"移动目标是否合法""是否把文件移进自己的子目录"
这类会丢数据的行为，不该留在任一端的 UI 层。

**建议**：五条（parentLogicalPath / isDirectChild / entryName /
isSelfOrAncestorPath / resolveMoveDestination）上收到
`packages/core/domain/vfs/logic/path-ops.ts`，从
`@novel-master/core/vfs` 导出；两端删除本地副本。
**置信**：confirmed。

---

### F-w9-mobileui-pro-10 | P2 | apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts:342

```ts
const moveDynamic = (index: number, dir: -1 | 1) => {
  setDynamic(prev => { const next = [...prev]; const target = index + dir; ... });
};
```

**描述**：同一段"上移/下移一块"逻辑**三份**：
mobile `useAgentEditorFormState.ts:342`、desktop
`AgentEditorView.tsx:543`、desktop `AgentDefinitionEditorForm.tsx:411`
（后两者逐字相同）。而**同文件上一行的 persist 版已正确收进 core**：
`movePersist`（:339）调用 `movePersistTextBlock`（core `agent-editor-state.ts:233`）。
即：persist 侧做对了（逻辑回 core，三端共用），dynamic 侧漏了，
于是一个 `useAgentEditorFormState` 文件里紧邻两行，一行是 core 委托、一行是本地重写。
desktop 两个文件之间也是同样的"一个委托一个重写"。

**建议**：core 增 `moveDynamicBlock(blocks, index, dir)`（与
`movePersistTextBlock` 同居 `config-forms/agent/`），三处 `moveDynamic` 全改为委托。
**置信**：confirmed。

---

### F-w9-mobileui-pro-11 | P2 | apps/mobile/src/components/icons/TabIcons.tsx:26

```tsx
export function AgentTabIcon({color, size = 24}: IconProps) {
```

**描述**：`TabIcons.tsx` 共 15 个导出图标，其中 **3 个零引用**（全仓 grep 只命中定义行）：

| 符号 | 行 | 说明 |
|---|---|---|
| `AgentTabIcon` | :26 | Agent tab 图标。`RootNavigator.tsx:11` 只 import 了 `ChatTabIcon` 与 `ProfileTabIcon`——agent 页在 mobile 是 **Stack 屏不是 tab**，图标从未被接线 |
| `ZipExportIcon` | :281 | 无引用 |
| `ZipImportIcon` | :296 | 无引用 |

（`ManageListIcon`:135 情况不同：生产零引用，但 `__tests__/skill-panel-screen.test.tsx:70`
的 `jest.mock` 里列了它——即 skill 面板曾经用它、现在改用别的入口了，
mock 残留。除 mock 外同样零引用。）

**建议**：删 `AgentTabIcon` / `ZipExportIcon` / `ZipImportIcon`；
`ManageListIcon` 随 skill 面板测试 mock 一并清理或接回真实入口。
**置信**：confirmed（逐一 grep 验证）。

---

### F-w9-mobileui-pro-12 | P2 | apps/mobile/src/components/skills/skill-ui.ts:33

```ts
export function skillDomainHintLabel(domain: SkillDomain, projectName?: string): string {
```

**描述**：`skillDomainHintLabel` 零引用（文件头注释说"详情页 / 编辑器顶栏的域说明文案"，
但详情/编辑器都没用它）。同时 `buildNewSkillDoc`（:53）与 desktop
`apps/desktop/renderer/features/skills/skill-ui.ts:21` 是**同名同职责但产出不同**的两份：
mobile 用 `yamlScalar`（JSON.stringify，:48）对 name/description 加双引号并附中文
「## 使用说明」引导段；desktop 直接插裸值、引导段是一条 HTML 注释。
→ **同一个新建技能动作，两端写出的 SKILL.md 正文不同**（描述含 `:` `"` 换行时 mobile 正确、
desktop 会破 front matter）。这是行为分叉，不只是冗余。
`skillDomainBadgeLabel`（:14）与 desktop `skillDomainLabel`（:10）也是同一逻辑两份
（mobile 多一个 `overridden` 入参，desktop 内联处理）。

**建议**：`buildNewSkillDoc` 提到 core（core 已有
`packages/core/src/domain/skills/logic/parse-skill-front-matter.ts` 的对偶解析器，
生成器理应同址）；删 `skillDomainHintLabel`；`skillDomainBadgeLabel` 两端共用一份。
**置信**：confirmed（零引用 + 两端模板差异已逐行比对）。

---

### F-w9-mobileui-pro-13 | P3 | apps/mobile/src/theme/ThemeProvider.tsx:21

```ts
export interface ThemeContextValue {
  mode: ThemeMode; tokens: ThemeTokens; loaded: boolean; ...
```

**描述**：context 上的 `loaded` 是**死字段**。全仓 `git grep` 只命中 ThemeProvider
自身的 4 行（:21 声明、:32 state、:89 赋值、:93 依赖），**没有任何消费方读 `.loaded`**。
desktop 的 `ThemeProvider.tsx:20` 同样导出 `loaded` 且同样零消费——
又一处双份死字段。`setLoaded` 的三处写入（:37/53/58）连同它驱动的
"appUi 未就绪时重置"分支（:35-38）都是为这个没人读的 flag 服务的。

**建议**：两端同时删 `loaded`（含 mobile 的三处 `setLoaded` 与 `!appUi` 早退分支
——注意删早退分支后 `:34` 起的 promise 链需要重新审视 `appUi` 为 null 的情形）。
**置信**：confirmed。

---

### F-w9-mobileui-pro-14 | P3 | apps/mobile/src/errors/format-error.ts:84

```ts
/** @deprecated Prefer {@link formatError}; kept for VFS call sites. */
export function formatVfsError(error: unknown): string {
  return formatError(error);
}
```

**描述**：死兼容层，且**注释与事实不符**。注释说"kept for VFS call sites"，
但全仓 grep 显示 `formatVfsError` 的调用方**只有一处**：
`apps/mobile/__tests__/errors.test.ts:3` 从 `@/vfs/errors` 引入；
而 `apps/mobile/src/vfs/errors.ts` 本身也只被那一个测试引用
（文件头自称 "legacy vfs/errors path"，生产零引用）。
即：**一个 deprecated 别名 + 一个 deprecated 再导出模块，只被测试消费**。
生产侧真正的 VFS 错误出口是 `VfsFileManager.tsx:48` 直接 import 的
`formatVfsErrorForUser`（core 提供），根本没走这条兼容路径。
本仓 RULE 的"验收断言的牙齿"条目明确点名过"纯为测试存在的生产模块"这一类问题。

**建议**：删 `formatVfsError`、`apps/mobile/src/vfs/errors.ts`；
`errors.test.ts` 改测 `formatError`（它已覆盖同一批断言，见该测试 :9-31）。
**置信**：confirmed。

---

### F-w9-mobileui-pro-15 | P3 | apps/mobile/src/components/vfs/vfs-row-mapper.ts:211

```ts
/** @deprecated Use {@link mapVfsListEntry}. */
export function mapVfsFilePath(path: string): MappedVfsRow {
  return mapVfsListEntry({path, kind: 'file'});
}
```

**描述**：另一个"只被测试消费"的 deprecated 导出。生产零引用；
唯一调用方是 `apps/mobile/__tests__/vfs-row-mapper.test.ts:4,149`。
与 F-14 同型：测试把生产死代码钉住了，于是它永远删不掉。
另外 `VfsFileManager.tsx:380` 有一处**同形手写**：
`return mapVfsListEntry({path, kind: 'file'})`——与 `mapVfsFilePath` 函数体一字不差，
就在同一个文件里。也就是这个 deprecated 别名连"被使用"的名分都没有，
因为唯一等价的用法在调用点被内联重写了一遍。

**建议**：删 `mapVfsFilePath` 与其测试用例（:149 那条），
`VfsFileManager.tsx:380` 保留内联即可（它本来就该是内联）。
**置信**：confirmed。

---

### F-w9-mobileui-pro-16 | P3 | apps/mobile/src/components/agent/agent-editor/agent-editor-types.ts:7

```ts
export type AgentEditorTokens = ReturnType<typeof useTheme>['tokens'];
```

**描述**：**一个文件只为了一条类型别名而存在**。`agent-editor-types.ts` 全文 7 行
（4 行注释 + 1 行 import + 1 行 type + 2 行空行），
产出 `AgentEditorTokens = ThemeTokens` 的别名，被 5 个 agent-editor 子组件 import。
它没有做任何收窄或文档化，只是把 `ThemeTokens` 换了个名字——
而 `theme/tokens.ts:6` 的 `ThemeTokens` 已经是全 app 公共类型，
`FormSectionCard` / `FormTextInput` / `PromptMacroTextInput` 等十几个文件都直接用它。
拆分收益为零，代价是多一跳 import 与一层"这些 tokens 是从哪来的？"的疑问。

**建议**：删 `agent-editor-types.ts`，5 处改 import `ThemeTokens`。
**置信**：confirmed。

---

### F-w9-mobileui-pro-17 | P3 | apps/mobile/src/components/agent/agent-editor/AgentEditorToolsSection.tsx:66

```tsx
未配置时使用全部内置工具（11
个）：task、read、write、edit、fs、glob、grep、skill、agent、curl、search。
```

**描述**：**硬编码的工具清单与计数**，与 `BUILTIN_TOOL_CATALOG`
（`packages/core/src/config-forms/agent/agent-tool-catalog.ts:8`，当前 11 项）
脱钩。同样的字面量在 desktop 又有两份：
`AgentDefinitionEditorForm.tsx:620` 与 `AgentEditorView.tsx:822`。
即"11 个工具 + 名单"这一个事实被**手抄三份**，且被测试
`apps/mobile/__tests__/agent-editor-form-tool-count.test.tsx:74-82`
以字符串包含方式钉死（还专门有一条"不再残留 8 / 10 个的旧计数"的反向断言）。
新增第 12 个内置工具时，这段文案不会自动更新，而测试也不会报警
（它只断言"包含 11"，改成 12 后仍包含 "11"？——不会，`11 个` 与 `12 个` 不同，
所以测试会红；但红灯的修法是改三处字面量 + 三处测试期望，而不是让文案从 catalog 生成）。
注意 `ToolPolicyPicker.tsx:38` 已经正确用了 `BUILTIN_TOOL_CATALOG.length` 做 TOTAL，
同屏两处一个动态一个硬编码。

**建议**：文案改为 `BUILTIN_TOOL_CATALOG.map(t => t.name).join('、')` +
`BUILTIN_TOOL_CATALOG.length`，三端共用；测试改成断言"包含 catalog 里每个 name"
而不是钉死数字。
**置信**：confirmed。

---

### F-w9-mobileui-pro-18 | P3 | apps/mobile/src/components/rich-content/decode-literal-html-entities.ts:14

```ts
export function decodeLiteralHtmlEntities(text: string, options?: DecodeLiteralHtmlEntitiesOptions): string {
```

**描述**：与 `apps/mobile/src/web/shared/decode-entities.ts:17`
**双份实现**，且两侧注释互相点名要求"语义对齐"
（RN 侧 :55「WebView boot 真源：`src/web/shared/decode-entities.ts`（须与本模块语义对齐）」；
web 侧 :3「须与 RN `decode-literal-html-entities.ts` 语义对齐」）。
四组 replace + 3 轮循环的规则表逐字符相同，唯一差异是入参类型
（RN `text: string` vs web `text: unknown` + `String(text || '')`）。
这是一条**安全相关**的解码规则（决定 sanitize 前后哪些实体还原），
双份维护意味着 web 侧加一条规则、RN 侧漏改时，两条渲染管线的实体行为就会分叉
——而这两条管线喂的是同一批用户 markdown。
同类"两份 escapeHtml"还有两处：`build-front-matter-document-html.ts:11` 与
`src/web/composer-input/webview/runtime/editor.ts:52`（逐字符相同），
以及 desktop 的 `ComposerAtPathInput.tsx:16` 与 `prompt-macro-input.tsx:61`。

**建议**：规则表（哪些实体、几轮）提到 core 或
`packages/core/src/domain/format/` 下的共享模块，RN 与 web 各留一个薄壳
（web 侧多做的 `String(text||'')` 归一化留在 web 壳里）；
`escapeHtml` 同理提到共享工具。
**置信**：confirmed。

---

### F-w9-mobileui-pro-19 | P3 | apps/mobile/src/components/vfs/RichDocumentBridge.ts:145

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
```

**描述**：同一守卫在 mobile 存在**三份**：`RichDocumentBridge.ts:145`（本区）、
`components/chat/ChatTranscriptBridge.ts:310`、`components/chat/ComposerInputBridge.ts:95`
（逐字符相同）。三个桥模块的 `decode*` 函数体也同构
（`JSON.parse` → `isRecord` → 版本判定 → type 判定 → cast），
只有版本常量不同（`RICH_DOCUMENT_BRIDGE_VERSION:5` / `CODE_EDITOR_BRIDGE_VERSION:4`
/ chat 侧另两个）。三份 `decode` 抛的错误文案甚至逐字相同
（"Invalid rich-document bridge envelope version" vs 对应 chat 文案）。
注意 `RichDocumentBridge.ts` 与 `CodeEditorBridge.ts` **同在本区**，
两者的 `isRecord` 一个用函数、一个内联成
`!parsed || typeof parsed !== 'object' || Array.isArray(parsed)`（:72, :87）——
**同区内就已经两种写法**。

**建议**：抽 `decodeBridgeEnvelope<T>(raw, version)` 到
`components/vfs/bridge-envelope.ts`（或 core），三处共用；
`isRecord` 统一一种写法。
**置信**：confirmed。

---

### F-w9-mobileui-pro-20 | P3 | apps/mobile/src/components/prompt/TemplatePushButton.tsx:30

```ts
function confirmMessage(): string {
  return '将用当前聊天工作区覆盖项目工作区，覆盖后无法撤销。';
}
```

**描述**：`TemplatePushButton.tsx`（122 行）与 `TemplatePullButton.tsx`（119 行）
是**逐行镜像**：同样的 `Props`（`scope` / `onPushed|onPulled` / `compact` / `iconOnly`）、
同样的 `useState<busy>` + `try/finally` 结构、同样的
`Alert.alert(title, confirmMessage(), [取消, {style:'destructive', onPress}])`、
乃至**同一份 `StyleSheet.create`**（`btn` / `btnCompact` / `iconBtn` 三个 key
逐字符相同，见 push:101-122 与 pull:98-119）。
文件头注释自己写着"与 TemplatePullButton **完全镜像**"。
差异只有三处：`runtime.sessions.pushTemplate` vs `pullTemplate`、
文案、成功 toast 文案、图标（`SyncPushIcon` vs `SyncPullIcon`）。
而 `SyncPushIcon`（TabIcons.tsx:266）的注释还记着它是为了视觉对齐
`SyncPullIcon` 才逐字复刻路径的——**图标层已经因为"各写一份"付过一次对齐成本**。

**建议**：抽 `TemplateSyncButton({direction, scope, onDone, compact, iconOnly})`，
两个文件变成两行常量导出（方向 + 文案 + service 调用）。
**置信**：confirmed（StyleSheet 逐字符比对已做）。

---

### F-w9-mobileui-pro-21 | P3 | apps/mobile/src/components/vfs/FileMarkdownPreview.tsx:152

```ts
useEffect(() => { refreshPreviewEngine().catch(() => undefined); }, [refreshPreviewEngine]);

useFocusEffect(useCallback(() => { refreshPreviewEngine().catch(() => undefined); }, [refreshPreviewEngine]));
```

**描述**：**同一份数据两个触发源**。`previewEngine` 的读取（:148-150，走 KKV）
既挂在 `useEffect`（:152）又挂在 `useFocusEffect`（:156）。首次挂载时两者都跑，
产生一次冗余的 KKV 读；`appUi` 引用变化时 `refreshPreviewEngine` 重建、两个 effect
再各跑一次。同一模式在 `previewEngine` 的下游还有第三份状态：
`draftTick`（:133）——一个纯粹用来"逼 `pathDrafts` 的 useMemo 重算"的计数器
（:171 把它列进依赖），因为真正的真源是 core 的
`subscribeChatAnnotateDraft` store（:182）。也就是**同一屏里三套刷新机制并存**：
appUi 依赖的 useEffect、focus 的 useFocusEffect、store 订阅 + 计数器。

**建议**：`previewEngine` 只保留 `useFocusEffect`（或只保留 useEffect，
按"是否需要在返回屏时重读"的产品口径二选一，删掉另一个）；
`draftTick` 换成 `useSyncExternalStore` 直接订阅
`subscribeChatAnnotateDraft`，计数器一并删掉。
**置信**：confirmed（两个 effect 均在挂载时执行，源码可核）。

---

### F-w9-mobileui-pro-22 | P3 | apps/mobile/src/components/agent/AgentEditorForm.tsx:157

```ts
const probe = new ToolRegistry();
registerBuiltinTools(probe);
```

**描述**：同一段"造一个探针 ToolRegistry 取内置工具名"在**仓内 8 处**逐字重复：
mobile `AgentEditorForm.tsx:157` 与 `:193`（同文件两遍）、
mobile `services/agent-yaml.service.ts:42`、`services/prompt-preview.service.ts:40`、
desktop `src/main/ipc/handlers/agent-registry.ts:144`/`:197`、
desktop `src/main/services/agent-yaml.service.ts:47`、
cli `src/agent/commands.ts:60` 与 `registry-commands.ts:131`。
每次都 `new ToolRegistry(); registerBuiltinTools(probe); probe.list()`。
core 侧已经有 `validateAgentDefinition(def, {registeredToolNames})`
（`domain/agent/logic/validate-agent-definition.ts:17`）与
`agent-tool.ts:197` 的"组装 upsert 校验选项"辅助，但**没有**一个
`listBuiltinToolNames()` 这样的现成出口，于是每个调用点各造一次。
本区占其中 2 处。

**建议**：core 导出 `listBuiltinToolNames(): readonly string[]`（内部缓存亦可），
8 处全部替换。
**置信**：confirmed（8 处位置均 grep 验证）。

---

### F-w9-mobileui-pro-23 | P3 | apps/mobile/src/components/vfs/VfsFileManager.tsx:397

```ts
const reloadVfsListOnly = useCallback(async () => { await reload(); }, [reload]);
```

**描述**：**零语义别名**。`reloadVfsListOnly` 的函数体就是 `await reload()`，
与 `reload`（:309）等价，被 8 处调用（:463, :568, :789, :819, :879, :924, :950 等），
而 `reload` 本身在 :423 的 effect 里也被调。名字暗示"只刷 VFS 列表"，
实际做的事包含 `buildListRows` + `getDirRule` + 可能的 `listCompiledRules`
（:318-327）——**名字在骗人**，后来者按字面理解会误判影响面。
另有一处同类：`canGoUp`/`handleGoUp`（:591-592）是 `currentPath !== root` 与 `goUp`
的裸别名，且 `useImperativeHandle`（:412-420）已经用同样的表达式又暴露了一次
`canGoUp`/`goUp` 给父组件——同一个判断在组件内有**三份**。

**建议**：删 `reloadVfsListOnly`，调用点直接用 `reload`；
`canGoUp`/`handleGoUp` 收敛到 `useImperativeHandle` 那一处定义。
**置信**：confirmed。

---

### F-w9-mobileui-pro-24 | P3 | apps/mobile/src/components/agent/prompt-collapse.ts:1

```ts
/**
 * 提示词内联输入的限高常量（UX 简化：不再折叠，超出 8 行内部滚动）。
 * ...
```

**描述**：**文件名与内容彻底脱节**。`prompt-collapse.ts` 9 行、只导出两个常量
（`PROMPT_INLINE_MAX_LINES` / `PROMPT_INLINE_MAX_HEIGHT`），**没有任何折叠逻辑**——
注释第一句就承认"不再折叠"。文件名会让搜代码的人以为这里有 collapse 实现。
更实际的问题：`PROMPT_INLINE_MAX_LINES`（:8）**只被测试消费**
（`__tests__/expandable-prompt-input.test.tsx:15,47`），
生产侧唯一引用的是 `PROMPT_INLINE_MAX_HEIGHT`
（`ExpandablePromptInput.tsx:28,137`）——即 8 行这个语义只活在断言里。
且 `PROMPT_INLINE_MAX_HEIGHT = 176` 是 `8 × 22` 的手算结果，
而 `22` 这个 lineHeight 的真源在 `form/FormTextInput.tsx`；
两处各写各的，改字号时不会同步。

**建议**：重命名为 `prompt-inline-limits.ts`；
`PROMPT_INLINE_MAX_LINES` 与 height 的关系用 `MAX_LINES * LINE_HEIGHT` 表达
（LINE_HEIGHT 从 FormTextInput 导出），彻底消掉手算常数。
**置信**：confirmed。

---

### F-w9-mobileui-pro-25 | P3 | apps/mobile/src/components/rich-content/sanitize-rich-html.ts:113

```ts
export function sanitizeRichHtml(html: string): string {
```

**描述**：与 `apps/desktop/renderer/layout/sanitize-annotate-preview-html.ts:24`
的 `sanitizeAnnotatePreviewHtml` 是**两份白名单**，且**已经分叉**：
desktop 那份的注释自称"与 Mobile sanitizeRichHtml **同源白名单思路**"，
但实际少了 mobile 的三样东西——
① `ALLOWED_CSS_PROPERTIES` 内联 style 属性白名单 + `transformTags` 过滤（mobile:21-33, 153-167）；
② `pre: [..., 'data-lang']`（mobile:142）；
③ desktop 多了一个 `allowVulnerableTags: true`（desktop:46）。
mobile 的 CSS 白名单是**有安全意图的**（:16-19 注释：「position/inset/transform… 一切可布局
劫持的属性均不在名单内，整体剥离——恶意 `position:fixed;inset:0` 全屏覆盖伪造 app 界面的
路径由此封死」），desktop 侧完全没有这道闸。
两份白名单共同维护、已不一致、且不一致的方向是**一端有安全防护另一端没有**。

**建议**：把 sanitize 配置收到一个共享模块（core 或
`packages/core/src/domain/format/rich-html-sanitize.ts`），两端共用；
desktop 是否需要 `allowVulnerableTags` 单独论证并写进注释。
**置信**：confirmed（三处差异逐行比对）。

---

### F-w9-mobileui-pro-26 | P3 | apps/mobile/src/components/agent/ExpandablePromptInput.tsx:13

```ts
 * 初始视口置顶：…这里挂载后一拍短暂把 selection 置 0 …
 * 真机行为待验收确认。
```

**描述**：**注释里写着"待验收"的行为已进主干**。:66-71 的 `setTimeout(…, 0)`
在每次挂载时强行把光标置到文档开头（`setInitialSelection({start:0, end:0})`），
注释自己标注"**真机行为待验收确认**"。这不是纯冗余而是**未验收的交互副作用**：
任何在此包裹的字段（system 内容 / persist 块 / dynamic 块 / 自定义附加信息，
见 `PersistBlocksCard.tsx:180`、`DynamicBlocksCard.tsx:187`、
`PromptLayoutSection.tsx:110` 等 5+ 处）挂载后第一帧都会被拉到文首，
用户接着打字就会在**开头**而不是接着上次位置。
同文件另一处同类未验收信号：`PROMPT_INLINE_MAX_HEIGHT` 限高与 desktop
`PromptCollapsibleField.tsx`（106 行）行为不同（desktop 是可折叠、mobile 是固定 8 行），
两端 UX 未对齐也无记录。

**建议**：要么补真机验收并把结论写进注释，要么撤掉这段置顶；
至少不能以"待验收"的状态长期留在主干。
**置信**：confirmed（注释原文即证据；行为后果为推断，未跑真机）。

---

### F-w9-mobileui-pro-27 | P3 | apps/mobile/src/components/ui/ModalShell.tsx:68

```ts
export function ModalShell({visible, onClose, variant = 'bottom', ..., standalone = false, children}: Props) {
```

**描述**：`ModalShell` 有 **13 个 props**，其中 `keyboardAvoid`（三形态
`none`/`translate`/`adaptive`）× `iosTranslateY` × `keyboardVerticalOffset` ×
`maxHeightRatio` 这一组占了 4 个 prop、承载了 :83-102 与 :152-155 两段平台分支逻辑
（Android 走 `useAndroidModalKeyboardAvoid` 的 translateY、iOS 走
`KeyboardAvoidingView` padding、adaptive 再叠一层 `useAdaptiveKeyboardSheetStyle`
的 maxHeight 收缩）。两个键盘 hook 是**无条件调用**的（:85-96，注释解释为守 hooks 规则），
未选中的那份样式算出来再丢掉。调用点必须知道"自己该传 fraction 0.5 还是 1、
adaptive 要不要 iosTranslateY"——这些知识散落在 10+ 个调用点的注释里
（`ToolPolicyPicker.tsx:104-106`、`DirectoryRuleSheet.tsx:69-71`、
`TextPromptModal.tsx:112`、`VfsPromptModal.tsx:52` …）。
这不是 bug，是**参数空间爆炸**：同一语义（"我这个弹层有输入框、贴底、要避让"）
被四个 prop 的组合编码，缺一个就静默走错分支。

**建议**：收敁为 2–3 个语义档位 prop（如
`keyboard: 'none' | 'short-sheet' | 'tall-sheet' | 'centered-dialog'`），
平台差异与 ratio 全部封在组件内；调用点只表达意图。
**置信**：confirmed（prop 数与分支点已逐行核）。

---

## 争议与存疑

1. **F-06 的 `fillPolicy: 'full'` 映射分叉不是纯冗余，是行为分叉。**
   mobile `normalizeFillPolicyForMobile`（`services/fill-policy-mobile.ts:10`）把
   legacy `full` 映到 `hidden`；desktop `DirectoryRuleModal.ts:37-46` 的
   `normalizeFillPolicy` 把 `full` 落到 `DEFAULT_WORKPLACE_DIR_RULE.fillPolicy`
   （core `default-dir-rule.ts:21` = `header`）。**同一份存量 rule 行，
   在两个 app 的表单里会显示成不同选项**。我不确定哪个是拍板值——
   也许 mobile 是后改的（`fill-policy-mobile.ts` 文件名带 `-mobile` 后缀，
   暗示"这是 mobile 专属补丁"），也许 desktop 是遗漏。**需要用户或迭代文档拍板**，
   本报告不替它选。置信：分叉 confirmed，取舍 suspected。

2. **F-25 的 `allowVulnerableTags: true`（desktop）我不确定是否有意。**
   sanitize-html 的这个选项会放行 `<script>` 之类的"vulnerable"标签解析路径。
   desktop 那份白名单里 `DISALLOWED_TAGS` 已经含 `script`，所以实际暴露面可能有限；
   但 mobile 没有这个选项、desktop 有，说明**当初有人为它做过决定**，
   而决定的理由没留在代码里。**需要 desktop 侧机位或辩护者补充上下文**，
   我不主张直接删。置信：差异 confirmed，是否为缺陷 suspected。

3. **F-02 的数组判定漂移（`'name' in raw` vs `!Array.isArray(raw)`）我判定为当前不可见。**
   registry 的 `getRawWire` 返回的是 JSON 对象，数组带 `name` 属不存在的输入。
   所以我把它降级处理、不单列为 P2，只在 F-02 里作为"口径已漂"的证据。
   若辩护者能证明 raw 恒为对象，这条论据可撤；但**四份实现本身仍是冗余**。

4. **F-26 的真机影响我未实测。** "挂载后视口被拉到文首"是我从
   `setTimeout(…, 0) → setInitialSelection({start:0,end:0}) → renderInline(ctx)`
   的数据流推出的，源码路径清楚，但**没跑真机**。按本仓 RULE「条数/行号/计数类结论
   一律实测复核」的纪律，这条应标 suspected，等真机确认后再定级。

5. **F-03 的"desktop 那份 prompt-macro-input 是否已被判为迁移中间态"我不掌握。**
   desktop 的 `PromptMacroTextarea.tsx:80` 仍在生产调用 `tryAtomicMacroDelete`，
   所以 desktop 侧不是死代码；只有 **mobile 侧**那两个函数是死的。
   若上层已决定"整条 prompt 宏链要迁到共享 web 引擎"，本条应并入那条迁移的
   清理清单而非独立立项。置信：mobile 侧死代码 confirmed。

6. **关于"是否该把 mobile 组件层的纯逻辑一律上提 core"这一整体判断。**
   本报告 F-02/03/04/05/06/09/10/22 共 8 条都指向同一动作（纯逻辑回 core）。
   我认为**该做**，但这是一件跨 8+ 文件、牵动三个 app 的重构，
   规模上不属于"批内优化"，建议主代理在 L3 台账里把它聚成**一条**带子项的条目，
   而不是拆成 8 条独立 backlog——否则会被当成 8 次小改动分别落地，
   每改一次都要重新面对"还有哪几处没迁"的全局问题。

---

## 附：本机位的方法说明（供 reduce 参考）

- 死代码判定口径：`git grep <symbol>` 全仓（`-- '*.ts' '*.tsx'`）零命中，
  或仅命中 `__tests__/`；辅以"文件级零 import"扫描（逐文件按 basename 找 import）。
- 双源判定口径：①同名函数跨端/跨文件存在且**函数体归一化后逐字符相同**；
  ②同名文件两端相似度 >25%（逐行集合 Jaccard）；③文件级人工 diff。
- 「写一份指令对齐」型重复（用注释点名对端）单独识别，见 F-03/F-09/F-12/F-18/F-25。
- 数字结论均实测：15 个图标中 3 个零引用、`ListBatchBar` 全文件零 import、
  `moveDynamic` 三份、`new ToolRegistry()` 探针 8 处、
  `formatVfsError` 生产零引用——均为 `git grep` 实数，未照抄其他文档。