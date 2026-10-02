---
zone: mobile-ui
agent: domain-survey
files_scanned: 102
---

# W2 按域测绘：apps/mobile/src/components/（跳过 chat/）+ theme/ + errors/ + debug/

## 摘要

移动端 UI 层。承载三类东西：① 通用 UI 原语（按钮 / 卡片 / 表单字段 / 弹层骨架 ModalShell / 底部菜单 / 列表选择器 / 批量条），② 业务视图组件（VFS 文件管理器、文件编辑器 WebView 壳、Markdown 预览、Agent 编辑器、设置类表单、技能面板、数据统计图表），③ 富文本管线（markdown-it → highlight.js → sanitize-html → WebView）。另有 theme/（亮暗 token + ThemeProvider）、errors/（Core 错误 → 中文文案）、debug/（__DEV__ 打点）。全部为 RN 视图层 + 少量纯函数，桌面端 renderer 有大面积同构实现。

## 职责与边界

- **不碰数据**：所有 VFS / workplace / provider / agent 操作都经 `useRuntime()` 拿服务再调；组件只做编排、状态与错误 toast。
- **不碰导航**：除 `AppHeader`（读 `HeaderContext` 的 stackOverride）与少量 `navigation.navigate` 外，导航由 screens 层负责。
- **与 core 的边界**：业务语义（front matter 解析、目录规则求值、agent 表单 ⇄ definition 映射、模型 displayName）一律下沉 core；本区只剩展示映射。
- **与 web/ 的边界**：`components/rich-content/*` 负责 RN 侧产出 HTML 字符串；渲染执行在 `src/web/**`（另一机位）。

## 对外接口（关键导出）

| 符号 | 位置 | 性质 |
|---|---|---|
| `ThemeProvider` / `useTheme` | `theme/ThemeProvider.tsx` | 全局唯一主题真源 |
| `ThemeTokens` / `tokensForMode` | `theme/tokens.ts` | 20 个色 token × 亮暗 |
| `formatError` | `errors/format-error.ts` | Core 错误 → 用户文案（20 处调用） |
| `toastMessage` | `errors/toast-message.ts` | 「标题：错误」拼接（148 处调用） |
| `resetRunTiming`/`timingLog`/`rollbackTimingLog`/`bootTimingLog` | `debug/run-timing.ts` | __DEV__ 打点轴 |
| `ModalShell` | `components/ui/ModalShell.tsx` | 全应用弹层骨架（9 处） |
| `AppModal` | `components/ui/AppModal.tsx` | 带 focus gate 的 Modal（7 处） |
| `PickerListModal` | `components/ui/PickerListModal.tsx` | 列表单选骨架（4 处） |
| `ManageHeader` / `BatchCheckbox` | `components/batch/*` | 批量模式条（8/9 处） |
| `VfsFileManager` + `VfsFileManagerHandle` | `components/vfs/VfsFileManager.tsx` | VFS 浏览器（4 个挂载点） |
| `FileMarkdownPreview` | `components/vfs/FileMarkdownPreview.tsx` | md 预览 + Front Matter 卡片 |
| `RichDocumentWebView` / `CodeEditorWebView` | `components/vfs/*` | 两个 WebView 壳 |
| `sanitizeRichHtml` / `prepareTranscriptRichHtml` | `components/rich-content/*` | 富文本唯一消毒口 |
| `PieChart` / `StackedBars` | `components/charts/*` | 统计图表 |
| `useAgentEditorFormState` | `components/agent/agent-editor/` | agent 表单状态容器 |
| `tryAtomicRangeDelete` | `components/common/atomic-range-delete.ts` | 原子删区间泛化 |

## 数据访问

本区**不直接访问表**。所有数据经 `useRuntime()`（`hooks/useRuntime.ts` → `runtime/novel-master-context`）转发到 core service。间接触碰：

