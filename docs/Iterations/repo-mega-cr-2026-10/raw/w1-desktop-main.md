---
zone: desktop-main
agent: domain-survey
files_scanned: 76
---

## 摘要（≤150字）

Electron 主进程全域：窗口/菜单生命周期、runtime 单例与 better-sqlite3 连接、148 条 invoke 注册、6 条 push 通道、6 个后台搬运任务、云同步与备份的整库搬运。装配层与 IPC 注册层结构清晰、注释密度极高且大量注明「为什么这样写」，多数看似冗余处（forward 逐通道一文件、busy 令牌计数、resetDesktopRuntimeForTest 复用、KKV 与 SKSP 分域）经查为 intentional。真实问题集中在：rebootstrap 后云同步单例不重建、renderer 传任意绝对路径触发递归删除、几处死通道/死导出、两条后台任务近乎逐行重复。

## 职责与边界

- **进程入口**：`src/main/main.ts` — `app.whenReady` → 装应用菜单 → 建窗口 → `bootstrapMainServices()`（注册 IPC → 取 runtime → 挂 3 组 eventBus/listener → fire-and-forget 挂 2 个后台搬运）。`before-quit` 统一 detach + `closeDesktopConnection`。
- **连接与 runtime**：`runtime/connection.ts`（better-sqlite3 驱动 + 平台 SKSP + tokenizer 驱动注册，`getDesktopConnection` 单例 + `initPromise` 幂等）→ `runtime/create-desktop-runtime.ts`（装配全部 core service）→ `runtime/desktop-runtime-singleton.ts`（runtime 单例 + `rebootstrapDesktopRuntime` / `clearDesktopRuntimeHandle` / `getDesktopRuntimeOrThrow`）。
- **IPC 注册**：`src/main/ipc/handler-registry.ts` 是唯一 `ipcMain.handle` 落点（`bindNoArg/bindReq/bindBool/bindEventReq` 四个绑定器 + 148 行注册表），`register-handlers.ts` 仅重导出。
- **错误归一**：`format-ipc-error.ts` 把 core 领域错误映射成 `IpcErrorPayload`；`ipc-error.ts` 再包一层重导出。
- **scope 解析**：`resolve-vfs-scope.ts` 把 renderer 的 `workspaceScope` 映射成 core `VfsScope`（`'session'` → core `project`，`'physical'` 显式拒绝写通道）。
- **push 转发**：`ipc/forward-*.ts` 6 个模块，每个只做「module-level target resolver + notify 函数」，由 main.ts 注入窗口解析器。
- **进程级状态**：`runtime/agent-activity.ts`（agent refcount）、`services/db-maintenance-busy.ts`（清理 busy 计数）、`cloud-sync.service.ts` 的 `syncBusy`。
- **边界纪律**：renderer 不得 import `@novel-master/core`（preload 头注释明写），一切域访问经 invoke；更新检查只在 main 发起（`update-check/app-meta.ts` 注明防 CORS）。

### 刻意冗余（intentional，勿当冗余删）

| 现象 | 出处 | 为何故意 |
|---|---|---|
| push 通道一通道一文件（6 个 `forward-*.ts`），结构几乎一样 | `ipc/forward-*.ts` | 每个文件头注释写明「与 X 共用同一窗口解析器」「仿 Y」，是把推送语义与窗口解析解耦；合并会把 6 个 target setter 拧成一个数组注册表，反而丢语义 |
| 4 个 `forward-*.ts` 的 `setXxxForwardTarget` + `notifyXxxToRenderer` 三函数同形 | 同上 | 便于各 handler 单点 import，import 方向保持单向 |
| `db-maintenance-busy.ts` 独立零依赖模块 | `services/db-maintenance-busy.ts:1-15` | 头注释写明：`db-maintenance.service` 要读 cloud-sync 的 `syncBusy`、cloud-sync 的 `getLocalStatus` 又要回报 `maintenanceBusy`，不抽出去会形成循环 import |
| `setDesktopDbMaintenanceBusy(bool)` 与 `acquire/release(count)` 并存 | `db-maintenance-busy.ts:41-52` | 注释写明是「兼容旧布尔调用形态」，计数语义下等价 |
| `resetDesktopRuntimeForTest` 被生产 `rebootstrapDesktopRuntime` 调用 | `desktop-runtime-singleton.ts:35-37, 51-54` | 函数体就是「关连接 + 清句柄」，生产语义与测试语义一致，只是命名没跟上 |
| 同一份 `isConnectionClosedError` 在两个搬运任务各存一份 | `blob-binary-normalization.service.ts:59-65` / `message-content-compaction.service.ts:41-47` | 见 F-7（虽仍是重复，但两文件整体是同构双胞胎，合并前需权衡） |
| preload 只暴露通用 `invoke/on/off` 三函数而非逐通道方法 | `src/preload/preload.ts:44-67` | 头注释：`on()` 用 WeakMap 缓存 wrapper，否则 `off()` 的 `removeListener` 匹配不到订阅 |
| `AGENT_ACTIVITY_GET` 返回裸 payload 而非 `IpcResult` | `handler-registry.ts:316-318` | 与 push 通道 `AGENT_ACTIVITY` 同载荷类型（`AgentActivityPayload`），是「补一次当前值」的姊妹读口 |

## 对外接口（IPC 面）

`IPC_CHANNELS` 共 **155** 条（`apps/desktop/shared/ipc-types.ts`）。机器比对结果：

- **invoke 通道（`ipcMain.handle`）**：147 条，全部在 `handler-registry.ts:224-484` 注册。
- **`ipcMain.on`（send 型，1 条）**：`VFS_START_DRAG`（`handler-registry.ts:281-286`），注释写明「须在 drag 流程中同步触发，使用 send 而非 invoke」。
- **push 通道（main → renderer，6 条）**：`AGENT_STREAM`、`AGENT_ACTIVITY`、`WORKSPACE_MUTATED`、`COMPOSER_ATTACHMENTS_SUGGEST`、`AGENT_USER_MESSAGE_APPENDED`、`PROMPT_CHAT_TOKEN_UPDATED` + 失败回传 `VFS_START_DRAG_FAILED`。

