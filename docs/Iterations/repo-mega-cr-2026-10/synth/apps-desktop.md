---
zone: synth-apps-desktop
agent: W5-reduce
inputs: raw/w1-desktop-main.md、raw/w2-desktop-features.md、raw/w2-desktop-core.md、raw/w3-xc-ipc.md
base_sha: feat/repo-mega-cr @ main(9ca5f5ad)
findings: P0×0 P1×4 P2×19 P3×8（合并 31 条）
---

# synth · apps-desktop（main / preload / renderer / shared 四层归并）

## 摘要

Electron 桌面端全量归并：main 装配与 148 条 invoke 注册、preload 桥、renderer 骨架层（87 文件）、
`features/**` 四个功能域（77 文件）、`shared/` 类型与薄再导出层。四份 raw 合计 79 条原始发现，
去重归一为 **31 条**（P0 0 / P1 4 / P2 19 / P3 8）。最大的一次去重是 **IPC 断链**：
W1 报「通道级缺口 3 条」、W2 报「封装级零消费 10 条 + 缺封装 1 条」、W3 出五层机器比对 12 条断链
——三者不是矛盾而是同一张表的三种切面，终裁取 W3，另两方降为佐证（详见 S-D-05）。
X1 门禁与 CI 处置合并为单条整改项（S-D-06），1048 行孤儿表单归入删除 backlog 引用（S-D-24）。

## 职责与边界

- **main 拥有**：窗口/菜单生命周期、better-sqlite3 单例连接、148 条 `ipcMain.handle` 注册、
  6 条 push 通道转发、2 个后台搬运任务、云同步与备份整库搬运。本区**不写业务 SQL**
  （唯一例外 `connection.ts:58` 的 `PRAGMA wal_checkpoint`），表访问全经 core service 端口。
- **preload 拥有**：唯一跨进程桥契约（`invoke`/`on`/`off`/`getPathForFile`/`startDrag`）。
  头注释明文规定「renderer 不得 import core，域访问全走 invoke」——这条被违反 9 处（S-D-06）。
- **renderer 拥有**：应用骨架、导航状态机（`ShellNavProvider` 46 个 context 成员）、
  预览 tab 生命周期、7 个 push 通道的订阅、四个功能域的全部 UI。**零直接数据访问**。
- **shared 拥有**：`ipc-types.ts`（1,741 行、**实测 155 条通道**）与 `shared/logic/`（**实测 19 个文件**，
  全为 `export {} from "@novel-master/core/xxx"` 形态，无 `export *`）。
- **边界纪律（刻意）**：renderer 禁直连 core 是 X1 门禁（`eslint.config.mjs:71-88`）唯一目标；
  main 直连 core 合法。依赖环防护有三处刻意设计（`db-maintenance-busy.ts` 打断 service 环、
  `setRunFinishedTokenStatsRefresh` 注入口、cloud-sync 对 runtime 用动态 import）。

## 对外接口（合并后的四层出口）

| 层 | 出口 | 规模（实测/报告） | 纪律状态 |
|---|---|---|---|
| shared | `IPC_CHANNELS` + 全部 DTO | 155 条（invoke 148 / push 7） | 11 条断链（S-D-05） |
| shared | `shared/logic/*` 薄再导出 | **19 文件** | 无纪律约束（争议 D7）；29+2+1 条死再导出（S-D-24） |
| main | `registerHandlersFromRegistry` | 148 条 | 2 条破 `IpcResult` 契约（S-D-14） |
| preload | `NovelMasterDesktopBridge` | 5 成员 | `off()` 零消费、`inWindowMenuBar` 恒 false（S-D-25） |
| renderer | `createInvokeClient()` + `client.ts` | 146~148 个 `ipc*` | 10 条端到端零消费 → 终裁见 S-D-05 |

## 数据访问

- 渲染进程与 preload **零数据访问**；唯一文件系统接触面是 `getPathForFile` / `startDrag` 透传绝对路径。
- main 侧连接单例 `getDesktopConnection()` + `initPromise` 幂等；驱动注册（better-sqlite3 / 平台 SKSP /
  tokenizer-node）进程内 once。
- KKV 分域：`nm-desktop-ui`（主题 + updates.* 六键）、`nm-cloud-sync`（14 个非密钥键）、
  `nm-search` / `nm-preferences` / `nm-workspace-state`（core 侧 `createPersistent*`）。
- 文件级不经 VFS 的操作：备份整库 copy、YAML 导出临时文件（`yaml-shared.ts` 写的 tmp 文件从未被读，
  S-D-25）、ZIP 物化目录 `userData/vfs-batch-export/<uuid>`（5 分钟 TTL 兜底，intentional）。

## 依赖关系

- **对 core 的依赖面**集中在 `create-desktop-runtime.ts` 一个文件（agent/chat/provider/prompt/vfs/
  workplace/compaction/events/skills/session-kkv/kkv/sksp/smart-sort-rule/message-checkpoint/
  session-fs/feature-flags/config-forms + 根导出）。
- **renderer → core 的非法边 9 条**（本机位实测复跑 grep，与 W2/W3 报告逐条一致）：
  `App.tsx:2`(vfs)、`chat-link-route.ts:19`(chat)、`conversation-abort-retain.ts:4`(events)、
  `ConversationPanel.tsx:18`(events)、`useAgentRunLifecycle.ts:16`(events)、`useAgentStream.ts:43`(events)、
  `useAgentStreamMetrics.ts:30`(provider)、`ShellNavProvider.tsx:40`(events)、`ShellNavProvider.tsx:60`(chat)。
- **单向数据流**：`main handler → runtime service → core 端口 → sqlite`；回程只有两种形态：
  `IpcResult<T>`（147/148）与 push 通道（7 条）。renderer 侧的 `client.ts` 是**编译期契约面**，
  增删任一 `ipc*` 需同步四处（`ipc-types` / `handler-registry` / `invoke-registry` / `client`）。

## 归并方法与三口径统一

### ① IPC 断链：三口径归一（取 W3 终裁）