- **KKV `nm-mobile-ui` / key `theme`**：`theme/ThemeProvider.tsx:41` `appUi.get(APP_UI_KEY_THEME)`、`:71` `appUi.set(...)`。键定义 `storage/app-ui-keys.ts:10`，默认值 `:40`（`'light'`）。
- **VFS 表（经 core）**：`VfsFileManager.tsx:319` `vfsSvc.list(currentPath)`、`:321` `workplaceSvc.getDirRule(currentPath)`、`:326` `runtime.smartSortRule.listCompiledRules()`、`:947` `workplace.setDirRule(...)`、`:456`/`:808` `deleteScopedVfsEntry`。
- **chat annotate draft（进程内 store）**：`FileMarkdownPreview.tsx:170` `listChatAnnotateDrafts(sessionId)`、`:182` `subscribeChatAnnotateDraft`、`:212` `addChatAnnotateDraft`、`:250` `removeChatAnnotateDraft`、`:270` `updateChatAnnotateDraft`。
- **agent registry（经 core）**：`AgentList.tsx:151/166/236/244/260`、`useAgentEditorFormState.ts:301`。
- **usage stats**：`MetricDetailSheet.tsx:69` `runtime.usageStats.getSessionUsageDetail(sessionId)`。
- **provider / saved models**：`ModelPickerModal.tsx:59/68/71/82`、`useAgentEditorFormState.ts:228/242/244`。
- **文件路径**：无本地文件读写；WebView 只加载打进 APK 的 `file:///android_asset/webview/...`（`webview-host/rich-document/uri.ts`、`webview-host/code-editor/uri.ts`）。

## 依赖关系

**import 了谁**（去重后）：
- `@novel-master/core` 子路径：`/vfs`（6 文件）、`/workplace`（5）、`/agent`（4）、`/chat`（3）、`/provider`（3）、`/config-forms/agent`（3）、`/skills`（2）、`/common`、`/feature-flags`、`/session-fs`、根 barrel（2）
- 仓内非本区：`theme/`（29 文件 `useTheme` + 24 文件仅类型）、`hooks/`（`useRuntime`/`useTheme` 侧 12）、`services/`（9）、`screens/`（**2，层逆反，见 F-13**）、`errors/`（18）、`runtime/novel-master-context`
- 第三方：`react-native-webview`、`react-native-svg`、`react-native-reanimated`、`react-native-keyboard-controller`、`sanitize-html`、`markdown-it`、`highlight.js`、`react-native-safe-area-context`

**被谁消费**：`screens/**`（29 文件直接 import 本区组件）、`navigation/RootNavigator.tsx`、`hooks/useVfsBackNavigation.ts`、`hooks/useDismissOverlaysOnBlur.ts`、`web/composer-input/webview/runtime/editor.ts`（反向 import `@/components/agent/prompt-macro-input`）。

## 发现清单

### P1

**F-mobile-ui-1 | P1 | `components/vfs/VfsFileManager.tsx:397-399`**
```ts
const reloadVfsListOnly = useCallback(async () => {
  await reload();
}, [reload]);
```
`reloadVfsListOnly` 是 `reload` 的零成本别名，10 处调用点（`:463 :568 :657 :789 :819 :879 :924 :950` 等）却各自包一个 `useCallback`，让 `confirmBatchDelete`/`runBatchMove` 的依赖数组多出一层恒等引用。更实质的问题在 `:309-313`：`reload` 用 `reloadInFlightRef` 做**丢弃式**并发去重——第二次调用直接 `return`，不排队、不合并。若用户「删除 → 立即刷新」时前一次 reload 仍在飞（VFS list + buildListRows + getDirRule 三路并发，弱网可达数百 ms），这次刷新被静默吞掉，列表停留在删除前的快照，且没有再触发点。**建议**：`reload` 改为「飞行中置 pending，落地后若 pending 再跑一轮」；顺手删掉 `reloadVfsListOnly`，全部调用点直呼 `reload`。**置信 confirmed**

### P2

**F-mobile-ui-2 | P2 | `components/vfs/vfs-move-path.ts:1-44`**
```
 * VFS 批量移动用的纯路径工具（从 desktop vfs-tree-dnd 拷贝，暂不抽 core）。
```
文件头自陈是从 desktop 复制的。实测 `isSelfOrAncestorPath` / `resolveMoveDestination` 与 `apps/desktop/renderer/features/workspace/vfs-tree-dnd.ts:36-68` **逐字相同**（仅引号风格差异）。注释同时承认「暂不抽 core」——这是**有意识的暂态**，但已跨了多个迭代未收口，且两侧各有独立测试（`__tests__/vfs-move-path.test.ts` 与 `apps/desktop/test/vfs-tree-dnd-move.test.ts`），断言重复维护。**建议**：抽到 core `domain/vfs/logic/`（`packages/core` 已有 `normalize-for-match.ts` 等同类纯函数先例），双端各留一行 re-export。**置信 confirmed**