### push 通道清单：注册点 / 生产点 / 消费点

| 通道 | 转发模块（生产点） | 调用点 | renderer 消费点 |
|---|---|---|---|
| `nm:agent-stream` | `ipc/forward-event-bus.ts:38-48`（`attachEventBusForwarder`，8 个 `FORWARDED_EVENTS`） | eventBus 订阅回调 | `renderer/ipc/client.ts` 的 `onAgentStream`；`useAgentStream.ts`（RULE.md:41 记的「子会话写入刷新」旁路在 `ShellNavProvider.tsx`） |
| `nm:agent/activity` | `ipc/forward-agent-activity.ts:24-26` | `subscribeDesktopAgentActivity` 回调 | `client.ts:200-206` `onAgentActivity` ← `hooks/useDesktopAgentActive.ts` |
| `nm:workspace/mutated` | `ipc/forward-workspace-mutated.ts:29-32` | `handlers/vfs.ts:82-84`（写通道统一 `pushWorkspaceMutated`）、`handlers/sessions.ts:121-124`（pushTemplate） | `client.ts:209-216` ← `ShellNavProvider.tsx:314` |
| `nm:composer/attachmentsSuggest` | `ipc/forward-composer-attachments-suggest.ts:22-27` | `services/user-vfs-turn-execute.service.ts:27-30`、`services/notify-composer-status-after-kkv-clear.ts:22-26 / 37-41` | `client.ts:219-226` |
| `nm:agent/userMessageAppended` | `ipc/forward-user-message-appended.ts:21-25` | `handlers/agent.ts:440-442`（`runAgentTurn` 的 `onUserMessageAppended`） | `client.ts:242-249` |
| `nm:prompt/chatTokenUpdated` | `ipc/forward-prompt-chat-token-updated.ts:28-33` | `services/chat-prompt-tokens.service.ts`（`pushPreciseStatsIfReady`） | `client.ts:232-239` |
| `nm:vfs/startDragFailed` | `handlers/vfs.ts:449-451`（send，非 invoke） | `ipcMain.on` 回调 | `client.ts:252-259` ← `features/workspace/workspace-batch-dnd.ts:92` |

**invoke 通道覆盖比对**（脚本比对 `shared/ipc-types.ts` × `handler-registry.ts` × `renderer/ipc/invoke-registry.ts`）：

- 注册但 renderer 无 invoke 封装：**仅** `VFS_LIST`（另 `VFS_START_DRAG` 走 preload `startDrag()`，属设计）。→ 见 F-3。
- invoke-registry 导出但 renderer 无任何组件消费：`ipcProjectsGetAgentConfig` / `ipcProjectsUpdateAgentConfig`（全仓 grep 仅命中 `ipc-types.ts` / `invoke-registry.ts` / `client.ts` / main handler）。→ 见 F-10。
- 双侧命名一致性：`IPC_CHANNELS` key 与 `invoke-registry` 的 `ipcXxx` 一一对应，**未发现命名不一致**。唯一次要例外是 `SHELL_OPEN_EXTERNAL`（key 前缀 `SHELL_`，handler 却来自 `handlers/app-info.ts` 的 `handleAppOpenExternal`，`handler-registry.ts:481`）—— 属归类不一致，非缺陷（P3，见 F-19 备注）。
- `IPC_CHANNELS` 与 `handler-registry` 之间的「5 步范式」（ipc-types 加通道 → handler 实现 → registry 注册 → invoke-registry 封装 → client 导出）在 memory `20260823-usage-stats-page-research.md:146` 有明确留痕（「Step 6…shared DTO → handler → registry → runtime 装配 → invoke-registry → client」），属**流程约定 intentional**。

## 数据访问（库连接/表/KKV）

- **连接**：`runtime/connection.ts:31-46` 单例 `tdbc:sqlite:file:${dbPath}` + `driver: "better-sqlite3"`，`bootstrapNovelMaster(c)` 建 schema。`resolve-db-path.ts`：`NOVEL_MASTER_DB` 环境变量优先，否则 `app.getPath("userData")/novel.db`。
- **驱动注册**（`ensureDriversRegistered`，once/进程）：better-sqlite3、平台 SKSP（mac/win/linux）、tokenizer-node（`resolve-tokenizer-assets-root.ts`：打包读 `process.resourcesPath/tokenizers`，dev 回落 monorepo 默认）。
- **secret**：`createCompositeSecretStore({ db: SKSP-store, env: createEnvSecretStore() })`，`NM_SKSP_DISABLE_ENV=1` 可关 env 段（`create-desktop-runtime.ts:96-105`）。
- **KKV**：
  - `nm-desktop-ui` — `storage/app-ui-prefs.ts:11`（theme / chatRichText / updates.* 六键，含 defaults 表）
  - `nm-cloud-sync` — `services/cloud-sync-config.store.ts:11`（14 个非密钥键）
  - `nm-search` — core `createSearchConfigStore({kkv, secretStore})`（`create-desktop-runtime.ts:107`）
  - `nm-preferences` / `nm-workspace-state` — core `createPersistentPreferences` / `createPersistentState`
- **SKSP ref**：`cloud-sync/s3-secret-key`（`cloud-sync-config.store.ts:12`）。
- **本区不直接写 SQL**（除 `connection.ts:58` 的 `PRAGMA wal_checkpoint(FULL)`）。所有表访问经 core service 端口。这与 RULE.md:26「TDBC 驱动层」的分工一致，**是本区最重要的边界**。
- **文件级操作**（不经 VFS）：备份整库 `copyFile/writeFile`（`db-backup.service.ts`）、YAML 导出临时文件（`yaml-shared.ts`）、ZIP 物化目录（`vfs-batch.service.ts:280-337`，stagingRoot 在 `userData/vfs-batch-export/<uuid>`，5 分钟 TTL）。