| 口径 | 报告 | 断链数 | 归一后 |
|---|---|---|---|
| 通道级（main 注册 vs renderer invoke） | W1 desktop-main | 3（`VFS_LIST` + `PROJECTS_*_AGENT_CONFIG`） | 全部落进 W3 表第 1/2/4 行 |
| 封装级（`invoke-registry` 导出 vs 消费） | W2 desktop-core | 10 零消费 + 1 缺封装 | 落进 W3 表 1/2/3/6/7/8/9/10/11/12 |
| 终裁（五层机器比对 + 逐条定性） | W3 xc-ipc | 12 | **11**（`VFS_START_DRAG` 改判 intentional 口径修正） |

统一后清单（处置见 S-D-05 表）：**真死删 8 条**（`PROJECTS_GET_AGENT_CONFIG`、
`PROJECTS_UPDATE_AGENT_CONFIG`、`SESSIONS_GET_AGENT_BINDING`、`VFS_LIST`、
`WORKPLACE_CAPTURE_SESSION_BLOCK`、`SMART_SORT_RULE_IMPORT_RULES`、
`SMART_SORT_RULE_EXPORT_RULES`、`SKILLS_EDIT`）、**口径修正 1 条**（`VFS_START_DRAG`，
send 型四段链路完整，L0 断链总数 12→11）、**待拍板 3 条**（`MESSAGES_HIDE_RANGE`、
`MESSAGES_SHOW_RANGE`、`MESSAGES_TRUNCATE_AFTER`）。L0 断链总数相应由 12 修正为 11。

### ② 严重度校准记录（本簇共 8 处改判，附理由）

| 原判 | 现判 | 理由 |
|---|---|---|
| F-core-1 X1 门禁 **P1** | **P2** | 违反契约 confirmed，但无用户可见错数据、无崩溃；修法近零成本，复发风险由 CI 收口承担 |
| F-core-6 StrictMode 幂等标志 **P2** | **P3** | 仅开发/QA 环境双调用，生产构建无 StrictMode 不受影响 |
| F-core-7 preview-annotate 520 行 **P2** | **P3** | 报告自标 `@deprecated SPEC R5` intentional，按协议不按缺陷计，仅记成本 |
| F-feat-7 设置页 2s 轮询 **P2** | **P3** | 稳态成本约 1 次 fs.stat + PRAGMA freelist，无正确性影响 |
| F-feat-9 树折叠态丢失 **P2** | **P3** | 可感知但可自愈、无数据面，低成本随 S-D-20 同批修 |
| F-main-9 死 IPC 消费面 **P2** | 并入 S-D-05 | 与 W3 第 1/2 行同一事实，重复计数 |
| F-feat-1 1048 行孤儿表单 **P1** | 删除 backlog | 行动项只有一个（删/迁），与 w3-xc-dead-apps A1/B-01 同一对象，引用不重复列 |
| F-core-2 10 条零消费 **P1** | 并入 S-D-05 | W3 逐条定性后 8 条真死、3 条待拍板，P1 整体定级不成立 |

### ③ 归并后本簇台账

**P0（0）**

无。P0 候选（S-D-01 云同步）已由 `synth/cloudsync.md` 以 w4-cloudsync-adv 的 P0（pull 后 rev 写入
已关连接必抛 `CONNECTION_CLOSED`，实测确认）承载，本簇不再重复记 P0。

---

**S-D-01 | P1 | `src/main/services/cloud-sync.service.ts:432-443` + `:446-449`**
**云同步单例在 rebootstrap 后不重建，configStore 持有已关闭连接上的 `kkv`/`secretStore`。**
`rebootstrapDesktopRuntime()` 会 `closeDesktopConnection()`，生产有两条 rebootstrap 路径
（`handlers/backup.ts:49`、`handlers/cloud-sync.ts:91`），而 `DesktopCloudSyncService` 的清位入口
`resetDesktopCloudSyncServiceForTest()` 全仓只有两个测试文件调。W1 判 P1，主代理 status 裁决 3
四点核验属实。**归属移交 `synth/cloudsync.md`**（与该簇 P0 同族），本簇仅登记不重复出账。
置信：confirmed。

**S-D-02 | P1 | `src/main/ipc/handlers/vfs.ts:423-432` + `src/main/services/vfs-batch.service.ts:260-272`**
**renderer 可传任意绝对路径触发主进程 `rm(recursive:true, force:true)`。**
`stagingRoot` 唯一生成方是主进程（`join(userData, "vfs-batch-export", uuid)`），但清理通道原样
信任入参，无 `resolve()` + `startsWith(base+sep)` 断言；同域 `handleAppOpenExternal` 有 `^https?://`
校验、这里没有。**破坏性操作上的防御缺失即定 P1**，不因「renderer 是本地 sandbox 产物」而降级。
建议：`clearVfsBatchExportStaging` 内加 base 归一断言，非法路径直接 return 并 `desktopLogWarn`。
置信：confirmed（代码无校验）/ 可利用性 suspected。

---

**S-D-03 | P1 | `apps/desktop/renderer/features/skills/skill-ui.ts:21-35`**
**桌面端 `buildNewSkillDoc` 裸拼 YAML front matter，描述含半角 `": "` 时技能一建出来就 invalid。**
mobile 孪生实现已修（`yamlScalar` = `JSON.stringify`），core 已把口径定死
（`with-skill-front-matter-values.ts:10-11`「值一律写双引号标量」）。失败链：
`NewSkillModal:199` 写盘 → `parseSkillFrontMatter` 抛错 → `valid:false`。附属同源重复：
`skillDomainLabel`（分支顺序相反）与 `isValidSkillNameInput` 双份（原 F-feat-23）。
**独立撞车**：w3-xc-dup-ends 也报了 `buildNewSkillDoc`，两方互不知情 → 置信升级 confirmed。
建议：`skill-ui` 整体上提 `@shared/logic/skills`，desktop/mobile 各留 re-export。
置信：confirmed（机制）/ suspected（真实触发概率，W6 建议实跑 `parseText` 坐实，见争议 D3）。