**F-mobile-ui-3 | P2 | `components/vfs/vfs-row-mapper.ts:31-54` vs `apps/desktop/renderer/features/workspace/vfs-tree-utils.ts:42-93`**
```ts
export function parentLogicalPath(path: string): string | null {
  if (path === '/') { return null; }
  const idx = path.lastIndexOf('/');
  if (idx <= 0) { return '/'; }
  return path.slice(0, idx);
}
```
`parentLogicalPath` / `isDirectChild` / `entryName` 三函数在 desktop 侧**逐字重复**（desktop 文件头 `:1` 甚至写着 "aligned with mobile vfs-row-mapper"）。这三者是最纯的路径原语，属于典型 core 料（core 已有 `domain/vfs/logic/`）。**建议**：与 F-2 一并抽 core。**置信 confirmed**

**F-mobile-ui-4 | P2 | `components/agent/prompt-macro-input.ts:1-163` vs `apps/desktop/renderer/features/settings/prompt-macro-input.ts`**
实测 `diff` 两文件：`isWhitelistRootMacroInner`、`findWhitelistMacroRanges`、`tryAtomicMacroDelete`、`insertTextAtSelection`、`PROMPT_INSERTABLE_MACROS` 五个函数**逐字重复**（desktop 另有 `renderPromptMacroHighlightHtml`，mobile 另有 `splitPromptMacroSegments`，是形态差异而非逻辑差异）。同一仓内两套白名单宏解析器，改一处忘另一处不会编译报错——只会在真机上表现为「一端认得 `$time` 另一端当普通文本」。**建议**：抽 core（`ALLOWED_DYNAMIC_ROOT_MACROS` 已经在 core，函数跟着走最自然）。**置信 confirmed**

**F-mobile-ui-5 | P2 | `components/vfs/VfsFileManager.tsx:997-1006`**
```ts
const badgeColors = (tone: 'in' | 'follow' | 'muted') => {
  switch (tone) {
    case 'in':  return {backgroundColor: '#dbeafe', color: tokens.primary};
    case 'muted': return {backgroundColor: tokens.border, color: tokens.textSecondary};
    default: return {backgroundColor: '#fef3c7', color: '#92400e'};
  }
};
```
三个 badge 配色里两个是**硬编码浅色**（`#dbeafe` 淡蓝 / `#fef3c7` 淡黄 + `#92400e` 深棕），不随 `tokens.mode` 变化。暗色模式下浅黄底 + 深棕字虽然可读，但淡蓝底（`#dbeafe`）配暗色主题的 `tokens.primary`（`#0A84FF`）对比度骤降——`#0A84FF` on `#dbeafe` 约 2.3:1，低于 WCAG AA 的 4.5:1。此外 `badgeColors` 在 `:1151` 与 `:1159` 被同一处渲染**调用两次**，每次新建对象。**建议**：把三档 badge 色补进 `theme/tokens.ts`（如 `badgeIn/badgeInFg/badgeFollow/badgeFollowFg/badgeMuted/badgeMutedFg`），亮暗各给值；渲染时算一次存局部变量。**置信 confirmed**

**F-mobile-ui-6 | P2 | `components/charts/PieChart.tsx:22`**
```ts
import {styles} from '@/screens/stack/token-usage/styles';
```
`MetricDetailSheet.tsx:15` 同款：`import {hitRate, formatHitRate} from '@/screens/stack/token-usage/format'`。**组件层反向 import 页面层**——`components/` 是被 `screens/` 消费的下层，这里形成 `components → screens → components` 的环（`screens/stack/token-usage/SummaryTab.tsx` 又 import `PieChart`）。移动端 Metro 能跑（无 ESM 环检测），但任何一次文件挪动都可能把它变成真 require-cycle（RULE「模块级 import 的 require-cycle 在依赖解析顺序变化时才暴露」正是这条）。**建议**：把这两个依赖下沉——`hitRate`/`formatHitRate` 是纯展示格式化函数，移到 `components/common/` 或直接进 core（desktop 侧已有同名同实现的 `apps/desktop/shared/logic/hit-rate.ts`，正好可一并对齐）；图表样式移到 `components/charts/styles.ts`。**置信 confirmed**