## 依赖关系（对 core 各域的依赖）

`create-desktop-runtime.ts` 的 import 面（= 本区对 core 的全部依赖）：

| core 子路径 | 装配的东西 |
|---|---|
| `/agent` | abortRegistry / agentRegistry / streamRegistry；`resolveAgentForProject`、`resolveSavedModelId`、`resolveApplicationModelIdForRun`、`runAgentTurn`、`AgentTurnError`、`AgentRunResolveError`、`resolveAgentToolRegistry`、`agentDefinitionSchema` |
| `/chat` | `createChatServices`（projects/sessions/messages/usageStats）、`createMessageTranscriptEffectsService`、`createUserVfsTurnServiceBundle`、`prepareUserMessagesForPrompt`、`messageBodyText`、`textBlocks`、`readMessageMetadata`、`clearChatAnnotateDrafts`、`chipsFromAnnotateStore` |
| `/provider` | `createProviderServices`、`createDefaultTokenCounterRegistry`、`countPromptLlmInputHeuristicOnly`、`resolvePromptTokensWithBackfill`、`resolveTokenCounterModeForModel`、`serializePromptLlmInput`、`compareAppVersions`/`excerptReleaseNotes`（`/common`） |
| `/prompt` | `buildPromptLlmInputFromLayout`、`buildPromptPreviewSegmentsFromLayout`、`applyThinkingContextForLlm`、`resolvePreviewThinkingContext`、`messageBodyText` |
| `/vfs` | `createScopedVfsService`、`createPhysicalVfsService`、`createVfsZipIoService`、`createVfsBatchIoService`、`createCharacterCardImportService`、`moveVfsPath`、`readUserVfsSaveBaseline`、`buildUserVfs{Save,CreateFile,Mkdir,Delete,Rename}Op`、`VfsError`/`CharacterCardError`/`VfsZipError`/`isVfsError` |
| `/workplace` | `createWorkplaceService`、`assembleWorkplaceDisplay`、`WorkplaceAssemblyAbortedError` |
| `/compaction` | `runCompaction`、`createCompactionConditionEvaluator`、`createCompactionConditionsStore` |
| `/events` | `SimpleEventBus` + 8 个 `EVENT_AGENT_*` 常量 |
| 根导出 | `open` / `bootstrapNovelMaster` / `KkvService` / `PersistentState` / `PersistentPreferences` / `CloudSyncCoordinator` / `createDbMaintenanceService` / `runBlobBinaryNormalization` / `runMessageContentCompaction` / `agentDefinitionSchema` / `parseText` / `stringifyText` / `decode` / `encode` / `ToolRegistry` / `registerBuiltinTools` |
| `/skills` `/session-kkv` `/kkv` `/sksp` `/smart-sort-rule` `/message-checkpoint` `/session-fs` `/feature-flags` `/config-forms` | 各域 service 工厂 |

**依赖环防护（刻意设计）**：
1. `chat-prompt-tokens.service → ipc/handlers/agent.ts` 单向；反向的「run 结束补读口」用**注入口** `setRunFinishedTokenStatsRefresh` 避免成环（`agent.ts:287-308` 注释明写「两个模块就成环——依赖环在增删导出时极难察觉」）。
2. `db-maintenance-busy.ts` 打断 `db-maintenance.service ↔ cloud-sync.service` 的潜在环。
3. `cloud-sync.service` 对 `runtime/desktop-runtime-singleton` 用**动态 import**（`:435-437`）而非静态 import，进一步避免初始化顺序耦合。

## 发现清单

### P0

无。

### P1

**F-desktop-main-1 | P1 | `src/main/services/cloud-sync.service.ts:432-443` | 云同步服务单例在 rebootstrap 后不重建，持有已关闭连接**
```
let service: DesktopCloudSyncService | undefined;
export async function getDesktopCloudSyncService(): Promise<DesktopCloudSyncService> {
  const runtime = await getDesktopRuntime();
  if (!service) { service = new DesktopCloudSyncService(runtime); }
```
`DesktopCloudSyncService` 构造时把 `runtime.kkv` / `runtime.secretStore` 烤进 `configStore`（`:161-164`）。而 `rebootstrapDesktopRuntime()`（`desktop-runtime-singleton.ts:35-37`）会 `closeDesktopConnection()` —— 旧 conn 关闭。两条生产路径都会 rebootstrap：`ipc/handlers/backup.ts:49`（备份导入成功）、`ipc/handlers/cloud-sync.ts:91`（pull 之后无条件 rebootstrap）。此后所有云同步 handler 拿到的仍是绑在死连接上的旧 service，`configStore.getConfig()` → `kkv.get` 会撞 better-sqlite3 的 not-open。全仓唯一清位入口是 `resetDesktopCloudSyncServiceForTest()`（`:446-449`），只在 `test/cloud-sync-handlers.test.ts` / `test/db-maintenance-handlers.test.ts` 里调。
建议：把 `resetDesktopCloudSyncServiceForTest` 拆出一个生产版 `invalidateCloudSyncService()`，在 `rebootstrapDesktopRuntime` 内（或其两个调用点之后）调用；或让 `DesktopCloudSyncService` 每次 `await getDesktopRuntime()` 而非持句柄。
置信：**confirmed**（代码事实链完整：构造持句柄 → rebootstrap 关连接 → 单例无重置路径）。