**S-D-04 | P1 | `renderer/App.tsx:344` + `features/settings/AgentEditorView.tsx:630`**
**设置导航「未保存守卫」两处漏网，智能体编辑内容被静默丢弃。**
(a) `AgentEditorView` 的 `dirty` 只挂标题角标，不写 `nav.dirtyViews`——全仓 `dirtyViews.add`
只有 `SkillDetailView.tsx:142` 一处，即设置里最大的一块编辑面不在守卫覆盖内；
(b) `AppChrome` 的 ⚙ 走 `setSettingsOpen(o => !o)`，**不经过 `SettingsOverlay.handleClose`**，
`guardedNav` 被整段跳过，且 Overlay 常驻挂载 → dirty 子页不卸载不重置，下次打开守卫也不再问。
两处属同一「守卫单点」设计的两个漏网口，合并为一条。
建议：`AgentEditorView` 补 `nav.dirtyViews.add("agentEditor")` effect；App 侧持有
`settingsCloseRequest` token，Overlay 内监听后调 `handleClose`（保持守卫单点在 Overlay 内）。
置信：confirmed。

---

**S-D-05 | P2 | `apps/desktop/shared/ipc-types.ts` + `handler-registry.ts:223-483` + `invoke-registry.ts` + `client.ts`**
**IPC 断链 11 条终裁（合并 W1 通道级 3 条 / W2 封装级 11 条 / W3 五层 12 条）。**

| # | 通道 | W1 | W2 | W3 定性 | 处置（单次批量执行） |
|---|---|---|---|---|---|
| 1 | `PROJECTS_GET_AGENT_CONFIG` | F-main-9 | F-core-2 | 真死删 | 删通道+handler+registry+封装+导出+`test/projects-agent-config-handlers.test.ts` |
| 2 | `PROJECTS_UPDATE_AGENT_CONFIG` | F-main-9 | F-core-2 | 真死删 | 同上（handler 侧 `@deprecated`「兼容外部脚本」理由不成立，见争议 D4） |
| 3 | `SESSIONS_GET_AGENT_BINDING` | — | F-core-2 | 真死删（写侧活着，读侧冗余） | 删读侧三层 + 测试三处断言，保留 set 侧 |
| 4 | `VFS_LIST` | F-main-3 | F-core-2 | 真死删（被 `ipcPhysicalList`/`ipcWorkplaceBuildListRows` 取代） | 删通道+`handleVfsList`+registry:263 |
| 5 | `WORKPLACE_CAPTURE_SESSION_BLOCK` | — | F-core-2 | 真死删（单测续命，it 名自写「遗留」） | 删三层 + `workplace-handlers.test.ts:189-231` |
| 6 | `SMART_SORT_RULE_IMPORT_RULES` | — | F-core-2 | 真死删（被 yamlImport 取代） | 删三层；core/CLI 一行不动 |
| 7 | `SMART_SORT_RULE_EXPORT_RULES` | — | F-core-2 | 真死删（被 yamlExport 取代） | 同上 |
| 8 | `SKILLS_EDIT` | — | F-core-2 | 真死删（desktop 走整文件 `ipcSkillsWrite`） | 删三层；core `editSkillFile` 保留（LLM 工具在用） |
| 9 | `VFS_START_DRAG` | 判为走 preload「设计」 | 判为未封装 | **口径修正：非断链** | 不改代码；L0 断链总数 12→11 |
| 10 | `MESSAGES_HIDE_RANGE` / `MESSAGES_SHOW_RANGE` | — | F-core-2 + 争议 1 | **待拍板**（UI 于 commit `722e27d5` 主动删除，-483/+32） | 见争议 D5；连带 `transcript-selectable-role.ts` 悬空批次纯函数与 `MessageBatchMode` |
| 11 | `MESSAGES_TRUNCATE_AFTER` | — | F-core-2 | 待拍板，且带 core 真 bug（S-D-07） | 同上 |

**校准**：整条从 W2 的 P1 降为 **P2**——11 条里 8 条是死码清理、3 条待产品拍板，均无用户可见错误。
「封装级死率」口径以 W3 为准（W2 报 6.8% 含误并，见争议 D6）。
置信：confirmed（逐条实测）/ 第 10/11 行处置 suspected。

**S-D-06 | P2 | `apps/desktop/eslint.config.mjs:71-88` + `.github/workflows/ci.yml:53-63`**
**X1 门禁失效 9 处 + CI 用 `continue-on-error` 放行 lint/typecheck。（W2 P1 → 本簇 P2）**
本机位复跑 grep 逐条复核，**9 条违规 / 8 个文件与 W2、W3 报告完全一致**（见上文「依赖关系」）。
修法已由 W3 给到符号级：改 8 个文件 12 行 import + `shared/logic/{events,chat,provider}.ts` 三个文件
各加一段纯转发（**W3 原表把 6 个 payload type 记成「type 8 中的 4」，实为 6 个**；合计 16 个符号），
零逻辑改动。
**CI 处置合并进本条**，分三档：
- A 档（立刻、零风险）：删 `ci.yml:62` Typecheck 的 `continue-on-error` 转 blocking。依据：W3 实测
  16 workspace typecheck 全绿（曾见 185 条 TS2307 是本 worktree 未 build core 的环境假象，CI build
  步骤在其之前）；**「既存类型错误」是假债务**。
- B 档（本次 CR 落地）：修 driver 包 tsconfig 覆盖（消 ~60 条 `was not found by the project service`
  解析错误）+ X1 9 处 + desktop 2 条 `no-regex-spaces` + core 3 条 → desktop/core/drivers 全绿。
- C 档（分步）：mobile 27 条（21 条 `exhaustive-deps` + `import/first` 规则未装 + `no-undef` shim）
  收口前保留 Lint 放行；另立一条：mobile `--max-warnings 321` 与实测 405 warnings 的差距意味着
  **该上限当前本身失效**，mobile lint 无论有无 error 都在失败，被 `continue-on-error` 全掩盖。
**降级理由**：无用户可见错数据、无崩溃，且 A 档修复近零成本；真正的复发风险由 A/B 档收口承担。
置信：confirmed（eslint 实跑 + grep 复核 + typecheck 实跑数字来自 W3）。