**F-mobile-ui-7 | P2 | `components/skills/skill-ui.ts:48-71` vs `apps/desktop/renderer/features/skills/skill-ui.ts:21-35`**
```ts
function yamlScalar(value: string): string { return JSON.stringify(value); }
export function buildNewSkillDoc(name, description) {
  return ['---', `name: ${yamlScalar(name)}`, ...
```
mobile 侧对 name/description 做了 YAML 双引号转义；desktop 侧是裸插值 `` `name: ${name}` ``。技能名若含 `:` 或换行（`validateSkillName` 只禁空白 / `/` / 前导 `.`，**不禁冒号**），desktop 生成的 front matter 会被 YAML 解析器截断，name 与后续键错位；mobile 正确。同名函数、同名文件、双端行为不同——是最典型的「双端实现漂移」样本。**建议**：`buildNewSkillDoc` 与 `yamlScalar` 抽 core（core 已有 `withSkillFrontMatterValues` 走同一套 yamlScalar，见 `packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts:27`），或至少给 `validateSkillName` 补禁冒号。**置信 confirmed**

**F-mobile-ui-8 | P2 | `components/agent/agent-editor/useAgentEditorFormState.ts:278-290`**
```ts
setSavedBaseline(formSnapshotJson({
  name: def.name, maxSteps: String(def.runtime?.maxSteps ?? 20),
  modelEnabled: modelEnabledWire, providerId: baselineProviderId,
  savedModelId: baselineSavedModelId, toolsMode: toolsWire.mode,
  toolsSelected: [...toolsWire.selected],
  ...promptForm, persist: [...promptForm.persist],
}));
```
baseline 是**手拼的第二个快照**，与 `:220` 的 `formSnapshotJson(form)` 是同一函数的两处独立调用点，但入参对象由人工枚举。任何时候 core 侧 `AgentEditorFormInput` 增删字段（如本迭代已加的 `description`），这里漏一个字段 → 打开即 `isDirty=true`（`:225` `snapshot !== savedBaseline`），用户看到「有未保存的更改」却什么都没改；反向漏字段则是「改了东西但提示不出未保存」。注意这里手拼对象还刻意省略了 `mode`（`formSnapshotJson` 也不序列化 `mode`，所以恰好没事——纯属巧合，不是设计）。同文件 `:115-144` 的 `formStateFromDefinition` 已经把「def → 全量表单状态」的映射收敛成单源，本函数却绕开它另拼一份。**建议**：baseline 改为 `setSavedBaseline(formSnapshotJson({...formStateFromDefinition(def), modelEnabled, providerId, savedModelId, toolsMode, toolsSelected}))`，与 `setForm` 用同一份映射。**置信 confirmed**

**F-mobile-ui-9 | P2 | `components/vfs/RichDocumentWebView.tsx:76-85` 与 `:344-366` vs `components/vfs/CodeEditorWebView.tsx:57-69` 与 `:192-214`**
两处 `themeFromTokens`（不同消息载荷类型，属合理分叉）之外，`shouldStartLoadWithRequest` + `handleOpenWindow` 这一对**安全关键**的 WebView 导航守卫在两个文件里**逐字重复**（含同样的注释块「sec/D-1：只放行包目录内的 file:// 加载」）。加上 chat 侧的 `ChatTranscriptWebView.tsx:1782-1806` 与 `ComposerInputWebView`，同一仓内 **4 份**同款守卫。任何一次安全收紧（如加 `blob:` / `data:` 拒绝）漏改一处就是一个 WebView 后门。**建议**：抽 `components/vfs/webview-nav-guard.ts`（或 `webview-host/shared/`），导出 `makeShouldStartLoadWithRequest(pkgDirUri)` + `handleOpenWindow`，四处共用。**置信 confirmed**

**F-mobile-ui-10 | P2 | `components/theme` 无 / `theme/ThemeProvider.tsx:34-64`**
```ts
useEffect(() => {
  ...
  appUi.get(APP_UI_KEY_THEME).then(raw => { ... })
}, [appUi, system]);
```
主题真源有**两处不一致的回退**：`storage/app-ui-keys.ts:40` 的 `APP_UI_DEFAULTS[APP_UI_KEY_THEME] = 'light'`，而 `ThemeProvider` 自己在 key 缺失时走 `system === 'dark' ? 'dark' : 'light'`。也就是说「用户设备是暗色但从未手动切过主题」时，AppUi 层声明的默认值是 light、ThemeProvider 实际给 dark。两者只要有一处被当成权威，行为就分叉。当前 `loaded` 标志（`:32 :53 :89`）**全仓零消费者**（实测 `grep -rn "useTheme()" … | grep loaded` 无结果），说明「加载完成前用哪个值」这件事根本没被处理——首帧恒为 light（`:31` `useState<ThemeMode>('light')`），暗色用户每次冷启动都会闪一下白。**建议**：`ThemeProvider` 读 `APP_UI_DEFAULTS` 而非内联字面量；首帧 `mode` 初值改 `'system'`（新增第三态）或直接从 `useColorScheme()` 取，消费方按 `loaded` 决定是否渲染。**置信 confirmed**