**F-desktop-main-2 | P1 | `src/main/ipc/handlers/vfs.ts:423-432` + `src/main/services/vfs-batch.service.ts:260-272` | renderer 可指定任意绝对路径触发主进程递归删除**
```
export async function handleVfsBatchClearStaging(req: VfsBatchClearStagingRequest) {
  try {
    await clearVfsBatchExportStaging(req.stagingRoot);
```
```
export async function clearVfsBatchExportStaging(stagingRoot: string): Promise<void> {
  if (stagingRoot.trim() === "") return;
  ...
  await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
```
`stagingRoot` 的**唯一生成方**是主进程（`vfs-batch.service.ts:295-299`，`join(app.getPath("userData"), "vfs-batch-export", randomUUID())`），但清理通道原样信任 renderer 传入的字符串，没有「必须位于 `<userData>/vfs-batch-export/` 之下」的前缀/祖先断言，也没有 `resolve()` + `startsWith()` 归一。renderer 侧任一 bug（或将来加载了外部内容）传 `C:\Users\x` 就会连带删用户目录。同域的 `handleVfsZipPick` / `handleAppOpenExternal` 都做了入参校验（`app-info.ts:101` 的 `^https?://` 正则），这里缺同款。
建议：`clearVfsBatchExportStaging` 内加 `const root = resolve(stagingRoot); const base = resolve(app.getPath("userData"), "vfs-batch-export"); if (root !== base && !root.startsWith(base + sep)) return;`。
置信：**confirmed**（代码无任何校验）；可利用性 **suspected**（renderer 是 sandbox+contextIsolation 的本地构建产物）。

### P2

**F-desktop-main-3 | P2 | `src/main/ipc/handler-registry.ts:263` | `VFS_LIST` 是注册了但 renderer 零消费的 invoke 通道**
```
bindReq(IPC_CHANNELS.VFS_LIST, handleVfsList);
```
`handlers/vfs.ts:112-130` 实现了完整 handler，`shared/ipc-types.ts:441` 定义了 `VfsListRequest`，但 `VFS_LIST` 不在 `renderer/ipc/invoke-registry.ts`（脚本比对：注册但未被 invoke 的只剩它和走 preload 的 `VFS_START_DRAG`），`renderer/` 下无任何 `IPC_CHANNELS.VFS_LIST` 引用。实际树形浏览走的是 `WORKPLACE_BUILD_LIST_ROWS` / `PHYSICAL_LIST`。
建议：删掉 `VFS_LIST` 通道 + `handleVfsList` + `VfsListRequest/EntryDto` 映射（或补一条「为何保留」注释）。`knip` 未拦住说明它不在依赖图里被当死码判定。
置信：**confirmed**。

**F-desktop-main-4 | P2 | `src/main/ipc/handlers/agent.ts:374-390` | 两个 handler 缺 `try/catch`，破坏全仓统一的 `IpcResult` 错误契约**
```
export async function handleAgentAbort(req: AgentAbortRequest): Promise<IpcResult<void>> {
  await abortAgentRun(req.sessionId);
  return { ok: true, data: undefined };
}
...
export async function handleAgentRunIsActive(req) {
  const rt = await getDesktopRuntime();
  return { ok: true, data: rt.abortRegistry.has(req.sessionId) };
}
```
脚本扫全部 handler：只有这两个（外加 `shell.ts` 两个纯同步、无抛点的）没有 `try/catch`。`abortAgentRun` / `getDesktopRuntime()` 在冷启动/连接被 rebootstrap 期间会 reject，promise 直接逃出 `ipcMain.handle` → renderer 拿到的是 Electron 序列化的原始 Error，而不是 `IpcResult` 里带 `code` 的 `IpcErrorPayload`。`useAgentStream`/停止按钮的调用方大概率为 `res.ok` 判空，行为退化成未定义。
建议：给这两个补上和同文件其余 handler 一致的 `try { ... } catch (err) { return { ok: false, error: formatIpcError(err) }; }`。
置信：**confirmed**。

**F-desktop-main-5 | P2 | `src/main/services/session-prompt-input.service.ts:139` | 每次 build 都跑一次整串 prompt 渲染，产物生产零消费**
```
const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
return { definition: resolved, layout: resolved.prompts, ctx, input, rawMessages: visibleMessages };
```
`SessionPromptInputBundle.input`（`:46`）的两个生产调用方都不解构它：`chat-prompt-tokens.service.ts:213` 只取 `{ definition, layout, ctx, rawMessages }`，`prompt-preview.service.ts:65` 只取 `{ layout, ctx }`（全仓 `.input` grep 只命中 `messages.ts:49` 的 `block.input`）。这正好落在该文件头注释花了 40 行论证「build 是秒级重活、要分段弃权」的那条热路径上。
建议：删掉 `input` 字段与这次渲染，或改成 lazy getter。
置信：**confirmed**（两个调用方 + 测试均未读 `bundle.input`）。

**F-desktop-main-6 | P2 | `src/main/services/db-backup.service.ts:99-174` | 两个 import 函数约 40 行逐行重复**
`importDatabaseBackupFromPath`（`:99-133`）与 `importDatabaseBackupFromBytes`（`:141-174`）除了最后一步 `copyFile(srcPath, dbPath)` vs `writeFile(dbPath, bytes)`，其余完全一致：assert → 算 dbPath/bakPath → `getDesktopConnection` + `dumpProviderTableSnapshot` → `try { copyFile(bak); closeLiveDbForBackupImport(); 写入; restoreConn 恢复 } catch { 回滚 } finally { unlink(bak) }` + busy 令牌 finally。两次改动要同步两处。
建议：抽出 `replaceDbFileWithSnapshot(write: (dbPath) => Promise<void>)` 单一内核，两入口只传写入策略。
置信：**confirmed**。