**S-D-07 | P2（潜伏） | `packages/core/src/service/chat/impl/message-transcript-effects.service.ts:63-77`**
**`truncateMessagesAfter` 漏失效 prompt-token 热层与 `usage_stats.toolUseCount`，同文件兄弟方法都做了。**
同文件 `setMessageFloorAtMessage:186` 有 `invalidateSessionApiPromptTokenEntry`，`message.service.ts:459/490`
有 `invalidatePromptTokens` + `invalidateToolUseCount`——「同语义三条路径都双失效」故为遗漏而非取舍。
**为何 P2 而非 P1（W3 终裁，本簇采纳）**：core 侧调用方全集只有自身 + desktop handler，而该 IPC
封装虽在、renderer 零消费 → 通道从未被点过；mobile 只用 `setMessageFloorAtMessage`，CLI 无调用。
**升级触发条件（写进台账，防漏）**：一旦 S-D-05 第 10/11 行走「补 UI」路线，本条立刻升 P1。
修法：事务提交后补两件失效（照抄同文件 `:186` + `message.service.ts:460` 的哨兵空串），
**不要放进事务内**。归属与 `synth/core-data.md` 交叉引用。
置信：confirmed（缺陷与不可达性均实测）。

**S-D-08 | P2 | `renderer/providers/ShellNavProvider.tsx:590`**
**`exitSubagentSession` 不清 `subagentSessionId`，父会话的「从/推项目工作区」入口永久消失。**
`WorkspaceHeaderActions.tsx:33` 用 `subagentSessionId != null` 当「处于子会话视图」判据，退出路径不清，
`openProject`/`openSession`/两个 `goBackTo*` 同样不清 → 污染跨切项目跨会话累积且无自愈入口。
建议：`exitSubagentSession` 内补 reset，换上下文处一并重置。置信：confirmed。

**S-D-09 | P2 | `renderer/layout/PreviewPane.tsx:172-191`**
**预览面板三缺陷叠加：重复取数、无请求序号守卫导致竞态串内容、错误路径静默。**
(a) 两个 effect 都调 `loadFile()` 且其身份随 `previewFile` 变 → 每次切文件/每次 `treeRefreshToken`
递增发两次 `ipcVfsRead`，结果互相覆盖；(b) 无 `cancelled`/request-id（对比同仓 `useAgentStream.ts:343`
已有正确范式），快速连点时先发后至的 A 会把内容写到 B 的 tab 上，**静默显示错文件**；
(c) `try` 只有 `finally` 无 `catch`，非 `NOT_FOUND` 错误既不 setContent 也不 setFileMissing，
**上一个文件内容继续显示**，并产生 unhandled rejection。
建议：合并 effect + requestIdRef 丢弃 stale + `catch` 兜底 `setFileMissing` + toast。置信：confirmed。

**S-D-10 | P2 | `renderer/App.tsx:189/307/323`、`App.tsx:229-283`、`PreviewPane.tsx:151/333`、`ChatRail.tsx:84`、`ThemeProvider.tsx:64`、`useAutoUpdateCheck.tsx:130/141/153`**
**全域「浮动 promise + 无 catch」系统性缺口，IPC reject 时用户零反馈。**
`ipcRenderer.invoke` 在 main handler 抛错时必 reject（不吞成 `IpcResult`），而 `AppChrome` 的
`void toggleMode()`、子智能体「停止」按钮 `void stopSubagentRun()`、主题切换全部走 `void`。
正确范式已在仓内：`useDesktopAgentActive.ts:87` 的 `.catch(() => undefined)`。
建议：统一 `runGuarded(fn, onError)` 包装并逐点套上。置信：confirmed。

**S-D-11 | P2 | `renderer/layout/ChatRail.tsx:160-177, 249-267`**
**批量删除完全忽略 `IpcResult.ok`，部分成功静默。**
删 5 个项目第 3 个失败 → 前 2 已真删（含连带删其下所有会话，确认文案明说）、后 2 未删，UI 不报错，
`exitProjectBatch()` 照常清空选中态，用户以为全删成功，**部分成功不可逆**。
`loadProjects`/`loadSessions` 在 `!ok` 时同样既不更新也不提示。
建议：循环内判 `ok` 收集失败 id，收尾一次性 `showToast(成功 N / 失败 M)`。置信：confirmed。

**S-D-12 | P2 | `renderer/hooks/useColumnSplitters.ts:342` + `:287-293`**
**`toggleColumn` 把 DOM 写副作用放进 setState updater；窄视口下点击无任何视觉变化。**
(a) `commitColumnWidths` → `applyWorkspaceLayout` 直接改 `element.style` / `gridTemplateColumns`，
并发渲染下 React 可能丢弃 updater 结果而副作用已发生；(b) `layoutVisibility` 在 `innerWidth<=900`
时强制 `preview=false` 而 `columnVisibility.preview` 仍为 true，点该按钮时关掉的是 explorer，
`AppChrome` 的 `is-active` 也读错值。建议：DOM 写移进 `useEffect([columnVisibility])`；
`toggleColumn` 读写 `layoutVisibility`，或窄视口置 disabled。置信：confirmed。

**S-D-13 | P2 | `ShellNavProvider.tsx:436`、`:464`、`SettingsOverlay.tsx:102`**
**三处 updater 内再调 setState 的 React 反模式。**
`SettingsOverlay.popView` 那处后果最实：退栈时 `setViewId` 在 `setPageStack` 的 updater 内执行，
StrictMode 双调用 / 并发下可能出现「`viewId` 翻了但 `pageStack` 没退」——退栈后标题与渲染的 view 对不上。
建议：合并两个 state 为一个对象，或 updater 外算好再一次性提交。置信：confirmed（反模式与位置）/
suspected（行为后果需实机复现）。

**S-D-14 | P2 | `src/main/ipc/handlers/agent.ts:374-390`**
**`handleAgentAbort` / `handleAgentRunIsActive` 缺 `try/catch`，破坏全仓 `IpcResult` 错误契约。**
脚本扫全部 handler：仅这两个（外加 `shell.ts` 两个纯同步无抛点）没有 catch。冷启动或
rebootstrap 期间 `abortAgentRun` / `getDesktopRuntime()` 会 reject，promise 直接逃出 `ipcMain.handle`
→ renderer 拿到的是 Electron 序列化的原始 Error 而非带 `code` 的 `IpcErrorPayload`，调用方
`res.ok` 判空退化为未定义。置信：confirmed。