**F-mobile-ui-11 | P2 | `components/provider/ModelPickerModal.tsx:38-40` / `:92-96`、`screens/stack/ProviderDetailScreen.tsx:63` / `:108-117`、`components/agent/agent-editor/useAgentEditorFormState.ts:405-412` / `:424`**
「同名模型按 providerId 分组计数、重复才显示 vendorModelId 副标题」这段逻辑在 **3 处**独立实现，`modelNameKey` / `nameCounts` / `modelNameCounts` 三个近义私有函数名并存（`useAgentEditorFormState` 甚至内联了 `` `${m.providerId}\0${m.modelName}` `` 而不复用本文件的 `modelNameKey`）。三处注释都写着「重复计数与 ModelPickerModal 同口径」，即作者自己知道这是必须同步的口径，但没有任何机制保证同步。**建议**：抽 core（`domain/provider/logic/`，紧邻已有的 `format-saved-model-display-name.ts`），产出一个 `buildSavedModelOptions(providers, savedModels)` 返回 `{value,label,subtitle}` 数组，三处直吃。**置信 confirmed**

### P3

**F-mobile-ui-12 | P3 | `components/batch/ListBatchBar.tsx:15`（整文件）**
`ListBatchBar` 全仓零引用（`grep -rn "ListBatchBar" apps packages` 只命中定义行）。功能已被 `components/batch/ManageHeader.tsx:74-128` 的 batchMode 分支完整覆盖（取消 / 已选 N 项 / 删除 + 禁用规则 + hint 全齐），实测 8 个调用点用的都是 ManageHeader。**建议**：删除整个文件（57 行）。**置信 confirmed**

**F-mobile-ui-13 | P3 | `components/icons/TabIcons.tsx:26` `:281` `:296`**
`AgentTabIcon` / `ZipExportIcon` / `ZipImportIcon` 三个图标零引用（实测 `TabIcons` 的 7 个 import 点只取 `BackIcon / MenuIcon / MoonIcon / SunIcon / ParentDirIcon / SyncPullIcon / SyncPushIcon / HelpIcon / ChatTabIcon / ProfileTabIcon`）。ZIP 导入导出在 `VfsFileManager` 走的是 BottomSheetMenu 文字项（`:612-614`、`:636-638`），根本没接图标。**建议**：删三个函数（约 40 行 SVG path）。**置信 confirmed**

**F-mobile-ui-14 | P3 | `components/skills/skill-ui.ts:33-41`**
`skillDomainHintLabel` 零引用。注释说「详情页 / 编辑器顶栏的域说明文案」，但 `SkillDetailScreen` 实际用的是 `FormSectionCard`（`SkillDetailScreen.tsx:139-155` 只渲染 `VfsFileManager`），文案从未落地。**建议**：删除，或反过来把它接到技能详情页（看产品意图）。**置信 confirmed**

**F-mobile-ui-15 | P3 | `components/vfs/vfs-row-mapper.ts:210-213`**
```ts
/** @deprecated Use {@link mapVfsListEntry}. */
export function mapVfsFilePath(path: string): MappedVfsRow {
  return mapVfsListEntry({path, kind: 'file'});
}
```
已标 `@deprecated`，生产零引用，唯一消费者是 `__tests__/vfs-row-mapper.test.ts:149`。按 RULE「退役件物理删除」惯例应连测试一起删。**建议**：删除函数 + 该测试用例。**置信 confirmed**