**F-desktop-main-7 | P2 | `src/main/services/blob-binary-normalization.service.ts:41-68` vs `src/main/services/message-content-compaction.service.ts:40-56` | 两个后台搬运任务近乎逐行同构**
重复项：`isConnectionClosedError`（同一段 `lower.includes("connection is not open") || lower.includes("not open")`）、`sleep`、`GUARD_RETRY_DELAY_MS = 5000`、`RECONNECT_RETRY_DELAY_MS = 1000`、三守卫组合（`isDesktopAgentActive() || isDesktopCloudSyncBusy() || isDesktopDbMaintenanceBusy()`，仅顺序不同）、`result.done → return` / `result.stalled → warn + return` / 其余 `await sleep(0)` 的收手口径、`beforeMaintenance/afterMaintenance` 的一对 `setDesktopDbMaintenanceBusy`。两个文件头注释也几乎逐字重复。这是一份守卫语义的**双份真源**——将来改「什么算连接已关」或加第四个守卫要记得改两处。
建议：抽 `services/desktop-maintenance-loop.ts`（守卫组合 + 连接已关判定 + stalled 收手 + sleep 常量），两个任务只留「调哪个 core 任务 / 传什么 options」。
置信：**confirmed**（重复是刻意同构，但代价是真源分裂；给 P2 而非 P1）。

**F-desktop-main-8 | P2 | `src/main/services/cloud-sync-config.store.ts` `setConfig` | 保存配置会无条件把云同步重新置为启用**
```
kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_DEVICE_LABEL, ...),
kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_ENABLED, "true"),
```
UI 侧有独立的 `CLOUD_SYNC_SET_ENABLED` 通道（`handlers/cloud-sync.ts`），用户在设置页关掉同步后，只要再保存一次配置（哪怕只想改 Bucket），`enabled` 会被静默写回 `"true"`。`setEnabled(false)` 的语义被 `setConfig` 悄悄推翻。
建议：`setConfig` 不动 `enabled`（首次配置时若无 enabledRaw 才置 true），或在 UI 层明确「保存配置会重新启用」。
置信：**suspected**（未见 UI 侧是否有对应提示或保存前重置的配套逻辑）。

**F-desktop-main-9 | P2 | `src/main/ipc/handlers/projects.ts:81-108` | 已下线的「项目智能体」在 renderer 侧留了整条死 IPC 面**
```
/** @deprecated 项目智能体功能已下线，保留 handler 以兼容外部脚本调用，恒返回 follow 默认。 */
export async function handleProjectsGetAgentConfig(_req) { return { ok: true, data: { mode: "follow" } }; }
...
console.warn("[nm-desktop] projects.updateAgentConfig called but project agent feature is removed; ...");
```
主侧保留是 RULE.md:38 记载的**刻意决策**（「保留 handler 以兼容外部脚本调用」）。但 renderer 侧 `invoke-registry.ts:204-211` 的两个封装与 `client.ts:50-51` 的再导出，全仓 grep 显示**无任何组件消费**——这部分是纯死代码。另外 `handleProjectsUpdateAgentConfig` 的 `try/catch` 包着一段不可能抛错的代码（`void req; console.warn; return`），错误分支是死路径。
建议：删 `invoke-registry` + `client` 的两条导出（主侧 handler 按 intentional 保留）；`handleProjectsUpdateAgentConfig` 的 try/catch 可平铺。
置信：**confirmed**（死消费面）/ 主侧保留 **intentional**。

**F-desktop-main-10 | P2 | `src/main/ipc/handlers/vfs.ts:161-183` | 检测到用户编辑漂移后仅 `console.info`，仍照常覆盖写**
```
if (req.lastKnownContent != null && baseline != null && req.lastKnownContent !== baseline) {
  console.info("[user-vfs-turn] external_drift_detected", { path: req.path });
}
const op = buildUserVfsSaveOp(baseline, req.content, req.path, req.content);
if (op != null) { await executeSessionUserVfsOp(rt, scope.sessionId, op); }
```
`lastKnownContent` 与盘上 baseline 不一致，说明用户在编辑器打开期间 agent 改过同一文件。这里只打一行 `console.info`（info 级、默认不落 desktop-log 文件），随后 `buildUserVfsSaveOp` 仍以 `req.content` 提交，用户基于旧内容的编辑静默覆盖 agent 的新写入。对比同域的 `handleVfsBatchIngestFromPaths` 走的是「冲突 → `needs_confirm` → renderer 二次确认」，此处缺同等级的处置。
建议：漂移时返回 `{ok:false, error:{code:"CONTENT_DRIFT", ...}}` 让 renderer 弹确认，或至少提到 `desktopLogWarn`。
置信：**suspected**（可能产品上刻意选择「静默以用户为准」，但代码没写这层意图）。

**F-desktop-main-11 | P2 | `src/main/services/db-backup.service.ts:180, 211` | Agent 守卫在弹 dialog 之前取样，弹窗期间不持 busy**
```
export async function exportDatabaseBackup(runtime, parentWindow) {
  if (isDesktopAgentActive()) { throw new Error("Agent 运行中，请稍后再导出数据库"); }
  ...
  const result = win ? await dialog.showSaveDialog(win, {...}) : ...
  await exportDatabaseBackupToPath(runtime, result.filePath);
```
`isDesktopAgentActive()` 是一次瞬时取样；紧接着的 `showSaveDialog` 是**用户可无限时长挂起**的模态。用户在保存框里慢慢挑目录的 3 分钟内，agent 可以起 run，随后 `exportDatabaseBackupToPath` 照跑（checkpoint + copyFile + scrub 都作用在同一条 better-sqlite3 连接上）。busy 令牌直到进了 `exportDatabaseBackupToPath` 才 acquire，窗口没盖住。对比 `runDbMaintenance`（`db-maintenance.service.ts:96-131`）是「先判守卫 → 立刻置 busy → 再干活」，纪律更严。
建议：`exportDatabaseBackup` / `importDatabaseBackup` 在弹框前就 acquire busy（或在弹框返回后**复查一次** `isDesktopAgentActive()` 再决定是否继续）。
置信：**suspected**（窗口客观存在；是否造成实际损坏取决于 better-sqlite3 在 checkpoint 时的并发容忍度，未实测）。