**S-D-15 | P2 | `src/main/services/session-prompt-input.service.ts:139`**
**每次 prompt build 都跑一次整串渲染，产物生产零消费，且落在该文件头花 40 行论证的热路径上。**
`SessionPromptInputBundle.input` 的两个生产调用方都不解构它
（`chat-prompt-tokens.service.ts:213` 只取 definition/layout/ctx/rawMessages，
`prompt-preview.service.ts:65` 只取 layout/ctx），测试也不读。建议：删字段或改 lazy getter。置信：confirmed。

**S-D-16 | P2 | `blob-binary-normalization.service.ts:41-68` vs `message-content-compaction.service.ts:40-56`**
**两个后台搬运任务近乎逐行同构，守卫语义存在双份真源。**
重复项：同一份 `isConnectionClosedError`、两个 sleep 常量（5000/1000）、三守卫组合（仅顺序不同）、
`done/stalled` 收手口径、busy 令牌前后置对、几乎逐字相同的文件头注释。
将来改「什么算连接已关」或加第四个守卫要记得改两处。建议：抽
`services/desktop-maintenance-loop.ts`（守卫组合 + 连接已关判定 + stalled 收手 + sleep 常量）。
置信：confirmed（同构刻意，但真源分裂的代价成立）。

**S-D-17 | P2 | `src/main/services/db-backup.service.ts:99-174`**
**两个 import 函数约 40 行逐行重复**（仅末步 `copyFile` vs `writeFile` 不同）。两次改动要同步两处，
且这段正是「关活库 → 写入 → 回滚」的高危窗口。建议：抽 `replaceDbFileWithSnapshot(write)` 单一内核。置信：confirmed。

**S-D-18 | P2 | `MetricsDetailPopover.tsx:26-40`、`TokenUsageStatsView.tsx:51-64`、`shared/logic/hit-rate.ts:12`、`TokenUsageStatsView.tsx:93-98`**
**用量统计展示层双端/三端漂移四族（合并 W2 的 F-5/6/10/24）。**
(a) 单行计费口径 `lastRowBilledInput` 是 `BILLED_INPUT_SUM_SQL` 的**第三份副本**（core 权威 +
mobile + desktop），注释自认「公式单源随 tl 后续抽 core」＝已知待办不是 intentional；
(b) `toLocalDayKey` / 日偏移 desktop 与 mobile 逐字重复，而镜像层 `usage-stats-format.ts`
收了 `formatDurationMs`/`formatHitRate` 没收日期键 → 双份漂移直接表现为「点柱钻取不到当天」；
(c) `hitRate` 语义分叉：desktop `cacheRead==null → null（显示「—」）`，mobile 会算出 0%——**同一指标两端两个答案**；
(d) `formatTokensPerSecond` + `MODEL_OPTION_*` 哨兵双份，desktop 硬编码空态 `'—'`、mobile 由调用方传。
建议：一次收编进 `@shared/logic/usage-stats-format`（desktop 已是该形态），mobile 改 re-export，
并一并拍板 (c) 的 null 口径（建议统一「—」）。置信：confirmed。

**S-D-19 | P2 | `features/settings/prompt-macro-input.ts:25-138`**
**与 mobile 孪生文件逐字同构（仅引号风格差异），且只把常量提上去了、解析层没提。**
文件头自述「与 Mobile prompt-macro-input 对齐」，`ALLOWED_DYNAMIC_ROOT_MACROS` 已从
`@shared/logic/prompt` 取，解析/高亮/range 逻辑仍双份。建议：整份上提 `@shared/logic/prompt`，
desktop 独有的 `renderPromptMacroHighlightHtml` 留在 desktop。置信：confirmed。

**S-D-20 | P2 | `features/workspace/WorkspaceTree.tsx:197-207` + `:267-270`**
**`onPointerDown` 无条件物化整个文件到 userData 临时目录。**
单击选中、右键弹菜单、方向键浏览都会各触发一次 `ipcVfsBatchExportStage`（mkdir + 逐文件 copy）。
清理只在 `onDragEnd`，而 HTML5 `dragend` 在「按下+抬起无位移」时不触发 → 普通单击的 staging 只能等
main 侧 5 分钟 TTL 兜底；5 分钟内再拖同一行会用已删的 `filePaths` 调 `startDrag`。
（TTL 本身是**有意的兜底**，标 intentional 不当缺陷。）建议：prefetch 改挂到能区分「真要拖」的信号，
或在 `onClick`/`onContextMenu` 时 `releaseStagedExport(row.path)`。置信：confirmed。

**S-D-21 | P2 | `src/main/services/cloud-sync-config.store.ts` `setConfig`**
**保存配置无条件把云同步重新置为启用，`setEnabled(false)` 的语义被静默推翻。**
用户在设置页关掉同步后，只要再保存一次配置（哪怕只想改 Bucket），`enabled` 被写回 `"true"`。
建议：`setConfig` 不动 `enabled`（首次配置时若无 `enabledRaw` 才置 true），或在 UI 层明写此语义。置信：suspected。

**S-D-22 | P2 | `src/main/ipc/handlers/vfs.ts:161-183`**
**检测到用户编辑漂移后仅 `console.info`（info 级默认不落盘），仍照常覆盖写。**
`lastKnownContent` 与盘上 baseline 不一致说明用户在编辑器打开期间 agent 改过同一文件，
用户基于旧内容的编辑静默覆盖 agent 新写入。同域 `handleVfsBatchIngestFromPaths` 走的是
「冲突 → `needs_confirm` → 二次确认」，此处缺同等级处置。建议：返回 `CONTENT_DRIFT` 让 renderer
弹确认，或至少提到 `desktopLogWarn`。置信：suspected（代码没写「静默以用户为准」这层意图）。