**F-mobile-ui-16 | P3 | `components/ui/card-styles.ts:48-51`**
```ts
export const chevron: TextStyle = {fontSize: 22, fontWeight: '300'};
```
文件头宣称是「卡片基础样式单源」（cr-fix-spec comp-rest/C-7，「之前在 ElevatedCard / ProfileMenuItem / ProfileSwitchItem / FormSectionCard 四处逐字复制」）。实测收敛并不彻底：`chevron` 只有 `ProfileMenuItem.tsx:37` 一个消费者，而**同样字面量在 3 处重新声明**——`components/agent/AgentList.tsx:573`、`components/ui/ConfigListCard.tsx:91`、`screens/tabs/chat-tab/ChatSessionListPanel.tsx:428`，全是 `{fontSize: 22, fontWeight: '300'}`。`menuDots: {fontSize: 18, paddingHorizontal: 4}` 同样散落 3 处（`ConfigListCard.tsx:90`、`AgentList.tsx:572`、`ProjectDrawer.tsx:356-359`）。**建议**：把 `chevron` / `menuDots` 补进 card-styles 并让 4 处统一 import（跨 components/screens，card-styles 已是这种公共位置）。**置信 confirmed**

**F-mobile-ui-17 | P3 | `components/rich-content/highlight-code.ts:25-45` vs `apps/desktop/renderer/components/code-block.tsx:15-35`**
```ts
export const LANG_ALIAS: Record<string, string> = {typescript:'typescript', ts:'typescript', ...};
```
20 个 key 的归一化表在双端各存一份，两侧注释都写「与对方保持同一张表，任一端增删语言须双端同步（T-CB13 一致性契约）」。与 F-2/3/4/7 不同，**这一处是明确拍板的双端契约**（有 `apps/desktop/test/code-block-render.test.tsx:242` 与 `apps/mobile/__tests__/code-block-render.test.tsx` 两套对称测试守着）。但测试是各自断言自己的表，**没有跨端比对**，所以「表本身写错」照样双绿。**建议**：按 intentional 处理（保留现状），但把表挪到 core（`ALLOWED_DYNAMIC_ROOT_MACROS` 已经在 core），或加一条跨仓 fixture 比对断言，把「约定」升级为「机制」。**置信 intentional**

**F-mobile-ui-18 | P3 | `components/errors/format-error.ts:83-86`**
```ts
/** @deprecated Prefer {@link formatError}; kept for VFS call sites. */
export function formatVfsError(error: unknown): string { return formatError(error); }
```
生产零调用，唯一链路是 `apps/mobile/src/vfs/errors.ts:4` 的 re-export 与 `__tests__/errors.test.ts` 五个用例。注释说「kept for VFS call sites」，但实测没有任何 call site 走它。**建议**：删函数 + 删 `vfs/errors.ts` 的 re-export + 测试迁到 `formatError`。**置信 confirmed**

**F-mobile-ui-19 | P3 | `components/theme/ThemeProvider.tsx:21` `:32` `:89`（`loaded`）**
见 F-10 的证据：`loaded` 是公开 API 但零消费者，等于「主题尚未从 KKV 读回来」这个状态在 UI 层不可见。**建议**：接上（首帧不渲染或用 system 色），或删。**置信 confirmed**

**F-mobile-ui-20 | P3 | `components/vfs/FileMarkdownPreview.tsx:66-71`**
```ts
function newAnnotateId(): string {
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
```
批注 id 用 `Date.now()+Math.random()` 现造。core 侧 `addChatAnnotateDraft` 收的就是这个 id，而 `AnnotatePickModal.tsx:33` 用它当 React `key`、`RichDocumentWebView` 用它做 Recogito mark 的稳定键。同毫秒内批量建稿有理论碰撞面（36^8 空间下实际概率可忽略，但契约上是「非保证唯一」）。**建议**：改用 core 的 id 生成器（若 core 已有）或 `crypto.randomUUID()` 的 polyfill。**置信 suspected**

**F-mobile-ui-21 | P3 | `components/vfs/VfsFileManager.tsx:605-642` + `:1185-1196`**
`entityMenuItems` / `moreMenuItems` 每次渲染重建数组字面量并作为 `BottomSheetMenu` 的 `items` prop 传入，无 `useMemo`。同文件 `:233-250` 的 `vfsBatch` 反而规规矩矩做了 `useMemo`，标准不一致。实际代价低（`ModalShell` 未挂载时不消费），但 `DirectoryRuleSheet` 的 `initial={dirRuleInitial}` 会在 `onSave` 里被回写（`:1205`）造成二次打开闪动。**建议**：低优先，暂不动；若要动则把两组菜单 item 提为模块级常量 + 参数化（label 与 action 映射与 `workplace != null` / `readOnly` 无关）。**置信 suspected**