### P3

**F-desktop-main-12 | P3 | `src/preload/preload.ts:18, 43` | `inWindowMenuBar` 硬编码 `false` 且 renderer 零读取**
```
readonly inWindowMenuBar: boolean;
...
inWindowMenuBar: false,
```
全仓（含 `renderer/`、`test/`）只有这两行出现。preload 暴露了一个永远为 false 的死口子。
建议：删字段，或接上真实判定（`shell-menu.ts:97-107` 的 `popupShellSubmenu` 是 Windows/Linux 的应用菜单弹窗实现，字段大概本意是「是否走窗口内菜单栏」但没接上）。
置信：**confirmed**。

**F-desktop-main-13 | P3 | `src/preload/preload.ts:21, 61-67` | `off()` 暴露但无任何调用方**
```
off(channel, callback) {
  const listener = ipcListenerByCallback.get(callback);
  if (listener) { ipcRenderer.removeListener(channel, listener); ipcListenerByCallback.delete(callback); }
},
```
`on()` 已经返回 unsubscribe 闭包（`preload.ts:56-60`），`off()` 是第二条冗余退订路径。`renderer/layout/PreviewPane.tsx:298` 的 `anno.off(...)` 是另一个对象的方法。`on()` 的返回值（`client.ts` 全部 `onXxx` 都 `return bridge().on(...)`）是唯一实际使用的退订方式。
建议：删 `off()`，同时删 `ipcListenerByCallback` 里那条「off 必须解析同一个 wrapper」的注释所描述的第二条消费路径。
置信：**confirmed**。

**F-desktop-main-14 | P3 | `src/main/main.ts:111-118` | 同一个窗口解析器写了两遍**
```
setEventBusForwardTarget(() => {
  const focused = BrowserWindow.getFocusedWindow();
  return (focused ?? window).webContents;
});
const resolvePushWebContents = () => {
  const focused = BrowserWindow.getFocusedWindow();
  return (focused ?? window).webContents;
};
setWorkspaceMutatedForwardTarget(resolvePushWebContents);
```
前 5 行与 `resolvePushWebContents` 逐字相同，只是没走具名变量。改窗口策略时要改两处。
建议：`setEventBusForwardTarget(resolvePushWebContents)`（把定义上移）。
置信：**confirmed**。

**F-desktop-main-15 | P3 | `src/main/update-check/resolve-latest-release.ts:19-24` | `resolveLatestReleaseFromList` 零调用**
```
/** Reserved for future per-platform release selection from a releases list. */
export function resolveLatestReleaseFromList(releases: readonly LatestRelease[], _platform?: NodeJS.Platform) {
  return releases[0];
}
```
注释自认是「为将来预留」。全仓（含 test）无调用。
建议：删（真需要时 git 历史里有）。同类还有 `app-meta.ts:17` `githubReleasesUrl` 与 `:25` `licenseUrl` 两个零调用 URL 构造器。
置信：**confirmed**。

**F-desktop-main-16 | P3 | `src/main/services/vfs-operations.service.ts:31-44` | `renameVfsFile` 与 `renameVfsDirectory` 实现逐字相同**
```
export async function renameVfsFile(vfs, oldPath, newPath) { await moveVfsPath(vfs, oldPath, newPath); }
export async function renameVfsDirectory(vfs, oldPath, newPath) { await moveVfsPath(vfs, oldPath, newPath); }
```
两个调用点（`handlers/vfs.ts:281, 290`）也确实是按 `kind === "directory"` 二选一。等价于给同一个操作起了两个名字，未来某一支要分化语义时会漂移。同文件的 `createVfsFile`(`:7`) / `createVfsDirectory`(`:15`) 与 `remapPathUnderDir` 再导出(`:47`) 在 desktop 侧同样零消费（文件头注释自述 "ported from mobile"）。
建议：合并成一个 `moveVfsEntry`；未消费的三个导出删掉。
置信：**confirmed**。

**F-desktop-main-17 | P3 | `src/main/ipc/handlers/vfs.ts:105-110` | `readBaselineContent` 是零逻辑转发**
```
async function readBaselineContent(vfs, path): Promise<string | null> {
  return readUserVfsSaveBaseline(vfs, path);
}
```
唯一调用点 `vfs.ts:162` 传的就是 `req.path`。与 `resolve-vfs-scope.ts:80` 的 `getPhysicalVfs`（同样是一行 `return rt.physicalVfs()`）同类。
建议：内联。
置信：**confirmed**。

**F-desktop-main-18 | P3 | `src/main/ipc/handlers/messages.ts:275-291` vs `src/main/ipc/handlers/sessions.ts:27-43` | `toDto(session)` 两份逐字重复**
两处字段映射完全一致（id/projectId/title/parentSessionId/createdAtMs/updatedAtMs）。`projects.ts:17-29` 的 `toDto(project)` 是第三个同形 DTO 映射。
建议：抽一个 `toSessionDto` 到共享位置。
置信：**confirmed**。

**F-desktop-main-19 | P3 | `src/main/services/notify-composer-status-after-kkv-clear.ts:20` / `src/main/services/project-composer-status.service.ts:16` | 两个函数的 `runtime` 参数未使用**
```
export async function notifyComposerStatusAfterSessionKkvCleared(_rt: DesktopNovelMasterRuntime, sessionId: string)
export async function projectComposerStatusForSession(_rt: DesktopNovelMasterRuntime, sessionId: string)
```
（user ops 拆除后 D7 收窄成只读 annotate store，runtime 已无用，但签名保留。）下划线前缀说明是**有意识的**残留，但 3 个调用点（`handlers/messages.ts:305,352`、`handlers/sessions.ts:163`、`services/user-vfs-turn-execute.service.ts:27`）都得为此传一个用不上的参数。
建议：参数删掉，同步 3 处调用点。
置信：**confirmed**（未使用）/ 保留签名 **intentional**（保签名稳定）。