**S-D-23 | P2 | `src/main/services/db-backup.service.ts:180, 211`**
**Agent 守卫在弹 dialog 之前取样，模态弹窗期间不持 busy。**
`isDesktopAgentActive()` 是瞬时取样，紧随其后的 `showSaveDialog` 可被用户无限挂起；busy 令牌直到
进入 `exportDatabaseBackupToPath` 才 acquire，窗口没盖住 → 用户在保存框里挑目录的三分钟内 agent 可起 run，
而 checkpoint + copyFile + scrub 都作用在同一条 better-sqlite3 连接上。
对比 `runDbMaintenance`（先判守卫 → 立刻置 busy → 再干活）纪律更严。建议：弹框前 acquire，
或弹框返回后复查一次 `isDesktopAgentActive()`。置信：suspected（窗口客观存在；是否真损坏未实测）。

---

**S-D-24 | P3 | 全簇零消费/死导出批次（引用删除 backlog）**
**本簇 40+ 条死代码统一并入 `synth/dead-backlog.md`，本条只做索引与引用，不重复出账。**

| 来源 | 对象 | 归入 backlog 的编号 |
|---|---|---|
| W2 features F-1 | **`AgentDefinitionEditorForm.tsx` 整文件 1048 行零 importer**（与 `AgentEditorView` 内联副本构成 2400 行双源） | `dead-apps A1` / `B-01`（w3-xc-dead-apps）——**本簇不单列发现** |
| W2 core F-12 | `AppMenuBar`（41 行组件，0 引用；`preload.inWindowMenuBar:false` 是其残骸证据）、`useStreamTailGenerating`（11 行恒等包装）、`estimateSoftRangeForPreviewSelection`、`refreshWorkspaceTrees`、`shared/logic/chat.ts` 29 条死再导出（22 零引用 + 7 test-only）、`format.ts` 2 条、`config-forms-agent.ts` 1 条 | dead-exports + periph 桶 |
| W2 features F-11~19, 25 | `useWorkspaceTree.ts`（67 行三 hook 全死）、`isDescendantPath`、`applyTextEditToContentBlocks`、`resolveComposerTextAfterRollbackSuccess`、`buildTailBatchRows`/`MessageBatchMode`、`SettingsToolbar`、`usePickerData`、`isPrefetchInFlightForTest`/`getActiveNativeDrag`/`clearActiveNativeDrag` | 死导出批次（`buildTailBatchRows` 与 S-D-05 第 10/11 行同批决策） |
| W1 main F-15, 16, 19, 23 | `resolveLatestReleaseFromList`、`githubReleasesUrl`/`licenseUrl`、`renameVfsFile`/`renameVfsDirectory`（逐字相同 + 3 个零消费导出）、2 个未使用 `runtime` 参数的函数、3 个测试专用 API 进生产 bundle（`registerTrackedRunForTests`/`__testRunTrackingState`/`__setAppInfoSeamsForTests`） | 死导出批次（测试面单独一条，见 S-D-27） |
| W2 features F-22 | `migration-row-value.ts` 四个状态文案 + 三态 tone 与 mobile 逐字重复 | 双端重复实现批次（建议随 S-D-18 同批收编） |

置信：confirmed（各条均实测引用数为 0 或仅测试）。

**S-D-25 | P3 | 零逻辑转发 / 等价别名 / 预留死口子**
- `main.ts:111-118`：`setEventBusForwardTarget` 的闭包与 `resolvePushWebContents` 逐字相同（F-14）
- `handlers/vfs.ts:105-110` `readBaselineContent` 一行转发（F-17）；`resolve-vfs-scope.ts:80` `getPhysicalVfs` 同型
- `vfs-operations.service.ts:31-44` 两个 rename 逐字相同 + `remapPathUnderDir` 再导出零消费（F-16）
- `yaml-shared.ts:29-32`：每次导出往 tmpdir 写一个**从未被读**的文件（`defaultPath` 传的是纯文件名），只在 `finally` 被 unlink（F-25）
- `preload.ts:18,43` `inWindowMenuBar` 硬编码 `false` 且 renderer 零读取（F-12）；`preload.ts:61-67` `off()` 零调用方，`on()` 返回的 unsubscribe 是唯一退订路径（F-13）
- `update-check/resolve-latest-release.ts:19-24` 自认「为将来预留」的零调用函数
置信：confirmed。

**S-D-26 | P3 | 刻意保留的成本台账（intentional，不按缺陷修）**
- `preview-annotate.ts`：约 520 行生产不可达（`isPreviewAnnotateDomSearchFallbackEnabled()` 恒 false
  致死分支 145 行），但仓库有 2 个测试文件专门断言「不许接线」——约 30 条用例买的是一条负向断言。
  **W2 原判 P2，本簇按 intentional 协议降 P3**，仅记成本供主代理判断是否发起清理迭代。
- `composer-body-clear.ts:7-10` `shouldClearComposerBodyAfterAgentStarted()` 恒 false（B4 契约钉死，
  有测试断言）；提示：契约翻转时这层恒假间接不会提醒任何人。
- `useColumnSplitters.ts:15` `COLUMN_SPLITTER_SIZE = 0`（若确为 0 需注释「0px 轨道 + CSS 负 margin」）。
- `ChatRail.tsx:666-726` 父子面板 `hidden` 切换不卸载（keep-alive，保 `streamingText` local state）。
- `db-maintenance-busy.ts` 独立零依赖模块、`resetDesktopRuntimeForTest` 生产复用、6 个 `forward-*.ts`
  一通道一文件、`chat-prompt-tokens` 两个 warm-inflight Set 刻意不合并 —— 均为 intentional，见 W1 原表。
置信：intentional。

**S-D-27 | P3 | 纪律类：测试面进生产包 / 格式 / 可访问性**
- 3 个测试专用 API 以普通 `export` 形态留在生产模块（`handlers/agent.ts`、`handlers/app-info.ts`），
  与内部状态机同模块、无 `NODE_ENV` 守卫；仓库已有先例可抄
  （`test/agent-run-early-exit-mock-runtime.mjs` 整个替换 singleton 模块）
- `ShellNavProvider.tsx` 被逐 token 换行格式化工具处理过：1014 行里约一半是空行与单 token 行，
  diff 完全不可读；而 CI 的 Format 是 blocking → prettier 配置与产物不自洽