**F-mobile-ui-22 | P3 | `components/agent/ToolPolicyPicker.tsx:41-49` vs `apps/desktop/renderer/features/settings/ToolPolicyPicker.tsx:12-20`**
`buildTriggerLabel` 在双端**逐字重复**（实测 diff 三个分支字符串完全一致）。同 F-2/3/4 的家族，但体量小（9 行），且与 `BUILTIN_TOOL_CATALOG.length` 耦合，抽 core 收益一般。**建议**：随 F-4 的抽取顺带处理，或接受现状。**置信 confirmed**

**F-mobile-ui-23 | P3 | `components/provider/SamplingForm.tsx:22-89` vs `apps/desktop/renderer/features/settings/SamplingForm.tsx`**
`numStr` / `parseNumber` / `patchOpenAi` / `patchAnthropic` / `patchGemini` 五个纯函数与三段字段清单（openai 3 项 / anthropic 4 项 / gemini 4 项）在双端**逐字重复**（实测 diff：除 RN 的 `View`/`FormField` 包装与引号风格外全同）。字段清单若在 core 加一项（如 o1 系列的 `reasoning_effort`），两端要各改一次。**建议**：抽 core `domain/provider/logic/sampling-fields.ts`，产出「协议 → 字段定义数组」，两端各按数组 map 出各自控件。**置信 confirmed**

**F-mobile-ui-24 | P3 | `components/sheet/DirectoryRuleSheet.tsx:41-57` + `:258-264` vs `apps/desktop/renderer/features/workspace/DirectoryRuleModal.tsx:19-54`**
`SORT_FIELDS` / `SORT_ORDERS` / `FILL_POLICIES` 三个选项表 + `clampCount` 在双端各一份（mobile 用 `normalizeFillPolicyForMobile`、desktop 用私有 `normalizeFillPolicy`，见 F-25）。`SORT_FIELDS` 连**顺序都不同**：mobile 把 `smart` 放首位（`:42`，PickerListModal 列表形态），desktop 放末位（`:23`）。**建议**：随 F-25 一并下沉 core。**置信 confirmed**

**F-mobile-ui-25 | P3 | `components/sheet/DirectoryRuleSheet.tsx:26` vs `apps/desktop/renderer/features/workspace/DirectoryRuleModal.tsx:37-46`**
```ts
// mobile (services/fill-policy-mobile.ts:7)
if (fillPolicy === 'full') { return 'hidden'; }   // 其它未知值也 → 'hidden'
// desktop (DirectoryRuleModal.tsx:37)
return DEFAULT_WORKPLACE_DIR_RULE.fillPolicy;      // 未知值 → 'header'
```
同一个遗留 `fill` 策略：mobile 映射成「不展示」，desktop 映射成「头信息」。core 的 `FillPolicy` 里 `full` 是 deprecated 值（`DEFAULT_WORKPLACE_DIR_RULE.fillPolicy === 'header'`，`default-dir-rule.ts:21`），双端各自的归一化结果**不同**，用户在同一份数据上两端看到不同选项被选中。**建议**：归一化函数抽 core 单源（推荐映射到 `header`，与 `DEFAULT_WORKPLACE_DIR_RULE` 一致，语义上 `full` 更接近 `header` 而非「不展示」）。**置信 confirmed**

## 有意冗余（标 intentional，不建议改）

| 位置 | 内容 | 出处 |
|---|---|---|
| `components/rich-content/highlight-code.ts:6-11` | 注册 10 个 highlight.js 语言子模块，「注册表与 desktop MermaidMarkdown 的 languages 选项同源，任一端增删语言须双端同步（T-CB13）」 | 本仓既定契约，双端各带测试 |
| `components/vfs/RichDocumentWebView.tsx:42-45` | 自定义划词菜单必须自备「复制」（盖掉原生 Copy） | react-native-webview `menuItems` 语义限制 |
| `components/debug/run-timing.ts:1-30` | `__DEV__` 门控的临时诊断打点，生产全 no-op | RULE 明确记载为诊断工具，非死代码（17 处调用点） |
| `components/agent/PromptMacroTextInput.tsx:5-8` | 「RN 侧 FormTextInput + children 着色链随 WebView 化整体退役」，故 `splitPromptMacroSegments` / `tryAtomicMacroDelete` 在 RN 侧只被测试引用 | 迁移已完成，注释是决策留痕 |
| `components/common/atomic-range-delete.ts:10-17` | 「算法骨架与原 `tryAtomicMacroDelete` 一致，仅把宏白名单区间参数化」 | 泛化后原函数保留被测试做等价性对照（`__tests__/atomic-range-delete.test.ts:79` 显式断言两者逐组等价） |
| `components/ui/card-styles.ts:1-6` | 卡片基础样式单源（comp-rest/C-7），已消除 4 处逐字复制 | 收敛本身是有意决策；残留未收敛部分见 F-16 |
| `components/vfs/file-annotate-gate.ts:13-17` | 批注入口门闩「仅 previewMode + session scope」 | RULE 已记录小米/HyperOS 上批注不可用是拍板 hold，不是 bug |