**F-desktop-main-20 | P3 | `src/main/ipc/handlers/agent.ts:491-495` | `handleAgentRun` catch 分支的 delete + decrement 在可达路径上是空操作**
```
} catch (err) {
  activeRuns.delete(req.sessionId);
  sessionRunIds.delete(req.sessionId);
  decrementDesktopAgentActive();
  return { ok: false, error: formatIpcError(err) };
}
```
`activeRuns.set` + `incrementDesktopAgentActive()` 是 try 内最后两句（`:428-429`），其后只有 `void runAgentTurn(...)`（async 调用不抛同步错），所以 catch 只能在 increment **之前**到达。此时 `decrementDesktopAgentActive()` 撞上 `agent-activity.ts:48-50` 的 `<= 0` 早退护栏（`handleAgentRun:411` 刚验过 not-active），是空操作；`activeRuns.delete(req.sessionId)` 则是删一个不存在的 key。唯一残余风险：`await resolveDesktopSavedModelId(...)`（`:417`）让出事件循环期间，另一个同 sessionId 的 `handleAgentRun` 可能已登记 entry + increment，被本函数的 catch 误删 + 误减。
建议：把 `activeRuns.set` / `increment` 提到 `try` 之前（失败时按条件回滚），或让 catch 只做 `if (activeRuns.get(req.sessionId)?.runId === null && !...)` 之类条件回滚。至少加注释说明这是防御性空操作。
置信：**suspected**（空操作 confirmed；误删竞态为理论路径，未构造复现）。

**F-desktop-main-21 | P3 | `src/main/services/chat-prompt-tokens.service.ts:675-681` | 防抖槽 Map 生产环境无回收**
```
const chatPromptTokenDebounceSlots = new Map<string, ChatPromptTokenDebounceSlot>();
const chatPromptTokenDebounceExecCounts = new Map<string, number>();
```
只有 `resetChatPromptTokenDebounceForTests()`（`:766-774`）会 `clear()`，生产无调用。用户在 app 生命周期内打开过的每个会话各留一个 slot + 一个计数（数值单调增长），会话被删除也不清。量级小（每会话几十字节）但无上界。
建议：给 slot 加 idle TTL，或在 `HANDLER_SESSIONS_DELETE` 里清对应 key。
置信：**confirmed**（无生产 clear 路径）。

**F-desktop-main-22 | P3 | `src/main/ipc/handlers/vfs.ts:317-336` | ZIP 导入的弹框分支不推 workspace mutated，字节分支推**
```
export async function handleVfsZipImport(req: VfsZipRequest) {
  ...
  const result = await importVfsZipWithDialog(rt, scope, {...}, focusedWindow());
  return { ok: true, data: result };     // ← 无 pushWorkspaceMutated
}
...
export async function handleVfsZipImportBytes(req) {
  ...
  await importVfsZipBytes(rt, scope, {...});
  pushWorkspaceMutated(req);             // ← 有
  return { ok: true, data: undefined };
}
```
两条路径最终都走 `importVfsZipBytes` → `zipSvc.import` 落库，但只有字节分支通知 renderer 刷新 Explorer。写/删/改/批量 ingest 全都推（`pushWorkspaceMutated` 在 `vfs.ts` 出现 6 次），角色卡导入（`:369-388`）同样不推。
建议：统一在 `importVfsZipWithDialog` 返回 `"imported"` 时也推；或统一由 service 层推。
置信：**suspected**（renderer 可能在 `App.tsx:454-467` 自行做了刷新，未逐行确认补偿逻辑）。

**F-desktop-main-23 | P3 | `src/main/ipc/handlers/agent.ts:399-406, 515-523` + `src/main/ipc/handlers/app-info.ts:52-73` | 生产模块导出 3 个测试专用 API**
```
export function registerTrackedRunForTests(sessionId: string, runId: string): void { ... }
export function __testRunTrackingState(): { activeRunsCount: number; sessionRunIdsCount: number } { ... }
export function __setAppInfoSeamsForTests(overrides: Partial<AppInfoSeams> | null): void { ... }
```
`registerTrackedRunForTests` 带注释「生产代码不得调用」，但它是**普通 export**（非 `__` 前缀、无 `if (process.env.NODE_ENV)` 守卫），与真正的内部状态机同模块。`app-info.ts` 的 seam 覆写机制同理：生产启动后若被误调可把 `getVersion` 换成 `"0.0.0"`。
建议：迁到 `test/` 侧的 mock runtime（仓库已有先例：`test/agent-run-early-exit-mock-runtime.mjs` 整个替换 singleton 模块），或统一 `__` 前缀并在 `registerHandlersFromRegistry` 之外不导出。
置信：**confirmed**（死/测试面在生产 bundle 里可达）。

**F-desktop-main-24 | P3 | `src/main/ipc/handlers/messages.ts:137-157` | 无 text block 时新编辑文本被静默丢弃**
```
for (const block of blocks) {
  if (block.type === 'text') { if (!textReplaced) { result.push({ type: 'text', text: newText }); textReplaced = true; } }
  else { result.push(block); }
}
return { blocks: result };
```
若消息没有 `text` block（纯 tool_result / 纯 thinking 消息），循环不 push 任何 text，新文本无声消失，且 handler 返回 `ok:true`。
建议：无 text block 时 push 一个新 text block，或返回错误。
置信：**suspected**（`MESSAGES_EDIT` 的 UI 入口是否可能对无正文消息可达，未确认）。

