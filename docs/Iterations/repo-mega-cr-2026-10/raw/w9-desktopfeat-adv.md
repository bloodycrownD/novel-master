---
zone: w9-desktopfeat-adv
agent: 辩护人（advocate）— 设计合理性论证
files_scanned:
  - apps/desktop/renderer/features/chat/ (38 文件, ~4.0k 行)
  - apps/desktop/renderer/features/settings/ (24 文件, ~8.4k 行)
  - apps/desktop/renderer/features/skills/ (4 文件, ~700 行)
  - apps/desktop/renderer/features/workspace/ (12 文件, ~2.2k 行)
  - 关联取证（非本区，引用为证据）：apps/desktop/renderer/layout/{SettingsOverlay,ExplorerPane}.tsx、
    apps/desktop/renderer/providers/ShellNavProvider.tsx、apps/desktop/src/main/services/vfs-batch.service.ts、
    apps/desktop/test/**、docs/Iterations/{agent-skills,agent-tabs-and-subagent-stream,workspace-chat-vfs-upgrade}/
---

## 摘要

`apps/desktop/renderer/features/` 是 desktop renderer 的**业务功能层**：chat（会话流 / composer / 消息块 / 指标）、
settings（16 个设置视图 + 导航栈 + 通用设置控件）、skills（技能 CRUD 弹层）、workspace（VFS 文件树 + 批量拖拽
编排 + 目录规则）四个业务域。它夹在 `layout/`（三栏壳与装配点）与 `@shared/logic` + `@/ipc/client`（契约层）之间，
**不反向依赖 layout**，业务规则以无 React 的纯 `.ts` 形态与视图同目录并置。

## 职责与边界

- **拥有**：业务交互状态机（发送门闩、流式 buffer、批处理反馈、设置导航栈 + dirty 守卫、拖拽 staging 生命周期）、
  视图内的表单与列表、错误到中文文案的映射（`formatVfsErrorForUser` 的调用侧形态）。
- **不拥有**：IPC 通道契约（`@shared/ipc-types`）、跨端同源的业务口径（`@shared/logic/*`）、应用级路由与布局
  （`layout/`、providers）、main 侧物化与 `startDrag`。
- **边界纪律的硬证据**（见 F-w9-desktopfeat-adv-1）：全 77 个文件、零条 `features → layout` 的 import。

## 对外接口

被区外消费的关键符号（消费方均在 `layout/` / `providers/` / `hooks/`）：

| 符号 | 出处 | 消费方 |
|---|---|---|
| `ConversationPanel` | `features/chat/ConversationPanel.tsx` | `layout/ChatRail.tsx:9` |
| `WorkspaceTree` / `WorkspaceContextTarget` | `features/workspace/WorkspaceTree.tsx` | `layout/ExplorerPane.tsx:4-8`、`layout/MainShell.tsx:2` |
| `workspace-batch-dnd` 全套（`handleTreeDrop` / `moveVfsPathsToDir` / `confirmAndApplyBatchIngest` / `ensureStartDragFailureToast`） | `features/workspace/workspace-batch-dnd.ts` | `layout/ExplorerPane.tsx:13-19` |
| `preview-tab-sync`（`syncPreviewTabsWithFileRows` / `markPreviewTabsDeletedUnderPathInList`） | `features/workspace/preview-tab-sync.ts` | `providers/ShellNavProvider.tsx:66` |
| `settings-nav`（`SettingsViewId` / `shouldGuardSettingsNav` / `SETTINGS_NAV`） | `features/settings/settings-nav.ts` | `layout/SettingsOverlay.tsx:3-12` |
| `chat-annotate-draft` | `features/chat/chat-annotate-draft.ts` | `layout/PreviewPane.tsx:32`、`layout/PreviewAnnotateUi.tsx:12` |
| `chat-link-route` / `useWorkspaceFooterReload` | `features/chat/*` | `providers/ShellNavProvider.tsx:59,67` |
| `conversation-batch` | `features/chat/conversation-batch.ts` | `hooks/useAgentStream.ts:45` |
| `skill-ui`（`dispatchOpenSettingsView` / `OPEN_SETTINGS_VIEW_EVENT` / `toSkillRef`） | `features/skills/skill-ui.ts` | `layout/SettingsOverlay.tsx:33-37`、`features/chat/{ToolCallCard,SkillTypeahead,SessionSkillPanel}.tsx` |
| `workspaceMenuItems` / `zipImportConfirmMessage` / `entryLabelForTarget` | `features/workspace/workspace-context.ts` / `workspace-actions.ts` | `App.tsx` |

区内的跨域边只有 6 条，且全部是「共享能力」而非「共享状态」：`chat → skills`（4 条：SkillPicker、NewSkillModal、
skill-ui 标签、dispatch 事件）、`settings → skills`（2 条）。不存在 `chat → workspace` 或反向边。

## 数据访问

本区是 renderer，**不直连任何表 / KKV 域 / 文件路径**。全部经 `@/ipc/client` 的 typed 通道：

- VFS 读写：`ipcVfsWrite` / `ipcVfsMkdir` / `ipcVfsRename` / `ipcVfsDelete` / `ipcWorkplaceBuildListRows` /
  `ipcPhysicalList` / `ipcWorkplaceGetDirRule` / `ipcWorkplaceSetDirRule` / `ipcWorkplaceSetFileRule`
  （`features/workspace/workspace-actions.ts:10-19`、`features/workspace/WorkspaceTree.tsx:7-11`）。
- 批量 IO：`ipcVfsBatchExportStage` / `ipcVfsBatchIngestFromPaths` / `ipcVfsBatchClearStaging`
  （`workspace-batch-dnd.ts:12-19`）。main 侧落点是 `app.getPath("userData")/vfs-batch-export/<uuid>/`
  （`src/main/services/vfs-batch.service.ts:295-300`），带 5 分钟 TTL（`:241-255`）。
- 拖出系统：`getDesktopBridge().startDrag(filePaths)`（`workspace-batch-dnd.ts:231`）。
- 聊天：`ipcMessagesList` / `ipcAgentAbort` / `ipcSessionsGetComposerDraft` / `ipcSessionsSetComposerDraft` /
  `ipcPromptChatTokenLabel` / `onPromptChatTokenUpdated`。
- 设置：`ipcCloudSync*`（22 个通道）、`ipcProvider*`、`ipcSmartSortRule*`、`ipcAgentRegistry*`、`ipcDbStats` /
  `ipcDbMaintenance`（`SettingsViews.tsx:21-64`）。
- 存储路径常量硬编码仅一处：`AgentStreamMetricsBar` 等不走 fs；desktop renderer 无 `fs` 调用（tokenizer 走
  main IPC）。

## 依赖关系

- **向下（单向）**：`features → layout` 零条；`features → providers/hooks/components/ipc/@shared` 正常。
- **横向**：仅 `chat ↔ skills`、`settings → skills`，共 6 条。
- **向上**：`layout/{ChatRail,ExplorerPane,MainShell,PreviewPane,PreviewAnnotateUi,SettingsOverlay,preview-utils}`、
  `providers/ShellNavProvider`、`hooks/{useAgentStream,useChatMessagesScrollFollow}`、`App.tsx` 消费本区。
- **无环**：本区内部无自我 import；唯一自引用是 `features/settings/SettingsViews.tsx:2,5` 对同目录两个视图的
  re-export（`AgentEditorView` / `ModelSamplingView`）——是 barrel 式再导出，不成环。

---

# 一、辩护理由清单

## D-1 features 分域不是"随手分文件夹"，而是一条可验证的依赖纪律

**论点**：`layout/` 保持纯装配（三栏壳 + 设置栈渲染器），所有业务状态机沉到 `features/`。这条边界在代码里
**零违例**，不是靠约定维持的。

**证据**：`Select-String 'from "@/(layout|...)"'` 扫全 77 个文件，唯一向上的引用是 `@/providers/ShellNavProvider`
（3 处）、`@/hooks/*`（3 处）、`@/features/skills/*`（6 条横向），**没有一条指向 `layout/`**。这意味着：

- `layout/ExplorerPane.tsx` 只做「把 `onOpenContextMenu` / `onMutated` 回调注进来 + 渲染 `<WorkspaceTree>`」，
  拖拽的全部编排在 `features/workspace/workspace-batch-dnd.ts`（`:344-382`）；
- `layout/SettingsOverlay.tsx` 只做 `switch (viewId)` + nav 栈，dirty 判定是 features 里的纯函数
  `shouldGuardSettingsNav`（`settings-nav.ts:158-175`），Overlay 只负责调度（`SettingsOverlay.tsx:135-156`）。

**反驳预判**：有人会问「为什么 workspace 的 drop 处理同时出现在 `ExplorerPane.tsx:78-107` 和
`WorkspaceTree.tsx:167-195`」。辩护：空白区 drop（`targetDir="/"`，`closest(".tree-node")` 早退）与行 drop 是两个
**DOM 落点**，二者调用的编排层是同一批纯函数（`handleTreeDrop` / `moveVfsPathsToDir`），重复的只有 8 行
scope 取值 + 早退判断，不是逻辑复制。

**置信：confirmed**

## D-2 目录内形态约定自洽：`.ts` = 无 React 的纯逻辑，`.tsx` = 视图

**论点**：这个约定不是命名偏好，它直接决定了本区的可测性。

**证据**：32 个纯 `.ts`（约 3.2k 行）vs 45 个 `.tsx`（约 11.1k 行）。纯 `.ts` 里最长的三个恰好都是本区最难的逻辑：

- `workspace-batch-dnd.ts`（389 行）——拖拽 staging 生命周期，无 JSX；
- `message-blocks.ts`（331 行）——消息块类型判定；
- `workspace-actions.ts`（234 行）——VFS 动作 + 错误文案。

`apps/desktop/test/` 下 **50+ 处 import 直接指向 `features/` 的纯逻辑模块**（`settings-nav-guard` /
`vfs-tree-utils` / `workspace-actions` / `message-blocks` / `prompt-macro-input` / `readOnlyRunProbeLogic` /
`migration-row-value` / `preview-tab-sync` / `composer-send-state` / `conversation-abort-retain` …）。

**推论**：一条业务规则要单测，**必须**先被提出成不依赖 React 树的函数——是约定把设计推向可测的。
反例对照：`docs/Iterations/agent-config-extra-info-and-workplace-cleanup/cr-fix-spec.md:33` 记录了
`AgentEditorView` 与 `AgentDefinitionEditorForm` 两套表单各自演进、customAttach 只接到一套的教训——那正是
「视图内联逻辑」的代价；本区的做法（`prompt-macro-input.ts` / `migration-row-value.ts` / `readOnlyRunProbeLogic.ts`
都是「测试直接 import 喂夹具，不拖 React 组件树」）是对那个教训的修正。

**置信：confirmed**

## D-3 "SettingsViews 装配"是一个需要纠正的前提：装配点不在 SettingsViews

**论点**：把 `SettingsViews.tsx`（2507 行）当作「设置页装配点」是误读。真正的装配是
`layout/SettingsOverlay.tsx` 的 `renderContent()` switch（`:196-234`），它才是 viewId → 组件的唯一映射。

**证据**：
- `SettingsOverlay.tsx:14-32` 从 9 个不同文件 import 视图（`SettingsViews` 提供 6 个，其余 6 个各自成文件）；
- `SettingsViews.tsx:2,5` 本身只是 `export { AgentEditorView } from "./AgentEditorView"` 与
  `export { ModelSamplingView } from "./ModelSamplingView"` 两个再导出——**它是聚合桶，不是路由表**；
- 导航元数据（16 个 `SettingsViewId`、侧导航树、顶层级白名单、高亮回退）在独立的 `settings-nav.ts`（175 行纯 ts），
  与视图实现零耦合，可独立单测（`settings-nav-guard.test.ts`）。

**辩护要点**：`SettingsViewId` 这个 union（`settings-nav.ts:3-19`）是**编译期封闭的**——新增一个视图必须同时
改 union、`SETTINGS_NAV`/`SETTINGS_TOP_LEVEL`、`getSettingsNavHighlightId`、`isSettingsTopLevelView`、Overlay 的
switch，五处漏一处 `tsc` 就红（`docs/apm/RULE.md:101` 记录了「测试文件类型错误会打红生产类型检查门限」，
说明这条类型门限在本仓是活的）。这比运行时路由表更难漏。

**置信：confirmed**

## D-4 设置页的视图生命周期是"按 viewId 卸载"，不是常驻常轮询

**论点**：`SettingsOverlay.tsx:312` 的 `<div key={viewId}>` 强制 viewId 变化即同步卸载。

**辩护要点**：这直接消灭了一类常见性能问题。`DataManagementView` 有 2 秒轮询（`SettingsViews.tsx:221-229`，
轮询 `ipcCloudSyncGetLocalStatus` + `ipcDbStats`）。因为视图按需卸载，**用户不在「备份与恢复」页时这两个 IPC
一次都不会发**；常驻实现会让打开设置页就持续打这两条通道。`settings-nav.ts:151-153` 的注释把这条当成守卫设计
的一部分显式记录（「`<div key={viewId}>` 使 viewId 变化即同步卸载，卸载后才弹确认为时已晚，故拦截必须在导航分发
之前」）——卸载是**被依赖的语义**，不是副作用。

**置信：confirmed**

## D-5 dirty 上报通道用稳定引用而非 state，是踩过换对象陷阱后的显式设计

**论点**：`SettingsNavHandle.dirtyViews` 挂在 `useRef` 持有的 `Set` 上而非 `navState`（`settings-nav.ts:88-99`
+ `SettingsOverlay.tsx:74-78`），注释直接写明了原因。

**原文**（`settings-nav.ts:90-98`）：
> 有意挂在 handle 而非 navState 上：navState 会被 handleClose 整体重建（`navStateRef.current = {}`），
> 而本集合由 Overlay 的 useRef 持有、引用永不重建——dirty 写侧（`nav.dirtyViews`）与守卫读侧始终是同一 Set。

**辩护要点**：这不是"看起来更 React"的写法，是**因为同一份数据既有写侧又有读侧、且中途会被整体替换**，
放进 state 一定会出现「写侧拿到旧对象、读侧拿到新对象」的静默分叉。同理 `shouldGuardSettingsNav` 被抽成纯
函数（`:158-175`）而不是内联在 Overlay 里，是因为它有 4 个分发点（侧导航 / 返回 / 关闭 / 跨组件事件），
每处内联都会各自漂移。`:153-156` 还专门处理了「不卸载但 ref 被覆写」这个第四种失效形态（skillDetail 重入）。

**置信：confirmed**

## D-6 workspace 批量拖拽的三层设计各自有不可替代的理由

**论点**：这是本区最复杂的模块（389 行 + 98 行纯逻辑），辩护其每一层都不是过度设计。

### D-6.1 为什么"prefetch 在 pointerdown、startDrag 在 dragstart 同步"

`workspace-batch-dnd.ts:1-7` 的文件头写明：
> 拖出：pointerdown 预 stage → dragstart 同步 startDrag（避免 await 打断拖动手势）。

**辩护要点**：这是浏览器手势模型的硬约束。`dragstart` 处理器里 `await` 一次 IPC，用户在 await 期间松手，
拖拽就被浏览器取消了。这不是可以优化掉的，是 API 形状决定的。`prefetchExportStage` 在 `pointerdown`
（`WorkspaceTree.tsx:265`）触发，把物化成本挪到「用户按下」到「用户开始拖」这段**必然存在**的时间窗里。

### D-6.2 为什么 prefetch 有 generation 令牌 + 失败集合

`:44-45, 170-183`：`prefetchGeneration` 递增作废在途结果；`failedStagePaths` 让 dragstart 在 prefetch 已失败时
**不静默**（注释：避免与 prefetch toast 重复）。这是标准的 in-flight 作废模式，处理「快速划过两行」
「松手后又立刻拖第二行」这类竞态——**没有它会拿 A 行的 staging 去拖 B 行**。

### D-6.3 为什么双层清理（renderer 显式 + main TTL）

辩护人主动检查并**排除**一个看似成立的指控：`handleTreeDrop` 在回落分支只调
`clearActiveNativeDrag()`（`workspace-batch-dnd.ts:371`，仅置 null、不清 main 临时目录），
"drop 到窗口外 / 拖到别的应用"时 renderer 侧确实没有任何清理调用——但这**不构成泄漏**：
main 侧 `scheduleStagingTtl` 对每个 stagingRoot 挂了 `STAGING_TTL_MS = 5 * 60 * 1000`
（`vfs-batch.service.ts:241-255`），到期 `rm -rf`。所以真实形态是**显式清理是快路径、TTL 是兜底慢路径**，
纵深防御。副作用是：一次点开目录的物化最多占用 userData 临时目录 5 分钟（见 C-5）。

**置信：confirmed**

### D-6.4 为什么"统一 drop 入口"要同时吃两类 DataTransfer

`:344-382` `handleTreeDrop` 的分支是穷举的：`activeNativeDrag != null` 且所有 hostPaths 都在 stagingRoot 下
→ 判为"自己拖自己回来" → 走 move；否则清 active 态，hostPaths 非空 → ingest。这解决了 HTML5 DnD 里
**最棘手的一类歧义**：Electron `startDrag` 失败回落时，drop 事件里带的是**物化后的本机路径**而非 MIME，
不判 stagingRoot 前缀就会把它当"外部文件"重新导入自己刚导出的内容。`isPathUnderRoot`（`:148-156`）同时
处理 `\` 与 `/` 分隔符，是 Windows 下的必要防御。

### D-6.5 为什么移动是串行的

`:315-334` `for...of` + `await`，逐个 `ipcVfsRename`，失败逐条 toast、成功的累加、末尾统一 `onMoved()`。
辩护：这是**部分成功可见**的选择。若改并发 + 批量接口，则要么牺牲"哪几条失败了"的可见性，要么引入回滚——
而 RULE 记录了 VFS 的并发口径是 last-write-wins 无锁（`docs/apm/RULE.md:83`），回滚没有底层支撑。
逐条 toast 是当前语义下唯一诚实的呈现。代价是 N 次往返（见 C-8）。

**置信：confirmed**

## D-7 physical 面板的只读约束是"渲染期 + 事件期"双闸，不是一处 if

`WorkspaceTree.tsx` 在 6 个点守住只读：`draggable={!isPhysical}`（`:263`）、pointerdown 早退（`:199-201`）、
dragstart 早退（`:211-213`）、dragOver 早退（`:271-273`）、drop 早退（`:278-281`）、contextMenu 早退
（`:291-295`，注释「只读浏览：不弹任何写操作菜单」），外加数据源切换（`ipcPhysicalList` 而非
`ipcWorkplaceBuildListRows`，`:93-95`）与状态列留空（`:327`）。

**辩护要点**：`draggable={!isPhysical}` 单独就够挡住「拖出」，但挡不住「外部文件拖入触发 ingest」——
ingest 是 drop 侧发起的。所以 6 个闸不是冗余，是**攻击面枚举**。答辩要点是：这类只读约束的正确做法
就是在**每个事件入口**都有一行早退，而不是在数据层做权限判定（渲染进程没有权限概念）。

**置信：confirmed**

## D-8 零 `any`、零 `@ts-ignore`，5 处 eslint-disable 全部带书面理由

`Select-String 'any\b|as any|@ts-ignore|eslint-disable'` 扫全 77 文件：

```
useWorkspaceTree.ts:62      // eslint-disable-next-line react-hooks/exhaustive-deps
ConversationPanel.tsx:561   // ... -- 仅 mount / sessionId 切换时 probe
FileReferencePicker.tsx:86  // ... -- 打开瞬时拉一次列表
SkillDetailView.tsx:121     // ... -- 仅随 ref 变化重载
SkillDetailView.tsx:129     // ... -- 选中文件或技能变化时重载：
```

`any` 命中的唯一一处是 JSX 属性 `step="any"`（HTML 合法值），非类型逃逸。**没有一处无理由的 disable**——
这在本仓规模下不寻常，是有意的质量门。

**置信：confirmed**

## D-9 注释密度高不是噪声，是决策留痕，且大量注释直接是"为什么这么绕"

辩护抽样核对了注释的内容类型。`ConversationPanel.tsx:160-164`：
> 回调集合走 ref（callbacksRef）：本帧稍后定义完回调再写入 ref.current，useAgentStream 在事件到达时
> 现读——不依赖定义顺序，与 Mobile P1-2 对称。

`:220-225` 记录了 P0-2 拍板；`:233-235` 记录了「data 为 null = 读口本轮被抑制，不写 state」的裁决。
`settings-nav.ts:147-157`（守卫四形态）、`:90-98`（引用陷阱）、`SettingsOverlay.tsx:126-134`（为何 nav.push/pop
不过守卫：view 内部自带确认，双重拦截会连弹两次）、`:160-164`（hidden 态可见性契约）同理。

**辩护要点**：这类注释是**对抗式评审的直接输入**——它把"这里为什么看起来绕"从"看不懂"变成"有据可查的既定裁决"。
`docs/apm/RULE.md` 大量条目（导入缓存对齐口径、实时 token 指标语义、mermaid 双管线）都是同一批作者在迭代里
沉淀的，代码注释是第一现场。**不把高注释密度列为问题**。

**置信：confirmed**

## D-10 失败一律可见，无静默降级

抽查本区所有错误分支：`workspace-batch-dnd.ts:187,199,237,252,262,298,317,330`、`workspace-actions.ts`
全部 `{ok:false, message}` 形态、`SettingsViews.tsx:181-190`（dbStats 失败**明确注释**「静默，不打扰用户」——
这是**有意识的、可解释的**静默，因为该值只影响一个只读统计数字的展示）。对比 `workspace-batch-dnd.ts:140-143`
的 `catch { // ignore }`：那里 ignore 的是 `getPathForFile` 对单个 File 的解析，函数继续遍历其余文件，
`:250-253` 会在一个都读不出时 toast。**静默点全部有边界条件**。

**置信：confirmed**

---

# 二、让步清单（辩护人认账的部分）

## C-1 `AgentDefinitionEditorForm.tsx` 1047 行全仓零引用 —— P2

全仓（排除 node_modules/dist）搜 `AgentDefinitionEditorForm`：**4 处命中全在该文件自身**（JSDoc + 类型 + 前向
ref 声明），无任何外部 import。历史上它挂在 `ProjectAgentConfigView` 上，而该组件在本仓**已不存在**
（全仓搜 `ProjectAgentConfigView` 零命中），项目级 Agent 配置入口被移除时它没被一起清掉。

**这不是我的设计意图，是遗留**。但我要给出诚实的定性：**文档已明确记为「不改」，属 intentional 的技术债**：

- `docs/Iterations/agent-skills/spec.md:80`：「desktop `AgentDefinitionEditorForm.tsx` 现无引用（疑似遗留），
  **不改**，若后续接线需同步占位卡片（备注于代码）」
- `docs/Iterations/agent-skills/spec.md:232`：「desktop `AgentDefinitionEditorForm` 疑似遗留未接线 | 不改；
  若后续接线需同步占位卡片（备注于代码）」
- `docs/Iterations/agent-tabs-and-subagent-stream/cr-fix-spec.md:81`：「`AgentDefinitionEditorForm.tsx` 预存死代码
  （1010 行，全仓无引用）**是否顺带清理**」——列为杂项、不阻塞

**辩护立场**：三份文档、三次迭代都看到了、都判了"暂不清"，说明这是**有意识的暂缓而非漏看**。
真正的债不是这 1047 行，而是「同一个智能体编辑器有两套独立实现」这个结构（`AgentEditorView` 1381 行自建
28 个 `useState` 的表单，而 `AgentDefinitionEditorForm` 是 forwardRef + imperative `buildDefinition/isDirty/markSaved`
的受控版本）。清理动作应该是"**决定项目级 Agent 配置要不要回来**"，不是"删文件"。
**建议**：进 backlog 归入"编辑器收敛"专题，与 `cr-md-1/2/3/4/5` 里记录的 customAttach 双表单教训合并处理。

**置信：confirmed（死代码本身）／intentional（暂缓决定本身）**

## C-2 `useWorkspaceTree.ts` 66 行全仓零引用 —— P2

三个导出 `usePreviewSelection` / `useTreeRefreshToken` / `useTreeLoader` 全仓无外部 import，且**测试也不引用**。
现状由 `ShellNavProvider.tsx` 就地承担，而且**已经是更完整的形态**：`previewFile` 升级为
`previewTabs` + `activePreviewKey`（`:272-273`）、`selectPreviewFile` 与 4 个 tab 操作并存
（`:351`/`:425`/`:454`/`:487`/`:497`）、`clearPreviewFile`（`:531`）、`previewFile` 由 `useMemo` 从 tabs 派生（`:536`）。

**成因**：单预览 → 多标签预览的架构迁移留下的前体文件。`useTreeLoader` 里那个
`// eslint-disable-next-line react-hooks/exhaustive-deps` + 裸 `deps: unknown[]` 参数（`:37-63`）本身就是
早期形态的指纹——**它甚至没被本区的 D-8「每处 disable 都有理由」纪律覆盖**（这条 disable 没有理由注释），
反证了它是更早期、未经统一纪律的遗留。

**建议**：直接删（66 行，零风险），或若还想留 `useTreeLoader` 的 `cancelled` 竞态防护范式，摘出来进
组件库。无论如何不该继续留在 `features/` 里假装是活代码。

**置信：confirmed**

## C-3 `workspace-batch-dnd.ts` 389 行、零测试 —— P2

同区的 `vfs-tree-dnd.ts`（98 行）有 `vfs-tree-dnd-move.test.ts` 覆盖，`workspace-actions.ts`（234 行）有
`workspace-actions.test.ts`，`workspace-context.ts`（82 行）有两个测试。**唯独最复杂的
`workspace-batch-dnd.ts` 一个测试都没有**——`vfs-batch-staging.test.ts` 只测 main 侧
（`import { handleVfsBatchClearStaging } from "../src/main/ipc/handlers/vfs.js"`），不碰 renderer 编排。

我要承认这**削弱了我在 D-2 里的辩护**：本区最好的可测性实践恰恰在最该测的地方缺席。被测过的部分
（`vfs-tree-dnd` 纯函数、`workspace-context` 菜单项）恰好是简单的部分；generation 令牌作废、
staging 回落判定、`isPathUnderRoot` 跨分隔符这些真正会出错的判断没有用例。

**建议**：优先补 `prefetchGeneration` 作废路径 + `handleTreeDrop` 的三分支（自拖回落 / 外部 ingest / 无关 drop）
的纯逻辑用例。这两个是本区**唯一有状态**的编排，用 `npx tsx --test` 直接 import 即可，不需要 React 树。

**置信：confirmed**

## C-4 "批量拖拽"的多路径能力全线未接线 —— P2

模块叫 `workspace-batch-dnd`，但**多路径从头到尾没有接线**：

- `VfsDragPayload.paths` 是数组（`vfs-tree-dnd.ts:8-9`），但唯一生产方
  `WorkspaceTree.tsx:215-218` 写死 `encodeVfsDragPayload([row.path])`；
- `prefetchExportStage` 写死 `logicalPaths: [options.logicalPath]`（`workspace-batch-dnd.ts:176`）；
- `StagedExport.logicalPaths` 是数组（`:33`），但恒为单元素；
- `ipcVfsBatchExportStage` 的 `logicalPaths` 是数组 —— main 侧 `stageVfsBatchExport` 真的支持多路径
  （`vfs-batch.service.ts:280-290`），**能力在底层是齐的，只差 UI 一层多选**；
- `moveVfsPathsToDir` 收 `sourcePaths: readonly string[]` 并逐条处理（`:311-334`），也支持多路径。

**辩护补充**：本区**没有多选 UI**——`WorkspaceTree` 每行一个 div，selection 状态完全不存在。所以「批量」当前
真实含义是「**拖入**批量」（`handleFilesDropIngest` 一次传 N 个 hostPaths，`:249-260`）与「**导入覆盖**批量确认」
（`needs_confirm` → `confirmAndApplyBatchIngest`，`:266-274` / `:283-306`），这两条是真的批量。
**「拖出」和「树内移动」是单路径的**。

**建议**：要么补多选（Ctrl/Shift 点选 → dragstart 写 N 条 → prefetch 批量 stage，底层已就绪，改动集中在
`WorkspaceTree.tsx` + `workspace-batch-dnd.ts:176` 一行），要么把命名从 `batch` 收敛为能反映实际语义的词，
免得下一个读代码的人（包括下一轮 CR 的对抗面）误以为多路径已通。**当前命名是过度承诺。**

**置信：confirmed**

## C-5 pointerdown 无按键/移动阈值判定 → 单击展开目录也会整棵子树物化 —— P2

`WorkspaceTree.tsx:265` 是无条件的 `onPointerDown={(e) => handleRowPointerDown(e, row)}`，而
`handleRowPointerDown`（`:197-207`）只判 `isPhysical` 就调 `prefetchExportStage`。

后果链条（有 main 侧代码佐证）：`prefetchExportStage` → `ipcVfsBatchExportStage([row.path])` →
`stageVfsBatchExport` → `planBatchExport` → `mkdir` + **逐文件 `writeFile` 全量落盘**
（`vfs-batch.service.ts:302-310`）。**对一个目录行，plan 会递归枚举整棵子树**。所以：

- 用户**左键点一下目录展开/折叠** → 整棵子树被读一遍并写进 userData 临时目录；
- 用户**右键点目录**（只是想看菜单）→ 同样全量物化。

物化后 `stagedByPath` 存着，`dragend` 不会触发（非拖拽），只能等 5 分钟 TTL 或下一次 pointerdown 时的
`releaseStagedExport`（`:170`）回收。**一次无意的目录点击 = 一次全子树磁盘写入 + 最多 5 分钟的临时目录占用。**

**辩护补充**：这是 D-6.1「prefetch 必须早于 dragstart」的**必然副作用**——把物化挪到 pointerdown 是为了在
dragstart 里同步 `startDrag`，代价就是"按下即物化"。**方案不是回退架构**，而是在 pointerdown 里补两个判据：
（a）`e.button === 0`（滤掉右键/中键）；（b）"按下后确实开始移动"——HTML5 没有 dragstart 前置钩子，
可行做法是设一个短延时（~150ms）才发 prefetch，或改用 `onDragEnter`/首次 `dragover` 触发。
判据 (a) 是零成本的，建议立刻做；判据 (b) 改动稍大但能根治"点击即物化"。

**置信：confirmed**

## C-6 `reload` 每次全量重置 `expandedDirs`，刷新即丢折叠态 —— P2

`WorkspaceTree.tsx:99-105`：
```tsx
setExpandedDirs(
  new Set(
    result.data.filter((row) => row.kind === "dir").map((row) => row.path),
  ),
);
```
`reload` 在 `refreshToken` 变化时触发（`:112-114`），`refreshToken` 由 `notifyWorkspaceMutated` 递增
（`ShellNavProvider.tsx:291`）。**任何一次文件写入（含 agent 写入、批量导入、拖拽移动）都会把用户手动折叠的
目录全部重新展开**。deep workspace 里这是可见的体验损失，且写入越频繁越明显。

**辩护补充**：这**不是"忘了做"**，代码里 `expandedDirs` 有完整的 `toggleDir`（`:134-144`）与
`treeExpandRequest` 展开（`:116-127`）逻辑，说明作者知道折叠状态是要维护的——重置发生在 `reload` 里，
与 `toggleDir` 并存，属于**两处独立写同一份状态**。修法很轻：重置前先 `setExpandedDirs((prev) => new Set(
[...prev, ...allDirs]))`（并集而非替换），或把"首次加载全展开"与"后续刷新保持"用 `useRef` 首跑标志分开。

**置信：confirmed**

## C-7 六处死导出 —— P3

全仓引用实测（`features/` + `apps/desktop/test/` + `src/`）：

| 符号 | 出处 | 状态 |
|---|---|---|
| `usePreviewSelection` / `useTreeRefreshToken` / `useTreeLoader` | `useWorkspaceTree.ts:7,30,37` | 整文件死（见 C-2） |
| `hasNmVfsMime` | `vfs-tree-dnd.ts:90-93` | 零引用；两个消费方（`WorkspaceTree.tsx:152-155`、`ExplorerPane.tsx:69-71`）都内联 `Array.from(types).includes(...)` |
| `hasFileDrag` | `vfs-tree-dnd.ts:95-98` | 同上 |
| `isDescendantPath` | `vfs-tree-utils.ts:59-70` | 零引用（`isDirectChild` / `parentLogicalPath` 有用，`isTreeRowVisible` 自建了向上走父链） |
| `isPrefetchInFlightForTest` | `workspace-batch-dnd.ts:85-87` | 注释写「@internal 测试辅助」，**但没有任何测试用它**——是一个为不存在的测试准备的测试辅助 |
| `getActiveNativeDrag` | `workspace-batch-dnd.ts:107-109` | 零外部引用（`activeNativeDrag` 内部直接读） |
| `clearActiveNativeDrag` | `workspace-batch-dnd.ts:111-113` | 仅模块内 `:371` 自用，导出无必要 |
| `formatBatchApplyToast` | `workspace-batch-dnd.ts:115-130` | 仅模块内自用 |

**辩护补充**：`hasNmVfsMime` / `hasFileDrag` 这一对尤其值得记——它们的存在恰恰**违反了本区自己的约定**：
"要复用的判断就提成纯函数"。而两个真实消费点各自内联了同一个 `Array.from(types).includes(...)` 判断
（`WorkspaceTree.tsx:152-160` 与 `ExplorerPane.tsx:68-73` 结构完全同构）。这是**提了函数但没接线**，
比没提更糟——它让读者以为有单源，实际没有。

**建议**：接上（`WorkspaceTree` 与 `ExplorerPane` 改调 `hasNmVfsMime(types)` / `hasFileDrag(types)`），
其余死导出删或降为 `private`。

**置信：confirmed**

## C-8 `moveVfsPathsToDir` 的 N 次串行 IPC 与部分失败无回滚 —— P3

`:315-334` 逐条 `await ipcVfsRename`。当前 UI 只产生 1 条（见 C-4），所以**今天没有实际性能问题**；
一旦 C-4 补了多选，一次移动 N 个条目 = N 次 IPC 往返 × N 个文件，可能超出用户耐心。
失败侧只有逐条 toast，**已成功的条目不回滚**——这与 VFS 的 last-write-wins 无锁口径一致（`RULE.md:83`），
但 UI 没有告知"部分成功"这个整体事实（用户看到 3 条报错，可能以为整批都没动，实际前 2 条已经改了）。

**建议**：多选接线时一并做：改批量 rename IPC（若 core 无批量接口，至少 `Promise.allSettled` 并发 +
结束汇总一条 toast「成功 N，失败 M」），并把 M 条具体原因折叠进一条。

**置信：confirmed（现状无影响）／suspected（多选接线后）**

## C-9 `SettingsViews.tsx` 2507 行 / 58 个 `useState` 的聚合文件 —— P3

**我要对 D-3 做一点限缩**：装配点确实在 Overlay，但 `SettingsViews.tsx` 本身是**六个互不相关的视图的物理并置**
（`DataManagementView` 152-679、`AgentsSettingsView` 682-1013、`ProvidersView` 1014-1215、`ProviderFormView`
1216-1387、`ProviderDetailView` 1388-1672、`SmartSortRulesView` 1679-2165、`SmartSortRuleEditorView` 2222-2507），
合计 58 个 `useState`。同区的 `AboutView`(197) / `TokenUsageStatsView`(1033) / `SkillsManageView`(402) /
`SkillDetailView`(407) 都是**一个视图一个文件**——**同一个目录里存在两套文件粒度标准**。

**辩护补充**：这不是"设计上就该大"，是**文件演进的沉淀**（git log 显示 `dataManagement` / `smartSort` 等视图是
在不同迭代里加进这个已存在的文件的）。它是 C-1（编辑器双实现）之外的同一类债：**粒度不均**。
修法是机械的（按视图拆文件 + 保留 barrel 再导出，Overlay 的 import 一行不用改），风险低收益中，
适合放进 backlog 一次性做掉。

**置信：confirmed**

## C-10 `failedStagePaths` 无淘汰 —— P3

`workspace-batch-dnd.ts:41` 的 `Set<string>`：写入于 `:186,198`，删除于 `:190`（成功时）与 `:221`
（dragstart 消费时）。**若某路径 prefetch 失败且用户再没拖它**（例如关闭了设置、切了会话），
该条目**永久驻留**。影响：内存上是无界的字符串集合（每个失败路径几十字节，实践中不会涨到有意义的大小），
以及**语义污染**——`:219-222` 的 `failedStagePaths.has(path)` 判定是"上次拖它失败过"，而注释
（`:40`）声明的意图是"prefetch 已失败的路径"。**跨会话复用同一批逻辑路径时，一次历史失败会污染后续判定**：
用户第一次拖 `/notes` 失败（磁盘满），5 分钟后修好磁盘再拖——prefetch 成功会 `:190` 删标记，所以这条还好；
但如果 prefetch 根本没被触发（比如 pointerdown 被 `isPhysical` 挡了、或 C-5 里说的场景），标记留着，
下次 dragstart 会走"无 staged 且在失败集"的分支（返回 false、不 toast），**拖出静默失效**。

**建议**：`finalizeRowDrag`（`:71-82`）已经集中做了该路径的清理，顺手 `failedStagePaths.delete(logicalPath)` 即可；
或在 prefetch 开头（`:170` 之后）无条件清一次。零成本。

**置信：suspected（无界增长确证；跨会话污染路径需实机复现）**

---

# 三、争议与存疑（不抹平）

1. **C-5 的取舍方向存在真正的争议。** 我论证了"prefetch 挪到 pointerdown 是浏览器 API 硬约束逼出来的"，
   但这只证明了**不能放在 `dragstart` 里 await**，没证明**必须放在 `pointerdown` 里**。备选方案是把
   prefetch 挂在 `dragstart` 的**同步段**——但那时 staging 还没好，`startDrag` 只能传空。
   真正的第三条路是 main 侧常驻一个"上次物化结果"缓存，让 `startDrag` 同步命中；那要改 main，超出本区。
   **我没有足够信息判断这条路线是否已被评估过**，标 `suspected` 交主代理裁决。

2. **C-2 的处置方向有争议。** 我倾向直接删 `useWorkspaceTree.ts`，但 `useTreeLoader` 里的
   `let cancelled = false` 竞态防护（`:45,50,55,59-61`）是本区**唯一**一个通用的异步取消范式——
   而本区其他异步 effect（`ConversationPanel.tsx:319-343`）是各自手写 `cancelled`。也就是说
   `useWorkspaceLoader` 既是死代码**又是**唯一被抽象出来的那份。删掉它会让"renderer 异步竞态防护"继续散落。
   **"删"与"接上"两种处置都说得通**，我不独断。

3. **C-1 的"暂缓"是否已经过期。** 三份文档都说"不改"，最近一份是
   `agent-tabs-and-subagent-stream/cr-fix-spec.md`。我**没有读** memory 里是否有更晚的拍板
   （独立纪律禁止读 raw/，但 RULE 我读了全文，未见项目级 Agent 配置回归的条目）。
   **"项目级 Agent 配置是否会回来"这个问题只有用户能回答**，我不替主代理断言。

4. **C-9 的六视图并置是否算"聚合文件"存在口径分歧。** 若以 Overlay 的 switch 为装配点，则
   `SettingsViews.tsx` 导出 6 个视图是**合法的 barrel**（就像它现在 re-export 的 2 个）；
   只有"同目录其他视图都是一文件一视图"才让它显得不均。**两种读法都成立**，我按对我不利的读法记了 P3。

5. **D-3 我主动对 D-2 的表述做了一处限缩。** 「测试可直接 import 是本区最难的三个模块都是纯 `.ts` 的结果」——
   严格说这是**相关性**不是**因果**（没有反事实对照）。C-3 恰好给出了反例：同一个约定下最该测的模块没测。
   本区是否真的"约定驱动了可测性"，需要看这些纯 `.ts` 的拆分 commit 与对应测试的 commit 是否同期。
   **我没有做这层验证**，标 `suspected`。

## 独立性声明

本报告未读取 `docs/Iterations/repo-mega-cr-2026-10/raw/` 与 `synth/` 下任何文件内容
（仅列过一次目录文件名以避免报告文件名冲突，未读取内容）。全部结论来自源码实读 + 全仓符号引用实测 +
`docs/apm/RULE.md` + `docs/Iterations/` 下与本区直接相关的迭代文档。未做任何 git 写操作。