- `ChatRail.tsx:551-557` `<button>` 嵌在 `<li role="button" tabIndex={0}>` 内 = 无效嵌套
- `ChatRail.tsx:389-399` / `:313-321` `useCallback` 依赖数组挂 6+2 个体内未用的符号
置信：confirmed。

**S-D-28 | P3 | React 资源管理与生命周期小账**
- `useColumnSplitters.ts:456-486` `bindSplitter` 在 `document` 上注册 `mousemove`/`mouseup`，
  cleanup 只解绑 `mousedown` → 拖拽中途卸载时监听器泄漏且两个 body class 永不移除（鼠标卡在 col-resize）
- `MermaidMarkdown.tsx:280-295` 每实例一个 `MutationObserver`（长会话几十个）+
  `SVG_CACHE_MAX=150` 只按条数不按字节（最坏几十 MB）+ `resetMermaidCacheForTests` 不取消在途 promise
- `chat-prompt-tokens.service.ts:675-681` 防抖槽 Map 生产无 clear（会话删除也不清，无上界）
- `handler-registry.ts:316-318` `AGENT_ACTIVITY_GET` 返回裸对象，是 148 条 invoke 里唯一的非 `IpcResult` 形状
- `handlers/vfs.ts:317-336` ZIP 导入「弹框分支不推 workspaceMutated、字节分支推」；角色卡导入同样不推
  （W2 suspected：renderer 可能自刷新，W6 需确认）
置信：confirmed（除最后一条）。

**S-D-29 | P3 | 本轮 4 处降级项（详见校准表）**
`useAutoUpdateCheck` StrictMode 幂等标志（仅开发环境自动更新检查永不执行，命中 RULE「验收断言的牙齿」
第 ② 条镜像形态）/ 设置页 2s 无条件轮询（无 `visibilityState` 暂停、无 diff → 每 2s 整 view 重渲）/
`WorkspaceTree.reload` 无条件重置 `expandedDirs`（agent 每写一个文件用户折叠态全弹开，
`treeExpandRequest` 只能加不能减）/ F-main-6 同款「零 diff setState」。置信：confirmed。

**S-D-30 | P3 | 统计/技能双端文案与判据残留**
`migration-row-value` 四条状态文案双份（见 S-D-24 索引）；`streamTailGenerating` 一族三处
（`MessageList` 解构即弃、上游 `ConversationPanel` 仍在传、desktop/mobile 两侧同名一行 hook 皆恒等）；
`message-blocks.ts:58-110` 同一文件两套 tool_use↔tool_result 配对算法（严格版要求同一条 user 消息集齐、
宽松版走全表 Map），而 `hideToolTurn`/`deleteToolTurn` 用严格版决定「要不要连带删 tool_result」
→ **配对判据不同源**，协议允许 tool_result 拆两条消息时会残留可见。
置信：confirmed（死码/重复）/ suspected（配对行为差异）。

**S-D-31 | P3 | 静默数据路径与陈旧闭包小账**
- `handlers/messages.ts:137-157`：消息无 `text` block 时新编辑文本被静默丢弃且返回 `ok:true`
- `ConversationPanel.tsx:347-360`：草稿持久化 effect 依赖含 `composerAttachments`，函数体写死 `attachments: []`
  → 幽灵依赖，状态条每次随流式更新触发一次多余写库
- `handlers/agent.ts:491-495`：catch 分支的 `activeRuns.delete` + `decrementDesktopAgentActive` 在可达路径上是空操作
  （increment 在 try 内最后两句），残余风险是 `await resolveDesktopSavedModelId` 让出期间另一 run 登记被误删/误减
- `ThemeProvider.tsx:67`：`toggleMode` 闭包捕获 `mode`，快速双击第二次被吞；IPC 失败时主题已切换但没落盘
- `NovelMasterProvider.tsx:140`：`<button onClick={retry}>` 把 MouseEvent 当 options 传，靠「属性不存在」侥幸工作
- `toast-bus.ts:39`：模块级单一 `hideTimer`，带 `actionLabel` 的 toast（如「发现新版本 + 查看」）会被后到的普通 toast 顶掉
- `MetricsDetailPopover.tsx:235-243`：位置只在 `anchorEl` 变化时算一次，无 scroll/resize 重定位
- `TokenUsageStatsView.tsx:387-511`：`loadError` 单槽被汇总链路与流水分页共用（互相顶掉错文案）；
  `reload` 的错误早退发生在清 `hourlyBuckets`/`selectedSliceKey` 之前 → 筛选已变但屏幕上留着上一轮图表
置信：confirmed。

## 本簇架构小结（apps/desktop 四层）

```
① main（src/main/）           装配 + 边界执行者
   main.ts: whenReady → 装菜单 → 建窗口 → bootstrapMainServices()
     ├ ipc/handler-registry.ts   唯一 ipcMain.handle 落点（4 个绑定器 + 148 行注册表）
     ├ runtime/connection.ts     better-sqlite3 单例 + initPromise 幂等 + 三驱动 once 注册
     ├ runtime/create-desktop-runtime.ts  本区对 core 的全部依赖面（唯一装配点）
     ├ runtime/desktop-runtime-singleton.ts  单例 + rebootstrap（会 closeDesktopConnection）
     ├ ipc/forward-*.ts (6)      通道级 target resolver + notify（刻意一通道一文件）
     └ services/                 2 个后台搬运任务 + 备份/云同步整库操作 + KKV 分域
② preload（src/preload/）     唯一跨进程桥，5 成员契约
   invoke / on / off / getPathForFile / startDrag；WeakMap 缓存 wrapper 以便 removeListener 命中
   头注释明文：renderer 不得 import core —— 实际被违反 9 处（S-D-06）
③ renderer/                    零数据访问，46 成员单点状态源
   App → providers（ShellNav 1014 行 / NovelMaster / Theme）→ layout（三栏 Shell）→ features/**
   hooks（useAgentStream / useAgentRunLifecycle / useColumnSplitters / useAutoUpdateCheck）
   ipc/{invoke-registry(148), client(解构导出)}  ← 编译期契约面，增删任一需同步四处
④ shared/                      类型中枢 + core 的唯一合法出口
   ipc-types.ts（1741 行 / 155 条通道 / 全部 DTO）  shared/logic/（19 个纯转发文件）
IPC 五步范式（加一条通道的完整链路）
   ipc-types.ts 加 key → handlers/<域>.ts 写实现（try/catch + formatIpcError → IpcResult）
   → handler-registry 注册 → invoke-registry 包 ipcXxx → client.ts 再导出（renderer 才看得见）
   反向 push 通道：forward-*.ts 注入 target → ipcRenderer.on 订阅 → client.ts onXxx
   push 7 条：agent-stream / agent-activity / workspace-mutated / composer-suggest
             / userMessageAppended / prompt-chat-token-updated / vfs-start-drag-failed
已知张力（三处，都是 CR 的结构性根因）
   1. shared/logic 既是 X1 的唯一出口，又没有任何纪律约束（没人拦它 export * 或塞工厂）——争议 D7
   2. 155 条通道 × 四处手工同步点，人工维护的白名单稀释了对账信噪比（11 条断链即代价）
   3. ShellNavProvider 单点状态源：46 个 context 成员，改任一导航字段牵动整个 Shell 重渲染
```