**F-desktop-main-25 | P3 | `src/main/services/yaml-shared.ts:29-32` | 每次 YAML 导出往 tmpdir 写一个从未被读的文件**
```
const tmpPath = join(tmpdir(), fileName);
await writeFile(tmpPath, yaml, "utf8");
...
defaultPath: fileName,   // ← 传的是纯文件名，tmpPath 从未被引用
```
注释说「内部先写入 os.tmpdir() 下的临时文件（用作 defaultPath 参考）」，但 `defaultPath` 传的是 `fileName`，tmp 文件从头到尾没人读，只在 `finally` 被 unlink。每次导出（agentYaml/export、sort-rule/yamlExport）多一次磁盘写 + 删。
建议：删掉 tmp 写入，或把 `defaultPath: tmpPath` 真的用上（让保存框默认落在 tmp 里再让用户挪）。
置信：**confirmed**。

**F-desktop-main-26 | P3 | `src/main/ipc/handler-registry.ts:316-318` | `AGENT_ACTIVITY_GET` 返回裸对象，与全仓 `IpcResult` 契约不一致**
```
bindNoArg(IPC_CHANNELS.AGENT_ACTIVITY_GET, () => ({ active: isDesktopAgentActive() }));
```
其余 146 条 invoke 全返回 `IpcResult<T>`（`{ok:true,data}` / `{ok:false,error}`），这条直接返回 `{active}`。renderer 侧 `invoke-registry.ts:172` 也如实声明成 `noArg<AgentActivityPayload>`，`hooks/useDesktopAgentActive.ts:11` 直接 `void ipcAgentActivityGet()`。当前实现不会抛（`isDesktopAgentActive` 纯读内存计数），所以**当下无 bug**；但它是 148 条通道里唯一的例外形状，将来给它加数据源就成隐雷。
建议：要么包成 `IpcResult<AgentActivityPayload>`，要么在 `ipc-types.ts` 注明「本通道刻意裸返回，与 push 同载荷」。
置信：**confirmed**（形状不一致）/ 现状 **intentional 或疏忽，二选一**。

**F-desktop-main-27 | P3 | `src/main/ipc/handler-registry.ts:481` | `SHELL_OPEN_EXTERNAL` 注册的是 `handlers/app-info.ts` 的 handler**
```
bindReq(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, handleAppOpenExternal);
```
通道前缀是 `nm:shell/`，实现却住在 `app-info.ts`（与 `APP_GET_INFO` / `APP_CHECK_FOR_UPDATES` 同文件）。纯归类不一致，不是缺陷——`app-info.ts` 的注释解释过（app 元数据 + 外链 + 更新检查同属「应用外壳」），但从 `SHELL_*` 前缀找 handler 会扑空。
建议：要么挪进 `handlers/shell.ts`，要么在 `ipc-types.ts:201` 加一行「本通道实现在 app-info.ts」的指引。
置信：**confirmed**（低危）。

## 争议与存疑

1. **`main.ts` 启动失败不阻断**：`:186-190` 里 `bootstrapMainServices()` 抛错只 `console.error`，app 照常起、窗口照常显示，此后每次 IPC 都在 handler 里各自失败。是「首屏可见 + 逐操作报错」的有意取舍，还是漏了 `app.quit()` / 错误弹窗，未见注释说明。
2. **`bootstrapMainServices` 里 forward target 的安装点在 `createMainWindow()` 内**（`main.ts:111-123`），macOS `activate` 重建窗口时会重复 set 同一批 resolver。因为 resolver 闭包捕获的是**当次**的 `window`，旧窗口销毁后 `getFocusedWindow()` 兜底才生效；多窗口并存时是否总推到正确窗口未验证。
3. **`handleCloudSyncPull` 无条件 rebootstrap**（`cloud-sync.ts:91`）：`service.pull()` 在 `ALREADY_UP_TO_DATE` 时会 early-return（`cloud-sync.service.ts:259-263`），此时库文件根本没换，却仍然 `rebootstrapDesktopRuntime()` → 关连接 + 重 bootstrap + 重建整个 service graph。对比 `handleBackupImport` 是 `if (result === "imported")` 才 rebootstrap。是否有意（简化口径）还是漏判，未见注释。**未列入正式发现，因为不确定产品是否接受"点一次已是最新就重建一次"的代价。**
4. **F-10（编辑漂移静默覆盖）与 F-11（弹框期无守卫）** 都可能是刻意的产品取舍（"用户操作优先"、"`checkpoint` 本身安全"），代码里没写这层意图，无法判定是缺陷还是设计。
5. **`blob-binary-normalization.service.ts` 的 `scheduledRuntime` 身份去重**（`:145-174`）：注释解释得很完整（cr-05 方案 A、finally 清键防挂死），逻辑自洽，未发现问题；但它依赖「runtime 对象身份每次 rebootstrap 都变」这一隐含前提，`rebootstrapDesktopRuntime` 若将来改成复用 runtime 对象，这层去重会静默失效。
6. **本区未逐行读完的 6 个 handler**：`handlers/agent-registry.ts`(235)、`handlers/skills.ts`(212)、`handlers/smart-sort-rule.ts`(232)、`handlers/usage-stats.ts`(235)、`handlers/providers.ts`(111)、`handlers/workplace.ts`(186)——共 1211 行。它们走的是与已读 handler 相同的 `try/catch + formatIpcError` 模板（脚本已确认全部有 catch），风险面主要是 DTO 映射与领域分支，本轮未深查。
7. **`chat-prompt-tokens.service.ts:275` 与 `:295` 两个 warm-inflight Set 刻意不合并**（`:281-294` 有 14 行论证）——标 **intentional**，不是冗余。同理 `withRealFallbackCounter`（`:133-156`）的「禁用对象展开」禁令、`registerTrackedRunForTests` 的注释，都是为钉住某条不变式而存在的显式冗余。
