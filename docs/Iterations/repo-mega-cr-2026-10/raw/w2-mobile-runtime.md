---
zone: mobile-runtime
agent: domain-survey
files_scanned: 82
files_list: apps/mobile/src/{runtime,services,db,storage,vfs}/**（全部 82 个文件，11 819 行，实测）
measured_at_head: feat/repo-mega-cr @ d3b1049a（`git log -1` 为准）
---

# W2 · mobile-runtime 按域测绘

## 摘要

移动端 RN 运行时的宿主层。`runtime/` 负责启动装配（打开 op-sqlite 单连接、注册三个原生
驱动、拼装 core 全部 service、bootstrap `SessionStreamUnitManager` 并注入三桥）；
`db/` 是单连接与库文件路径探测；`services/` 是宿主侧服务群——最大的是会话流式单元编排器
`session-stream-unit-manager`（1977 行）+ 单元本体 `session-stream-unit`（1269 行），
承担 run 门禁、事件收尾、通知/保活、run 态持久化与消息面单一来源；其余是云同步
（S3 + 全量库快照）、DB 备份/维护、提示词 token chip、VFS/工作区操作编排、流式缓冲与
token 估算绑定；`storage/` 是 appUi KKV 偏好与 composer 草稿；`vfs/` 只有常量与错误重导出。

## 职责与边界

- **装配（`runtime/`）**：`create-mobile-runtime.ts` 是唯一的服务工厂，返回
  `MobileRuntimeCore`（= `MobileNovelMasterRuntime` 去掉 `sessionStreamUnitManager`）。
  `SessionStreamUnitManager` 刻意不进工厂（避免纯工厂带副作用），由
  `novel-master-context.tsx:176-186` 在 runtime 就绪后 `Object.assign` 挂上。
- **连接（`db/connection.ts`）**：`getMobileConnection()` 单飞打开 `MOBILE_TDBC_URL`
  （`tdbc:sqlite:file:novel_master_vfs`，driver `op-sqlite`），依次注册
  op-sqlite（带 AppState 后台探测）/ SKSP android / tokenizer RN 三个原生驱动，再
  `bootstrapNovelMaster`。bootstrap 失败时显式 close 局部 `c`（注释解释了为何不能靠
  `closeMobileConnection`）。`registerMobileOpSqliteDriver()` 是驱动注册的唯一合法入口
  （注册表 last-wins，无参版会丢后台探测）。
- **流式单元（`services/session-stream-unit{,-manager}.ts`）**：manager 在 React 树外，
  按 sessionId 维护 `units` 注册表（starting/running 门禁 + settled 宽限 30s + LRU 8）、
  `settledProjections`（「上次生成」常驻投影）、`idleMessageViews`（无单元会话的消息面）、
  `writethroughs`（run 态写通 coalescer）；单元本体自持状态机、32ms ingress + 64ms apply
  两段流式缓冲、webview 句柄注册表与消息管线。
- **宿主侧 IO（`services/`）**：云同步（`cloud-sync*.ts` + `@novel-master/cloud-sync-driver-s3`）、
  全量库导入导出（`db-backup.service.ts`，文件级 cp + 服务商三表隔离）、
  数据清理（`db-maintenance.service.ts`，本体在 core）、两个后台搬运循环
  （blob 二进制归一 / 消息正文压缩）、偏好与更新检查、VFS/工作区操作编排、选择器与
  文件读写封装（`document-io.ts` / `rn-file-io.ts` / `document-pick.ts`）。
- **不在本区**：WebView 三层产物链（`src/web/**`，RULE「webview 改动是三层产物链」）、
  导航与各屏 hook、native 模块（`llm-sse-native` / `tdbc-driver-op-sqlite` / `tokenizer-driver-rn`）。

## 对外接口（导出符号）

`runtime/`：
- `createMobileNovelMasterRuntime(): Promise<MobileRuntimeCore>`（`create-mobile-runtime.ts:81`）
- `NovelMasterProvider` / `useNovelMaster` / `ensureKeepAliveResidentBoot` /
  `createNotificationPrefBridge`（`novel-master-context.tsx`）
- `loadMobileScope` / `setMobileProject` / `setMobileSession` / `MobileScopeSnapshot`（`mobile-scope.ts`）
- `incrementAgentActive` / `decrementAgentActive` / `isMobileAgentActive` /
  `subscribeMobileAgentActivity` / `setMobileAgentActive(deprecated)`（`agent-activity.ts`）
- `ensureLlmFetchConfigured`（`setup-llm-fetch.ts:27`）、`mobileSkspDriverName`（`mobile-sksp.ts:6`）

`db/`：`getMobileConnection` / `closeMobileConnection` / `checkpointMobileDatabase` /
`registerMobileOpSqliteDriver`；`buildMobileDatabaseFilePathCandidates` /
`probeAndCacheMobileDatabaseFilePath` / `resolveMobileDatabaseFilePath` /
`clearMobileDatabaseFilePathCache` / `getMobileDatabaseFilePath`

`services/session-stream-unit-manager.service.ts`（对 UI 的主要消费面）：
`startRun` / `stopRun` / `snapshot` / `subscribe` / `rateTokensPerSecond` /
`getSettledProjection` / `activeSessionIds` / `interruptedSessionIds` / `hasActiveRun` /
`forgetSession` / `attachWebview` / `detachWebview` / `requestStreamReset` /
`requestForceSnapshot` / `loadSessionTailMessages` / `loadOlderSessionMessages` /
`readMessagesSnapshot` / `hydrateSessionMessages` / `setUiBridge` / `setPrefBridge` /
`setScopeBridge` / `isHydrated` / `markHydrated` / `hydrate` / `dispose` /
`unitCount`；常量 `SESSION_STREAM_MAX_SETTLED_UNITS = 8`

`services/session-stream-unit.ts`：`SessionStreamUnit` 类 +
`isSessionStreamUnitSettled` + 常量 `SESSION_STREAM_SETTLED_GRACE_PERIOD_MS(30_000)` /
`SESSION_STREAM_INGRESS_COALESCE_MS(32)` / `SESSION_STREAM_APPLY_INTERVAL_MS(64)` /
`SESSION_STREAM_MESSAGES_PAGE_SIZE(40)`

`services/` 其余关键导出：`notifyAgentRunFinished` / `start|stopAgentKeepAliveService` /
`setKeepAliveResidentEnabled` / `registerAgentNotificationTapHandling`（`agent-finished-notification.ts`）；
`loadChatPromptTokenLabelResilient` / `begin|endChatTokenLabelFreeze` /
`warmChatTokenLabelAfterCompaction` / `isChatTokenPreciseWarmInflight`（`chat-prompt-tokens.service.ts`）；
`pullCloudSync` / `pushCloudSync` / `getCloudSyncStatusView` / `testCloudSyncConnection`（`cloud-sync.service.ts`）；
`exportDatabaseBackup` / `importDatabaseBackup` / `exportDatabaseBackupToPath` /
`importDatabaseBackupFrom{Path,Bytes}`（`db-backup.service.ts`）；
`runDatabaseMaintenance` / `getDatabaseMaintenanceStats`（`db-maintenance.service.ts`）；
`scheduleMobileBlobBinaryNormalization` / `scheduleMobileMessageContentCompaction`；
`runCompactionWithTokenWarm`（`compaction-warm-orchestration.service.ts`）；
`executeSessionUserVfsOp` / `isSessionVfsScope`（`user-vfs-turn-execute.service.ts`）

`storage/`：`createAppUiPreferences` / `AppUiPreferences`（`app-ui-prefs.ts`）；
`readEnumPref` / `readBoolPref` / `writeBoolPref`（`app-ui-pref-io.ts`）；
composer 草稿全套（`chat-composer-draft.ts`）；`app-ui-keys.ts` 的键与默认值常量

## 数据访问

**SQLite 表**：本区自身**不直接写业务表**。所有数据访问经 core service
（`@novel-master/core/*` 工厂注入）。经由本区工厂触碰的表/域（按 runtime 装配面）：

| 资源 | 触点 |
| --- | --- |
| `session_run_state` | `session-stream-unit-manager.service.ts:1117`（受理写 `starting`）、`:1288`（`RUN_STARTED` 写 `running`）、`:1439`（settle）、`run-state-writethrough.ts:102`（节流 upsert）；core 侧 `createSessionRunStateService(rt.conn)` 装配方 `novel-master-context.tsx:179` |
| `session_kkv` 域 `stream_metrics` | `session-stream-unit-manager.service.ts:1804`（末值速率 set）、`:1840`（delete）、`:1753`（水合读回） |
| KKV 模块 `nm-cloud-sync` | `cloud-sync-config.store.ts:13`（13 个键：endpoint/bucket/region/pathPrefix/accessKeyId/forcePathStyle/deviceId/deviceLabel + 5 个 last* 状态） |
| SKSP ref `cloud-sync/s3-secret-key` | `cloud-sync-config.store.ts:16` |
| KKV 模块 `nm-mobile-ui` | `app-ui-keys.ts:8`（主题 / 富文本 / 消息通知 / transcript 引擎 / 版本 epoch / 6 个 updates 键） |
| `chat_session.composer_draft_json` | `chat-composer-draft.ts:56-71`（仅 text+attach 序列化） |
| SKSP（provider / agent / search 凭证） | `create-mobile-runtime.ts:96-98` `createCompositeSecretStore(resolveSkspDriver('android'))` |
| `vfs_entry` / `vfs_revision` / `vfs_content_blob` | 经 `runtime.{global,project,session,physical}Vfs()` 与 `skills()` 间接（`vfs-operations.service.ts` / `vfs-zip.service.ts` / `vfs-character-card.service.ts`） |
| 维护 SQL | `db/connection.ts:111` `PRAGMA wal_checkpoint(FULL)`（export backup 前）；VACUUM/checkpoint 走 core `createDbMaintenanceService` |

**文件路径**（`db/db-file-path.ts:62-79`，候选按序探测，`probeAndCache` 取首个存在者）：
`{DocumentDir}/default/novel_master_vfs` → `{DocumentDir}/novel_master_vfs` →
`{DocumentDir}/novel_master_vfs.db` → `…/databases/novel_master_vfs[.db]`。
另有：`{CacheDir}/cloud-sync-export-{ts}.nmbackup` / `cloud-sync-import-{ts}.nmbackup`
（`cloud-sync.service.ts:171-172`）、`{CacheDir}/import-bytes-{ts}.nmbackup`
（`db-backup.service.ts:184`）、`{CacheDir}/{fileName}`（`document-io.ts:47`）、
`{dbPath}.nmbackup.bak`（`db-backup.service.ts:138`）。

## 依赖关系

**import 了谁**（workspace 包计数，按 import 路径去重）：
- `@novel-master/core` 及 17 个子路径（`/agent` `/chat` `/compaction` `/vfs` `/workplace`
  `/provider` `/prompt` `/events` `/kkv` `/session-kkv` `/format` `/session-run-state`
  `/message-checkpoint` `/session-fs` `/skills` `/sksp` `/common` `/feature-flags`）
  —— `create-mobile-runtime.ts:7-47` 是主要汇聚点。
- `@novel-master/tdbc-driver-op-sqlite/native`（`db/connection.ts:10`）、
  `@novel-master/sksp-android`（`:11`）、`@novel-master/tokenizer-driver-rn[/native|/encoding]`
  （`:12`、`chat-prompt-tokens.service.ts:27`、`stream-token-estimator.ts:51-54`）、
  `@novel-master/cloud-sync-driver-s3`（`cloud-sync.service.ts:20`）、
  `@aws-sdk/client-s3`（`@novel-master/cloud-sync-driver-s3` 的传递依赖）、
  `@notifee/react-native`（`agent-finished-notification.ts:15`）、
  `@react-native-documents/picker`、`react-native-blob-util`、`@noble/hashes`、
  `js-tiktoken/lite`、`buffer`、`@/shims/aws-rn-s3-client`。
- **宿主内依赖**：`runtime/agent-activity` ← `db-backup` / `db-maintenance` / `cloud-sync` /
  两个后台循环；`services/db-maintenance-busy` ← `db-backup` / `db-maintenance` / `cloud-sync`；
  `storage/app-ui-prefs` ← `runtime/novel-master-context`；`runtime/types` ← 几乎全部 services。

**被谁消费**（实测 `findstr` 全 `apps/mobile/src`）：
- `sessionStreamUnitManager`：ChatTabProvider、ChatTabScreen、useChatTabController、
  useChatTabScope、ChatSessionListPanel、SubagentSessionScreen。
- `runtime.workplace` / `sessionVfs` 等 VFS 工厂：工作区面板、文件管理器、DirectoryRuleSheet 等屏。
- `db/connection`：db-backup、runtime 工厂。
- `storage/*` 偏好：设置页、AboutScreen、ChatConfigScreen、transcript 引擎选择。

## 发现清单

### F-mobile-runtime-1 | P1 | apps/mobile/src/services/session-prompt-input.service.ts:28

```
/**
 * chip 刷新的中途弃权信号（2026-09-30 回滚竞态实锤）：回滚触发的刷新�?
 * run 注册�?~0.6s 跑，冻结窗��（只在防抖执行时判定，拦不到）。…
```

**描述**：本文件**已提交进 HEAD 的编码损坏**。实测（`node` 直接按 UTF-8 解码 + 统计
U+FFFD）：工作树与 `git show HEAD:` 的 blob 均含 **178 个 U+FFFD 替换字符**（全文 5525
字符，占 3.2%），全部落在中文注释/JSDoc 上。最近两次改动是 `acb4379e`（CR-r3 mobile 面）
与 `d3b1049a`（双端 build 接线组装中止）。
**建议**：① 先确认损坏是否只影响注释——是的，`ChatPromptBuildBailedError` 的类名/
错误文案/控制流均未受影响，**运行行为无损**；但这正是 RULE「PowerShell 管道改写 UTF-8
中文文件必毁编码」条目的又一次实锤，且已污染 main 与所有 worktree。② 用
`git log -p --follow` 找到损坏引入提交，重写该文件的注释（可用 `git show <commit>^:path`
拿到损坏前的版本对比，若之前是好的直接整体还原）。③ 在提交钩子里加一道
「非 ASCII 文件写回后 U+FFFD 计数 > 0 即拒绝」的门。
**置信**：confirmed（实测数字，且 HEAD blob 与工作树一致 → 已入库，不是本地脏文件）

> 跨区信号（供 reduce 参考，不计入本区）：同口径扫描全仓 3231 个 `.ts/.tsx/.md`（排除
> `node_modules/.git/dist/build/tmp`），含 U+FFFD 的共 **10 个文件**：
> `apps/mobile/src/services/session-prompt-input.service.ts`(178)、
> `packages/core/test/agent/agent-runner.test.ts`(64)、
> `packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts`(4)、
> `packages/core/test/chat/message-body-text.test.ts`(3)、
> `apps/desktop/src/main/ipc/handlers/vfs.ts`(2)、
> `docs/Iterations/mobile-chat-composer-annotate-ux/prd.md`(2)、
> `packages/core/src/infra/llm-protocol/logic/tool-definitions.ts`(1)、
> `packages/core/src/infra/sksp/impl/composite-secret-store.ts`(1)、
> `packages/core/src/infra/sksp/logic/ref-to-env.ts`(1)、
> `packages/core/src/infra/sksp/ports/secret-store.port.ts`(1)。
> 核心 `sksp/*` 与 `tool-definitions` 的那几处**可能是故意用 U+FFFD 当哨兵字符**，
> 需各区自行判定，不要按同一结论一刀切。

### F-mobile-runtime-2 | P1 | apps/mobile/src/services/session-stream-unit-manager.service.ts:717

```
export function forgetSession(sessionId: string): void {
  ...
  this.settledProjections.delete(sessionId);
  this.idleMessageViews.delete(sessionId);
```

**描述**：`forgetSession` 的 JSDoc 明写「**Step 6 会话删除链路调用**」，但
`findstr /S` 全 `apps/mobile/src` + `apps/mobile/test` 后，**除本文件自身外零调用方**
（其余命中全是本文件里的注释文字）。实际删除链路
（`screens/tabs/chat-tab/useChatTabScope.ts:521-541 handleDeleteSession` 与
`:564-589 deleteSelectedSessions`）只做了 `runtime.sessions.delete(id)` +
`clearSessionViewCache(...)`，**没有**调 `forgetSession`。后果：
1. `idleMessageViews` 里每个已删会话的**整份消息 tail 永久驻留内存**（`removeUnit`
   在宽限销毁/LRU/替换时都会把投影消息面交接进这里，无人回收）；
2. `settledProjections`（每会话一个 metrics 快照）无界增长；
3. `pendingChildParentByChild` 的子/父两侧条目残留（`forgetSession` 里的双向清理
   是唯一清理点，`clearPendingChildIndex` 只覆盖 value 侧）；
4. **已删会话的 hydrated `interrupted` 单元会继续被 LRU 保留，列表上仍显示「已中断」
   徽标**——`interruptedSessionIds()` 确有消费方
   (`ChatSessionListPanel.tsx:115-118`)，且只在单元被替换/LRU 淘汰（上限 8）后才消失。
**建议**：在 `handleDeleteSession` / `deleteSelectedSessions` 的成功分支补
`manager.forgetSession(id)`（与 `clearSessionViewCache` 并列）。项目删除
（`handleDeleteProjects:591-601`）同理可补一个 `forgetSessionsByProject`，或让
`forgetSession` 之外再加一个前缀清理口。
**置信**：confirmed（调用方检索为空 + 消费方 `interruptedSessionIds` 已确认存在）

### F-mobile-runtime-3 | P1 | apps/mobile/src/services/cloud-sync.service.ts:317

```
317:  acquireMobileDbMaintenanceBusy();
318:  let pullBusyHeld = true;
...
332:  const {coordinator, exportTempPath, importTempPath} = await createCoordinator(
333:    runtime, undefined, progress,
334:  );
338:  try {
...
366:  } finally {
367:    releasePullBusy();
```

**描述**：`pullCloudSync` 的互斥 acquire 写在 `try` **之外**，而 `createCoordinator`
（会读 KKV 配置、读 SKSP 里的 secret access key `buildS3StorageConfig`、
`createS3ObjectStorage`、`createRnS3Client`）是一次真实 await。任一环节抛错
（SKSP 读失败、SKSP 驱动异常、S3 client 构造失败）时，`try/finally` 从未进入，
`releasePullBusy()` 永不执行 → `db-maintenance-busy.ts:15` 的 `maintenanceBusyCount`
**永久 +1**。该计数是 `isMobileDbMaintenanceBusy()` 的唯一来源，被
`blob-binary-normalization.service.ts:50` 与 `message-content-compaction.service.ts:26`
两个后台循环用作让路守卫 → 一次云同步配置异常就让**消息正文压缩搬运 + blob 二进制归一
在本进程内永久停摆**（到下次冷启动才恢复），用户无任何提示。
`pushCloudSync` 无此问题（无外层 acquire，底层 `exportDatabaseBackupToPath` 自带
try/finally 配对）。
**建议**：把 `createCoordinator(...)` 移进 `try` 块（临时文件路径可在 try 内用
`let` 声明、finally 里判空 unlink），或用 try/finally 包住 acquire 与
createCoordinator 两段。补一条用例：注入 createCoordinator 抛错 → 断言
`isMobileDbMaintenanceBusy()` 回到 false。
**置信**：confirmed（逐行核对控制流；`db-maintenance-busy` 的两个消费方已定位）

### F-mobile-runtime-4 | P2 | apps/mobile/src/services/vfs-zip.service.ts:119

```
119:  return exportBytesViaDocumentPicker({
120:    fileName: zipName,
122:    write: tmpPath =>
123:      blobFs().writeFile(tmpPath, bytesToBase64(bytes), 'base64'),
124:  });
```

**描述**：同区 `db-backup.service.ts:37` 明写本条纪律——
「**大备份（数十～上百 MB）禁止整包读入 JS / base64 往返**」，并为此实现了
`writeBytesToFileChunked`（256KB 分块 + `writeStream`）。但 VFS ZIP 导出走的是
`zipSvc.export()` 返回完整 `Uint8Array` → `bytesToBase64()` 生成同量级 base64 字符串 →
**一次性 `writeFile`**，三段都在 JS 堆里；导入侧 `pickZipFileBytes`（`:128-145`）也
`pickAndReadBytes` 无 `maxBytes`（对比 `vfs-character-card.service.ts:32` 明确传了
`maxBytes: CHARACTER_CARD_MAX_INPUT_BYTES`）。导出整个工作区的大项目时，
峰值堆占用约为库体积的 2.4 倍（bytes + latin1 二进制串 + base64 串），Hermes 上有 OOM 风险。
**建议**：导出走 `writeStream` 分块（复用 `db-backup.service.ts:71-85` 的写法，把它提到
`rn-file-io.ts` 或 `document-io.ts` 共享）；导入侧补 `maxBytes` + `buildTooLargeError`。
**置信**：confirmed（同区自相矛盾的纪律 + 对照组齐全）

### F-mobile-runtime-5 | P2 | apps/mobile/src/services/session-prompt-input.service.ts:161

```
161:  const input = await buildPromptLlmInputFromLayout(resolved.prompts, ctx);
165:  return { definition: resolved, layout: resolved.prompts, ctx,
170:    input, rawMessages: visibleMessages };
```

**描述**：`SessionPromptInputBundle.input` 被算出来，但**两个消费方都不取**：
`chat-prompt-tokens.service.ts:139` 解构 `{definition, layout, ctx, rawMessages}`，
`prompt-preview.service.ts:66` 解构 `{layout, ctx}`。也就是说提示词 token chip 的每次
刷新都白白付一次完整的 prompt layout 序列化。而该文件自己的注释（`:70-71`）正是为了
治「build 挂钟 18.9s」而加了分段弃权与分段计时——白付的这段正落在耗时最长的路径上。
**建议**：把 `input` 改成懒 getter，或直接从 bundle 移除（core 的
`resolveCurrentPromptTokens` 走 `serializePromptLlmInput` 自行序列化，不依赖它）。
改动前先确认 core 侧没有通过该字段消费（本次只查了 mobile 侧）。
**置信**：confirmed（mobile 侧两处消费点已逐个核对）

### F-mobile-runtime-6 | P2 | apps/mobile/src/services/chat-prompt-tokens.service.ts:454

```
458:  const all = await runtime.messages.listBySession(scope.sessionId);
459:  const visible = all.filter(m => !m.hidden);
460:  const serialized = visible.map(...).join('\n\n');
463:  const count = countFallbackTokens(runtime, serialized);
...
468:    const {definition} = await buildSessionPromptInput(runtime, scope);
```

**描述**：这是 chip 链的**最坏路径兜底**——`loadChatTokenLabelWithFlag` 抛非 bail 错误时
回落于此。但它做了三件重活：(a) `listBySession` **不带任何 limit**，把整个会话历史
（含 hidden 行）拉进 JS；(b) 拼成一个巨大的 `role: body` 串再 `countTextWithDefaultEncoding`
（cl100k 整串编码，chat-prompt-tokens 的注释自己标了「~5.8s 级原生整串计数」）；
(c) 紧接着**再次调 `buildSessionPromptInput`** —— 而这正是刚刚失败的那个函数。
也就是说：build 失败时不是降级到「便宜的口径」，而是把 build 整条链再跑一遍外加
一次全量历史拉取。若失败原因是稳定性的（不是一次性的），这条兜底每次刷新都会踩。
**建议**：兜底路径只做 (a) 的**有界**读取（`listBySessionTail(sessionId, {limit: 200})`）+
(b)；模型标签的解析改成复用上一次成功的 `savedModelId`（缓存一个 ref），不重调
`buildSessionPromptInput`。
**置信**：confirmed

### F-mobile-runtime-7 | P2 | apps/mobile/src/services/snapshot-file-hash.ts:20

```
21:  const stream = await ReactNativeBlobUtil.fs.readStream(path, 'base64', CHUNK_SIZE);
27:  await new Promise<void>((resolve, reject) => {
28:    stream.open();
...
39:    stream.onEnd(() => resolve());
40:  });
42:  return bytesToHex(hasher.digest());
```

**描述**：`readStream` 打开的原生读流在 `onEnd` 后**没有 `stream.close()`**
（也没有 `finally`）。同区 `db-backup.service.ts:75-84` 的 `writeStream` 就老老实实
`try/finally { await stream.close() }`。每次云同步 push/pull 至少泄漏一个文件描述符，
长期使用会撞 fd 上限。
**建议**：`try { … } finally { await stream.close().catch(() => undefined) }`。
**置信**：confirmed（对照同区 `writeStream` 的 close 写法）

### F-mobile-runtime-8 | P3 | apps/mobile/src/services/snapshot-complete-signal.ts:52

```
52:        const timer = setTimeout(() => {
53:          if (waiting != null) { waiting = null; resolve('timeout'); }
56:        }, timeoutMs);
58:        waiting = () => { clearTimeout(timer); resolve('signaled'); };
```

**描述**：`waiting` 是**单槽**。若两个 `consumeNext` 并发进入，第二次会覆盖 `waiting`：
第一个等待者的 `resolve` 被丢弃且其定时器只会在 `waiting != null`（指向第二个）时
触发 → **第二个被错判为 'timeout'，第一个的 promise 永不 settle**（永久悬挂）。
当前唯一消费方 `screens/tabs/chat-tab/useChatTabController.ts:23` 是单例 ref + 单条
回滚链，暂不触发；属埋雷而非活 bug。
**建议**：改成 `Set<() => void>` 等待者集合，`notify()` 全部放行；或在文档注释里
写死「同一信号盒不得并发消费」并在类型上体现。
**置信**：suspected（并发形态未在当前 UI 触发，但控制流缺陷已逐行确认）

### F-mobile-runtime-9 | P3 | apps/mobile/src/services/blob-binary-normalization.service.ts:111

```
111:  if (scheduledRuntime === runtime) { return; }
113:  scheduledRuntime = runtime;
115:  void runNormalizationLoop(runtime);
```

**描述**：sibling `message-content-compaction.service.ts:93-99` 做了条件复位
（循环收手时 `if (scheduledRuntime === runtime) scheduledRuntime = undefined`），
本文件**没有**——循环无论正常 done、stalled 还是抛错收手，`scheduledRuntime` 都永久
留在该 runtime 上。若将来补一条「同一 runtime 再次挂载」的路径（例如 UI 手动重试
归一），会静默 no-op。
**建议**：与 sibling 对齐加 `.finally()` 条件复位。
**置信**：confirmed（对照 sibling 实现）

### F-mobile-runtime-10 | P3 | 多处模块级 Map 永不按会话清理

`chat-prompt-tokens.service.ts:230` `preciseUpgradeInflight` / `:247` `preciseUpgradeQueued` /
`:256` `sessionRefreshGen`；`agent-finished-notification.ts:35` `lastFailedNotifyAt`。
**描述**：这四个模块级 Map 以 sessionId 为键，会话删除时无任何清理点
（`forgetSession` 也没覆盖它们，见 F-2）。体量小（每会话一个数字/一个时间戳），
不是真泄漏，但与 F-2 同源——会话生命周期与这些缓存没有任何联动。
**建议**：随 F-2 一起，在会话删除链路上补统一清理；或给这几个 Map 加上限 +
LRU（`scope-key-cache.ts` 已有现成工厂）。
**置信**：confirmed

### F-mobile-runtime-11 | P3 | apps/mobile/src/services/agent-create.ts:34

```
34:  id = `agent-${Date.now()}`,
```

**描述**：agentId 用毫秒时间戳生成，同一毫秒内连建两个会撞 id（`upsert` 静默覆盖前一个，
用户丢配置）。`cloud-sync-config.store.ts:118` 的 `generateCloudSyncDeviceId()` 就是
正例（UUID v4 + 手写 hex 回退）。
**建议**：改 `crypto.randomUUID()`（`generateCloudSyncDeviceId` 已有可直接复用的回退实现）。
**置信**：confirmed（代码形态；未构造真机复现，撞车概率低）

### F-mobile-runtime-12 | P3 | apps/mobile/src/db/connection.ts:96

```
92:      conn = c;
93:      return c;
94:    })();
95:  }
96:  return initPromise;
```

**描述**：`initPromise` 只在 `closeMobileConnection()`（`:104`）里清空。`open` 或
`bootstrap` 抛错时它保留为一个**已 reject 的 promise**，此后任何 `getMobileConnection()`
调用都直接复用同一个 rejection。目前 boot 失败会走错误屏 + `retry()`
（`novel-master-context.tsx:153-155` 递增 `bootToken` → effect 重跑 → `bootToken > 0`
分支调 `closeMobileConnection()` 复位），所以实际可自愈；但 `db-backup.service.ts:140`
的 `importDatabaseBackupFromPath` 在导入链里直接 `await getMobileConnection()`，
若该 promise 已 reject 会拿到「上一次 boot 的错误」而不是新错误，误导排障。
**建议**：`initPromise` 加 `.catch` 分支复位（`initPromise = undefined` 后 rethrow），
与 `conn` 的生命周期对齐。
**置信**：confirmed

### F-mobile-runtime-13 | P3 | apps/mobile/src/runtime/create-mobile-runtime.ts:149

```
149:  setTimeout(() => {
150:    ensureLlmFetchConfigured();
151:  }, 0);
```

**描述**：LLM 传输注册被推迟到下一个宏任务。`setup-llm-fetch.ts:24` 的 `configured`
是进程级单向闩，一旦 `createMobileNovelMasterRuntime()` 被并发调用两次（retry 时序
极端或未来多 runtime 场景），第一次已在途、第二次直接 return，不会补注册。
当前只有单一 boot 路径，实际无碍。
**建议**：直接在 return 之前同步调用（`ensureLlmFetchConfigured` 本身无 await，
defer 的收益仅是避开当前栈帧）；或让 `createMobileNovelMasterRuntime` 内部先同步调用。
**置信**：confirmed（形态）；影响面小

### F-mobile-runtime-14 | P3 | apps/mobile/src/services/session-stream-unit-manager.service.ts:1972

```
1971:    this.settledProjections.clear();
1972:    this.notifyChanged();
1973:    this.listeners.clear();
```

**描述**：`dispose()` 末尾先 `notifyChanged()`（会遍历 `listeners` 逐个调用）、
后 `listeners.clear()`。dispose 期间 React 树可能已在卸载，订阅者回调会打到半死状态上；
而 `notifyChanged` 内还会跑一次 `listCalibratableSessionIds()` 全表遍历（此时
`calibrationProbe` 已置 undefined，无害但白跑）。顺序反了。
**建议**：把 `this.listeners.clear()` 提到 `notifyChanged()` 之前。
**置信**：confirmed

### F-mobile-runtime-15 | P3 | apps/mobile/src/services/document-io.ts:47

```
47:  const tmpPath = `${fs.dirs.CacheDir}/${options.fileName}`;
```

**描述**：临时文件名**不含随机/时间戳**，直接用 `options.fileName`。
`db-backup.service.ts:40` 固定传 `nmbackup.db`、`yaml-shared.ts:28` 传
`${agentId}.agent.yaml`、`smart-sort-rule-yaml.service.ts:17` 传
`smart-sort-rules.yaml`。两个并发导出（用户快速连点、或同名的两个 agent 导出）会写同一
个临时文件 → 内容互相覆盖 / 对方 finally 提前 unlink。同区的云同步临时文件就正确用了
`Date.now()` 后缀（`cloud-sync.service.ts:171`）。
**建议**：`tmpPath` 加 `-${Date.now()}` 后缀（`saveDocuments` 的 `fileName` 仍传
原始名，不影响用户看到的文件名）。
**置信**：confirmed

### F-mobile-runtime-16 | P3 | apps/mobile/src/storage/chat-composer-draft.ts:18

```
18:  const bySession = new Map<string, ChatComposerDraft>();
```

**描述**：进程级草稿 Map 无上限、无删除链路清理（`clearChatComposerDraft` 只在发送成功时
调，见 `components/chat/ChatComposer.tsx:341`）。会话删除后其草稿正文长期驻留。
对比同族的 `chat-session-view-cache.ts` / `chat-list-scroll-cache.ts` /
`chat-transcript-scroll-cache.ts` 三个都接了 `createScopeKeyCache`（有 LRU 上限 500
+ `clearByProjectPrefix`）并被删除链路调用——composer 草稿是唯一的例外。
**建议**：改用 `createScopeKeyCache<ChatComposerDraft>`，并在 `handleDeleteSession` /
`handleDeleteProjects` 里补清理。
**置信**：confirmed

### F-mobile-runtime-17 | P3 | apps/mobile/src/db/connection.ts:20

```
19: export {
20:   getMobileDatabaseFilePath,
21:   probeAndCacheMobileDatabaseFilePath,
22: } from './db-file-path';
```

**描述**：`getMobileDatabaseFilePath()`（同步版、取缓存或兜底）在本仓**零消费方**——
所有实际读路径都走 `resolveMobileDatabaseFilePath()`（async，会探盘）或
`probeAndCacheMobileDatabaseFilePath()`（`db/connection.ts:91` bootstrap 时调）。
它只在 `db-file-path.ts:111` 定义处出现。
**建议**：删掉这个 re-export 与函数定义，或标注为测试专用并挪到 test 侧。
**置信**：confirmed（findstr 全 src 无消费方）

### F-mobile-runtime-18 | P3 | apps/mobile/src/services/session-stream-unit-manager.service.ts:1922

```
1922:    const calibratableCount = this.listCalibratableSessionIds().length;
1923:    this.calibrationProbe?.setPollingEnabled(calibratableCount > 0);
```

**描述**：`notifyChanged` 是运行中单元的 64ms 节拍总线，每次都全量遍历 `units`
构造一个临时数组。当前单元数 ≤ 8（LRU 上限）+ 活跃数，代价可忽略；但这是
「状态变化总线上挂 O(units) 计算」的形态，单元数若将来上调需要留意。
**建议**：不必改。若要省，`setPollingEnabled` 本身幂等，可在计数不变时早退。
**置信**：confirmed（形态）；当前无实际性能影响

## 争议与存疑

1. **`settledProjections` 与「上次生成」的持久层归属（F-2 相关，暂不单列）**：
   `session_run_state` 的 settled 行由 core 的会话删除事务联动清理，manager 的
   内存投影靠 `forgetSession`——而后者无调用方。我倾向按 F-2 判 P1（内存驻留 +
   错误徽标是两个可观测症状），但如果 reduce 认为「徽标最多多挂到 LRU 淘汰（≤8 个）」
   可降级为 P2。**我不抹平这个分歧，交 reduce 裁决。**

2. **`hydrateFromRunState` 的 `startedAtMs` 可能为 0（未单列）**：
   `session-stream-unit-manager.service.ts:1117-1131` 的受理写入
   `{runId:'', status:'starting', startedAtMs: 0}`。若 run 在 `RUN_STARTED` 到达前
   被杀，重启水合会造出 `startedAtMs = 0` 的 interrupted 单元，
   `settledProjections.elapsedMs = Math.max(0, updatedAtMs - 0) = updatedAtMs`
   （一个巨大的假历时）。但该单元走的是 `adoptInterruptedUnit` 分支，**不写
   settled 投影**（`:1414` 的 consumptive 分支才写，且 consumptive 与水合互斥），
   所以假历时只停留在 `snapshot().elapsedMs`（active 态语义为 null，水合单元是
   settled(interrupted)，`settleAsInterrupted` 不设 `elapsedMsValue` → 仍为 null）。
   **结论：实际不可观测，判为无须修**，记此以免后续 agent 重复排查。

3. **`starting` 单元在 finally 兜底路径不留 settled 行（未单列）**：
   `startRun` 的 `.finally`（`:1189-1221`）直接 `removeUnit`，不写 settled 行；
   该路径触发的条件是「事件与 .then 双双失手」，行会停留在 `starting`，
   下次重启水合识别为中断现场。manager 注释（`:1208-1216`）只解释了 UI 侧为何看不到
   收尾痕迹，没解释持久层行会留 `starting`。判为**可接受**（重启后显示「已中断」
   符合事实），但严格说与「settle 才是唯一收口口径」有出入。记为存疑，不单列。

4. **`chat-prompt-tokens.service.ts` 的两个 Map 计数配对表（`:393-402`）**：
   注释写死了 `begin/end` 的四格配对关系，并称「任何一侧漏掉配对都会让计数卡住」。
   我核对了本区两侧：`compaction-warm-orchestration.service.ts:72/98` 与
   `chat-prompt-tokens.service.ts:441/449` 配对正确，计数 1→2→1→0 成立。
   **判 intentional**（注释即规格），但这是跨文件的手工不变量、无编译期保障，
   建议后续在 W3 的一致性扫描里单列一条。

5. **跨区边界**：`screens/**` 下的 `useChatTabScope` / `ChatTabProvider` /
   `useChatTabMessageActions` / `SessionDetailScreen` 是本区 API 的主要消费方，
   按域划分属别的机位。本报告只在取证时定点读了 `useChatTabScope.ts:505-604`，
   未系统扫描，不对其质量作判断。

## 附：本区「刻意如此」清单（intentional，不计问题）

| 项 | 出处 | 判定理由 |
| --- | --- | --- |
| `db-file-path.ts:38-79` 保留 quick-sqlite 旧布局候选（`{base}/default/...`） | RULE「TDBC 驱动层」 | quick-sqlite 是保留的回滚线，回滚即需按旧布局定位库文件 |
| `blob-binary-normalization.service.ts` / `message-content-compaction.service.ts` 两个后台循环 | RULE「schema migration 清理有约定节奏」 | 谓词驱动后台任务，约定约 10 个 tag 后随迁移退役；现在是生命周期内 |
| 全区无 zstd/brotli/wasm 依赖 | RULE「移动端 Hermes 没有 WebAssembly」 | 实测 `findstr` 零命中；纯 JS / deflate 系，符合约束 |
| `fill-policy-mobile.ts:10` `full → hidden` 映射 | 目录规则 fillPolicy 旧值兼容 | 归一函数带 fallback，非破坏性 |
| `chat-composer-draft.ts:165` 仍过滤 `user_ops` source | RULE「user ops（已拆除）」 | 展示层丢弃遗留历史附件，新代码不写该 source；保留过滤是对的 |
| `agent-finished-notification.ts:505-534` 模块级 `registerForegroundService` / `onBackgroundEvent` / `AppState` 注册 | 进程生命周期语义 | notifee 后台事件只能模块级注册一次（注释已说明 9.x 无退订函数） |
| `session-stream-unit-manager.service.ts:1592-1606` LRU 淘汰按 `settledAtMs` 排序 | — | 水合单元用行的 `updated_at_ms` 近似，注释已说明「保证多次重启不刷新 LRU 新旧序」 |
| `agent-run.service.ts:25` `mapResolveError` 把 `AgentRunResolveError` 包成 `AgentTurnError` | — | 面向 UI 的错误归一，有意为之 |