## 争议与存疑

1. **F-1（reload 丢弃式并发去重）我给 confirmed，但严重度存疑。** 「静默丢刷新」在代码上确凿（`reloadInFlightRef` 无排队、无合并、无 finally 补跑），但要真触发需要「用户操作恰好落在一次慢 reload 的飞行窗口内」。我没有真机复现，也没有找到覆盖这个时序的测试。建议 W6 验证代理构造一个 `vfs.list` 挂起 2s 的用例，看删除后的刷新是否被吞。若复现不了，降 P2。
2. **F-20（批注 id 生成）我倾向 P3 但不敢说 confirmed。** 桌面端已有 `data-annotate-*` 的锚点机制（`RichDocumentWebView.tsx:42`、`web/shared/`），可能 core 侧或 web 侧还有一层 id 归一，我这一轮没进 `src/web/**` 追。若已有生成器，这条应删除而非修。
3. **F-21（菜单数组未 memo）我标 suspected 而不是 no-op。** 严格说 `BottomSheetMenu` 未 visible 时不渲染子树，items 变化无实际开销；但 `DirectoryRuleSheet` 的 `initial` 回写路径（`:1205`）确实可能在同一会话内造成一次视觉闪动，我没有实机证据。
4. **「components → screens」反向依赖（F-6）的定级。** 我给 P2 是按「架构环 + 真机 require-cycle 前科」这条 RULE 判的。但 Metro 目前没炸，且 W2 另有 `screens/**` 机位可能已经认领这条；若那边也报了同一处，主代理应合并为一条而不是两条。
5. **双端重复实现的「应抽 core」判断带有我的偏好。** F-2/3/4/7/23/24/25 我都建议抽 core，但 core 的 `exports` 有 25 个子路径、且 mobile 端必须走 `dist/` 产物（RULE「改 dist 消费的包必须重建 dist」）——新增 exports 子路径还要同步 `packages/core/tsconfig.test.json` 的 paths（否则测试静默吃旧 dist）。所以「抽 core」在本仓有实打实的成本，不是零成本收敛。主代理若要排优先级，建议先做 F-11 / F-25 这种**同一语义两份实现**的（不改位置也能先统一行为），再做纯搬运。
6. **未覆盖的子域。** `components/charts/StackedBars.tsx` 我通读了但没找到问题（与 desktop 的图表实现差异是渲染技术路线不同，非重复逻辑）；`components/profile/*` 三个文件只是 `card-styles` 的消费者，没独立发现；`components/update/*` 两个文件逻辑简单且有对应 services 承接。若后续 W3 横切「死路径狩猎」机位覆盖到这些，不必重复扫。
7. **组件总量口径。** 本区 102 个 `.ts/.tsx` 文件共 16227 行（实测 `node tmp/w2-ls.mjs`，已剔除 `/chat/`）。这个数字含 24 个「只被同文件或测试引用」的导出（P2/P3 发现里已逐条点名），若主代理要按「有效模块数」口径统计需扣减。

```
 * VFS 批量移动用的纯路径工具（从 desktop vfs-tree-dnd 拷贝，暂不抽 core）。
```
文件头自陈是从 desktop 复制的。实测 `isSelfOrAncestorPath` / `resolveMoveDestination` 与 `apps/desktop/renderer/features/workspace/vfs-tree-dnd.ts:36-68` **逐字相同**（仅引号风格差异）。注释同时承认「暂不抽 core」——这是**有意识的暂态**，但已跨了多个迭代未收口，且两侧各有独立测试（`__tests__/vfs-move-path.test.ts` 与 `apps/desktop/test/vfs-tree-dnd-move.test.ts`），断言重复维护。**建议**：抽到 core `domain/vfs/logic/`（`packages/core` 已有 `normalize-for-match.ts` 等同类纯函数先例），双端各留一行 re-export。**置信 confirmed**