## 跨簇移交

- **S-D-01**（云同步单例持已关连接）→ `synth/cloudsync.md`：该簇已有同族 P0（w4-cloudsync-adv 实测
  `pull` 后 rev 写入已关连接必抛 `CONNECTION_CLOSED`），本簇不重复出账。
- **S-D-07**（`truncateMessagesAfter` 漏失效）→ 与 `synth/core-data.md` 的 core-service-chat
  「截断路径漏失效」交叉引用，定级以本簇 P2（潜伏）为准并附升级触发条件。
- **S-D-24**（含 1048 行孤儿表单）→ `synth/dead-backlog.md`，本簇只留引用。
- **S-D-05 第 10/11 行的悬空批次纯函数**（`transcript-selectable-role.ts` 的 10 个符号 desktop 副本
  + `MessageBatchMode` + `shared/logic/chat.ts` 内那批）→ 与 `synth/dead-backlog.md` 的
  dead-core 批次同批决策，避免同批符号被两个簇分别处置。

## 争议与存疑（上交，8 条）

| # | 争议 | 分歧双方 | 需要的裁决 | 建议对象 |
|---|---|---|---|---|
| D1 | `AgentDefinitionEditorForm`（1048 行）**删还是等迁移** | W2 features 判「待迁移」；w3-xc-dead-apps 判「真死可删」 | `git log --follow` 确认它是否被回滚掉的半成品；若产品计划把 `AgentEditorView` 迁到它则处置相反 | 主代理（W6 验证） |
| D2 | S-D-04 是否算数据丢失 | W2 features P1（静默丢编辑）；W2 自身指出 `SettingsOverlay` 注释只承诺「统一守卫入口」未承诺覆盖全部 view | 产品口径：agentEditor 走「角标 + Ctrl+S 轻量路」还是弹窗守卫 | 产品/主代理 |
| D3 | S-D-03 的 P1 分级 | 两份报告都 confirmed 机制，但真实触发概率（用户是否会打半角冒号）无实机证据 | 先实跑 `parseText('name: a\ndescription: Note: x','yaml')` 坐实再定级是否下调 | W6 验证 |
| D4 | `PROJECTS_*_AGENT_CONFIG` 的「兼容外部脚本调用」 | handler 注释这么写；W3 判「Electron IPC 只有 renderer 能调，注释理由不成立」 | 仓外是否有 `webContents.executeJavaScript` 之类调用方（本机位看不到），删除前人工确认 | 主代理 |
| D5 | `MESSAGES_HIDE_RANGE`/`SHOW_RANGE`/`TRUNCATE_AFTER` 的 A/B 拍板 | W3 给了倾向但明确不越权：UI 于 commit `722e27d5` 主动删除，双端 batch 纯函数整片悬空 | 近期是否重做批量隐藏 UI：做 → 走 A（连带 S-D-07 升 P1）；不做 → 走 B（真死删 + 连带清 10 个悬空符号） | 产品/主代理 |
| D6 | 「封装级死率」口径 | W2 desktop-core 报 10/146 ≈ 6.8% 且全列 P1；W3 逐条定性后真死 8 条 | 以后统一以 W3 的五层机器比对为准；W2 数字含误并 | 已在本文件统一（§归并方法①），备案 |
| D7 | `shared/logic/*` 无纪律约束 | 文件头注释自写禁令（intentional 派）；但 X1 机制把它当唯一出口却不用 lint 约束 | 是否给 `shared/**` 加一条「只允许 `export {} from`、禁 `export *`、禁工厂函数」的 lint 规则 | 主代理 |
| D8 | `VFS_LIST` 是否有非 UI 消费方 | W3 只扫了 `apps/` + `packages/` 的 ts/tsx，`examples/`、`scripts/` 未逐一核 | 删除前确认 examples/scripts 无直连 | W6 验证（低成本 grep） |

（另有两条非本簇争议已移交：mobile 27 条 lint error 的逐条定性归 `synth/apps-mobile.md`；
mobile `--max-warnings 321` 已失效一条归 CI 整肃，不计入本簇 8 条。）

## 本簇盲区（诚实声明）

- W1 明确未逐行读 6 个 handler 共 1211 行（`agent-registry` / `skills` / `smart-sort-rule` /
  `usage-stats` / `providers` / `workplace`），脚本已确认它们全有 catch，风险面在 DTO 映射与领域分支。
- `SettingsViews.tsx`（2508 行）只定点读了状态块与迁移行；服务商/模型/智能排序/云同步表单未逐行。
- `AgentEditorView.tsx`（1382 行）、`SearchEngineDetailView`/`SearchEnginesView` 只做符号级追踪。
  三个大文件的字段级问题（表单校验、并发保存、脏状态）不在本簇结论覆盖内。
- 本簇**未实测**项：S-D-02 的可利用性、S-D-23 的并发损坏、S-D-13 的退栈错位、S-D-18(c) 的
  null 口径产品决策、S-D-21/S-D-22 的产品意图。
