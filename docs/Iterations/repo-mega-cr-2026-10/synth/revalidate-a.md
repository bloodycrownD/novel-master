# W10 台账重验 · 代理 A（P0 + cloudsync P1 + core-storage P1）

> 重验基线：`main@fe79b781`（v1.5.29 全库明文化 + read/skill 引用化）
> 原台账基线：`main@9ca5f5ad`
> 覆盖范围：P0 终表 3 条 + cloudsync 簇 P1 全部 7 条 + core-storage 簇 P1 全部 11 条 = **21 条**
> 纪律：只读。零 git 写、零 `docs/apm/` 写、零生产代码改动。

## 0 · 口径与统计

| verdict | 条数 | ID |
|---|---:|---|
| **valid**（病灶仍在） | 20 | S-CS-01 / RT-02 / S-CS-02 / S-CS-03 / S-CS-04 / S-CS-07 / S-CS-08 / S-CS-09 / S-CS-16 / CS-01 ~ CS-11（11 条） |
| **partial**（部分修） | 1 | RT-01 |
| **fixed** | 0 | — |
| **stale** | 0 | — |

新基线与旧基线之间、**本轮 21 条所涉目录的全部提交**：

| commit | 触及面 | 对本轮条目影响 |
|---|---|---|
| `e2d10b3f` perf(core): agent 每步读收窄 | `chat-agent-session.ts` / `agent-runner.ts` / `assemble-agent-runner-deps.ts` | **唯一改动本轮条目的代码提交** ⇒ RT-01 由 valid 转 partial |
| `c3c1dee9` feat(core): 消息写侧明文化 + 压缩缓存层清理 | `sqlite-message.repository.ts` 等 | 改写 CS-11 的**修法前提**（blob 列恒 NULL），病灶本身未动 |
| `15280e0f` / `85abb7eb` / `37795af5` 等 | bootstrap 部分索引 / batchInsert 分片 / read 引用计数 | 触及 `batchInsert` 分片实现，不改本轮任一条病灶 |

cloudsync 簇（`apps/*/cloud-sync.service.ts`、`cloud-sync-coordinator.ts`、`db-backup.service.ts`、`cloud-sync-driver-s3`）在 `9ca5f5ad..fe79b781` 区间内**零提交**——七条 P1 一字未改。

---

## 1 · P0 终表（3 条）

### S-CS-01 · cloudsync · **valid**

pull 成功后 rev 记账写进一条已被 pull 自己关掉的连接，链路完全闭合。

- 记账点仍在原处：`apps/desktop/src/main/services/cloud-sync.service.ts:255-256`（`setLastSyncedRev` + `recordPull`），紧跟在 `:252` 的 `coordinator.pull(...)` 之后。
- 连接确已被 pull 关掉：`cloud-sync.service.ts:407` 的 `importSnapshotFromPath` → `apps/desktop/src/main/services/db-backup.service.ts:99-133`，其中 `:115` `await closeLiveDbForBackupImport()`。
- 死句柄的来源确在构造期：`cloud-sync.service.ts:159-164` 构造函数里 `createCloudSyncConfigStore(runtime.kkv, runtime.secretStore)`，`this.runtime` 是**当时**那一份；rebootstrap 换掉 runtime 后 `this.configStore` 不变。
- 记账仍发生在 rebootstrap **之前**：`apps/desktop/src/main/ipc/handlers/cloud-sync.ts:88-91`（`await service.pull()` → `await rebootstrapDesktopRuntime()`）。
- mobile 侧同构：`apps/mobile/src/services/cloud-sync.service.ts:341` 记账、`:346` 才 `onRebootstrap()`。

区间内该文件零提交。**判 valid，维持 P0。**

### RT-01 · core-runtime · **partial**

台账原病灶是「gemini 协议下每 step 一次全会话全量读（21 列、含 hidden、无 `includeHidden:false`）」。`e2d10b3f` 修掉了其中「含 hidden」这一半，另一半仍在。

已修（`e2d10b3f`）：
- `packages/core/src/service/agent/impl/chat-agent-session.ts:31-39` — `list()` 由「全量读 + 内存 `filter(!hidden)`」改为 `listBySession(id, { includeHidden: false })`，SQL 层 `AND hidden = 0`。
- `packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts:68-78` — `listAllSessionMessages` 改名 `listVisibleSessionMessages`，同样传 `includeHidden: false`。
- `packages/core/src/service/agent/impl/agent-runner.ts:605` 消费点同步。
- 附带收益：`visible-floor.trigger.ts:21` 的第二次读也随之不再解压 hidden 行。

**仍在**（新基线证据）：
- `agent-runner.ts:604-606` — 每个 gemini step 仍**独立发一次** `listVisibleSessionMessages()`，无进程内 memo、无失效点。
- 仍是全列读：`sqlite-message.repository.ts:28` 的 `MESSAGE_SELECT_COLUMNS` 21 列（含 `raw_json` / `attachments_json` / `content_json`），没有窄读口。
- 消费方仍只要 `tool_use` 的 `id`/`name`：`packages/core/src/infra/llm-protocol/logic/gemini-content-mapper.ts:54` `buildToolUseLookup`、`:339` 调用点——口径未变。
- 「覆盖 hidden 是有意的」这句台账备注**已过时**：新基线下 hidden 行不再进这条读路径，该注记应删。

**判 partial。** 危害量级从「全量（含压缩产物，通常是 hidden 占多数）」缩到「可见集全列」，实测口径见 `e2d10b3f` commit message（每步两发 368.2→23.9ms）。**建议 P0 → P2**：残余是纯性能债，无正确性风险，且已有 93.5% 的一次性收益落袋。

### RT-02 · core-runtime · **valid**

每 step 两次独立全会话读，双双在位。

- 第一次：`agent-runner.ts:413` `let visible = await session.list();`（在 `:406` 的 `for (let step = ...)` 体内）。
- 第二次：`agent-runner.ts:519` `await this.deps.compactionConditions.shouldRequestCompaction(...)` → `packages/core/src/service/compaction-conditions/create-compaction-condition-evaluator.ts:71` `parts.push(new VisibleFloorTrigger(conditions.visibleFloor))` → `packages/core/src/domain/compaction-conditions/triggers/visible-floor.trigger.ts:21` `const visible = await session.list();`。
- 两次读无任何共享：`:413` 的结果没有被传给触发器，触发器入参签名 `shouldTrigger(session, _evaluation)` 第二参在本就未被使用（触发器入参改传条数的修法依然零成本成立）。

行号相对旧基线整体下移（`:405`→`:413`、`:506`→`:519`），病灶形状一字未改。**判 valid，维持 P0。**

---

## 2 · cloudsync 簇 P1（7 条）

区间内该簇**零提交**，七条逐条重读确认如下。

| ID | verdict | 新基线证据 | 备注 |
|---|---|---|---|
| **S-CS-02** | valid | `apps/desktop/src/main/services/cloud-sync.service.ts:432-443` 模块级 `let service` + `getDesktopCloudSyncService()` 只在 `!service` 时构造，**无 `invalidateCloudSyncService`**（全仓 grep 零命中）；`:159-164` 构造期绑 `runtime.kkv`；`:378` `const runtime = this.runtime` 被 `dbSync` 三个闭包（`:391/:397/:404`）捕获——**第二个死句柄仍在** | 维持 P1 |
| **S-CS-03** | valid | `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts:143-182` 的 `pull()`：`assertConfigured()` 之后直接 `readRemoteStatus()`，**无 `isAgentActive()` 入口检查**；`:168` `importSnapshotFromPath` 之前**无二次复检**；`push()`（`:185-195`）只持进程内互斥，pull 不与之共享 | 暴露面收窄口径不变：desktop pull↔push 被 `syncBusy` 挡住，暴露面仍是 mobile pull↔push + 两端 pull↔agent |
| **S-CS-04** | valid | `apps/mobile/src/services/cloud-sync.service.ts:317` `acquireMobileDbMaintenanceBusy()` → `:332-336` `createCoordinator(...)` **在 `:338` 的 `try` 之外** → 若注入/配置构造抛错，`:318-324` 的 `pullBusyHeld` 复位与 `finally` 的 `unlink` 双双进不去，`isMobileDbMaintenanceBusy()` 永久 true | 结构体逐字吻合 |
| **S-CS-07** | valid | `apps/desktop/src/main/services/db-backup.service.ts:114`（bak 拷贝吞错）、`:125`（回滚拷贝吞错）、`:128`（bak 删除吞错）三处 `.catch(() => undefined)` 全在位；`:99-133` / `:141-` 的 `importDatabaseBackupFrom*` 结构未变 | **仍是本簇唯一不可逆本地数据丢失面**，Wave B 优先级不动 |
| **S-CS-08** | valid | `packages/cloud-sync-driver-s3/src/create-s3-object-storage.ts:225-228` `putFile` 仍 `const body = new Uint8Array(raw); return storage.put(key, body, options);` | 文件已从 `src/impl/` 移到 `src/`（打包路径变化），台账位置需更新 |
| **S-CS-09** | valid | `cloud-sync-coordinator.ts:297-304`：条件写失败 → `readRemoteStatus()` 只取 `etag` 重读 → `conditionalPutStatus(finalStatus, rereadEtag)` 无条件覆盖 rev；`:249` 的 `nextRev = remote.rev + 1` 仍是首次读到的值 | 一字未改 |
| **S-CS-16** | valid | desktop：handler `cloud-sync.ts:88-91` 仍是 `pull()` 后才 `rebootstrapDesktopRuntime()`；mobile：`cloud-sync.service.ts:341` 记账、`:346` `onRebootstrap()` | 派生项（mobile `patchCloudSyncLocalStatus` 未兜错会覆盖原始错误，`cloud-sync.service.ts:341`）仍在，建议 P2 不变 |

七条全部 **valid**，无一因明文化而改变前提。

---

## 3 · core-storage 簇 P1（11 条）

| ID | verdict | 新基线证据 | 备注 |
|---|---|---|---|
| **CS-01** | valid | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:935-938` 仍是 `SET path = REPLACE(path, #{oldWithSlash}, #{newWithSlash})` + `LIKE #{pattern} ESCAPE '\'`；`:947-953` 根行单独 UPDATE 仍在 | 一字未改 |
| **CS-02** | valid | 病灶点 `packages/core/src/domain/vfs/logic/compute-replace-result.ts:53-60` 的 `while(true) { idx = indexOf(normalizedOld, searchFrom); ... searchFrom = idx + normalizedOld.length; }` 仍在，**`oldString.length === 0` 无守卫**（空串时 `indexOf("")` 返回 `searchFrom` 恒等 ⇒ 死循环）。两条 zod 入口仍无 `.min(1)`：`domain/tool/builtin/vfs-tools.ts:339-343`（`z.string().describe(...)`，`path` 在 `:338` 有 `.min(1)`）、`domain/tool/builtin/skill-tool.ts:341`（`z.string().optional()`，调用点 `:547` `requiredField(input.oldString, ...)` 只判 undefined） | 入口数修正为 2 仍成立 |
| **CS-03** | valid | `packages/core/src/domain/vfs/logic/longest-common-substring.ts:140-142` 仍 `Array.from({length: rows}, () => Array<number>(cols).fill(0))` 全矩阵；`:164` 仍 `Math.min(...endsInB)`；`compute-replace-not-found-error.ts:55` 仍逐调 `longestCommonSubstring` | 行号相对旧基线整体下移约 +88（文件头部注释扩充），机制未变 |
| **CS-04** | valid | `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts:397-410` 顺序仍是 `decrementLiveRefsUnderScope` → `:404` `deleteVfsPrefix` → `:405` `deleteUnreferencedUnderScope` | 一字未改 |
| **CS-05** | valid | 三站点结构均在位：`service/vfs/impl/vfs-zip-io.service.ts:199-244`（单事务内 delete-prefix + 逐文件 `insertFileSeedingRevision` + `:233-243` `backfillBaselineCheckpoints` 在事务内）；`service/vfs/impl/character-card-import.service.ts:140-182`（同构 + `:171-181` backfill 在事务内）；`service/vfs/impl/vfs-batch-io.service.ts:351-367`（单事务遍历 `plan.writes`，**无条数/体积闸门**） | W6 补的「batch-ingest 无闸门」在位 |
| **CS-06** | valid | `vfs-batch-io.service.ts:167-185` `writeOrUpdateFile` 仍直接 `repo.insert` / `repo.update`，不写 `vfs_revision`（`:183-184` 注释仍自述该权衡）；desktop `apps/desktop/src/main/services/vfs-batch.service.ts:210-226` 分叉仍在（`:210` feature-flag 分流 → `applyBatchIngestWithWriter` vs `:220` `applyBatchIngest`） | 直接生产 CS-07 前置态的因果未变 |
| **CS-07** | valid | `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts:44-54` 的 DELETE 触发器仍是 `UPDATE ... ref_count - 1` + `DELETE FROM vfs_content_blob WHERE content_hash = OLD.content_hash AND ref_count <= 0`，**无 `AND NOT EXISTS (SELECT 1 FROM vfs_entry ...)`** | 仍须排在 CS-06 之后 |
| **CS-08** | valid | `vfs-batch-io.service.ts:399-406` 文件分支仍 `const fileRel = basenameOf(logical)`；对照目录分支 `:412` / `:426` 两处 `exportRelativePath(childLogical, logical, selectionCount)`（定义在 `:164-169`）——结构体逐字吻合 | `BatchExportPlan` 仍无 `skipped` 通道 |
| **CS-09** | valid | 解析器内仍无累加：`packages/core/src/domain/vfs/logic/vfs-zip-central-dir.ts:188-243` 的 `for (let i = 0; i < totalEntries; i++)` 循环里逐条 `readLocalEntryData` → `:85-115` `decompressEntryData`（`:101` `inflateSync`），**`totalEntries` / `uncompressedSize` 都不累加**；现存的闸门全在解析**之后**的 `domain/vfs/logic/vfs-zip-validate.ts:196-207`（`VFS_ZIP_MAX_ENTRY_COUNT` / `VFS_ZIP_MAX_UNCOMPRESSED_BYTES`，即 `vfs-zip-io.service.ts:189-192` 的调用点），炸弹已在解析期展开完；`domain/skills/logic/preview-skill-zip.ts:35` 仍是裸 `parseVfsZip(zipBytes)` 无任何预检 | 「炸弹路径只在 DEFLATE 分支」这一限定仍成立（STORE 分支 `:92-98` 有长度等值断言） |
| **CS-10** | valid | `packages/core/src/infra/sql-template/parser.ts:45-55` `TemplateParser.astCache = new Map<string, AstNode[]>()` 仍**无界无 LRU**（`:42-43` 注释仍自述「模板字符串通常数量有限，缓存增长可控，不需要 LRU」）；真凶三方法仍无分片封顶：`domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts:112-130` `countCheckpointsForMessages`、`:366-386` `listFilePointersForMessages`、`:390-400` `deleteCheckpointsForMessages`，三处都是 `messageIds.map((_, i) => '#{id' + i + '}')` 拼进单条 `IN (...)` | 动态 arity 无界这一点未变 |
| **CS-11** | valid（**修法前提已被明文化改写**） | 病灶点全在位：`service/chat/impl/session.service.ts:388` `const messages = await r.messages.listBySession(source.id);`（copy，全列读）→ `:396` `batchInsert(copyMessages)`；`service/chat/impl/message.service.ts:320` `const all = await this.deps.messages.listBySession(sessionId);` → `:330` 事务内 `all.filter(m => m.seq <= upTo.seq)`（fork） | **见 §5「需改写的修法」** |

CS-11 的额外证据：`domain/chat/repositories/impl/sqlite-message.repository.ts:447-473` 的 `batchInsert` 已被 `85abb7eb` 改成**按 200 条分片 + 按片下发**（`BATCH_PARAM_BUILD_CHUNK = 200`），峰值内存已收敛；但 `:52-60` 的 `toMessageParams` 在明文化后固定写 `JSON.stringify(message.content)` + `content_encoding`/`content_blob` 恒 `NULL`，**分片只解决了 SQL 参数个数，没解决「全量物化正文 + 逐条重新 stringify」**。

---

## 4 · 明文化（v1.5.29）对本轮条目的前提影响

台账提示「明文化可能已改变消息读路径与压缩相关条目的前提」。逐条核下来，影响集中在三处，其余 18 条前提不变。

1. **RT-01 的备注作废**。台账原文「有意的是『覆盖 hidden』，不是『全量读』」——新基线下 `e2d10b3f` 已把 hidden 排除出这条读路径，这条「有意覆盖」的论据不再成立，RT-01 的残留问题被干净收敛成「可见集全列 + 无 memo」。

2. **CS-11 的修法作废（必须改写）**。台账原修法之一是「让 `batchInsert` 走 `INSERT...SELECT` 直复 blob 列」。明文化后 `chat_message.content_blob` 在生产写入路径上**恒为 NULL**（`sqlite-message.repository.ts:52-60` 与 `:46-48` 的注释明写「写侧一律明文」），blob 直复这条路已经没有对象可复。修法应改为：copy 走 `listMessageHeadersBySession` + 事务外取 body 段，或让 copy 走 `INSERT ... SELECT` 直复 `content_json`（明文列）而非 blob 列。

3. **RT-02 的收益重估**。两次读现在都走 `includeHidden: false` 的 SQL 过滤，不再解压 hidden 行，单次读的成本比旧基线低。但「两次独立读、互不共享」的结构性病灶未变，`VisibleFloorTrigger` 依然在 `:21` 自己发一次。修法（触发器入参改传 `:413` 已拿到的 `visible.length`）依旧零新增接口、零语义风险。

其余 18 条（cloudsync 全部 7 条 + core-storage 除 CS-11 外 10 条 + RT-02）不触碰消息正文存储层，前提完全不变。

---

## 5 · 需降级 / 升级 / 改写的建议

| ID | 建议 | 理由 |
|---|---|---|
| **RT-01** | **P0 → P2** | 「含 hidden、无 `includeHidden:false`」这半边已被 `e2d10b3f` 修掉并实测 −93.5%；残留的「可见集全列 + 无 memo」是纯性能债，无正确性风险，不配 P0 |
| **CS-11** | 维持 P1，**但修法必须改写** | 原修法「`batchInsert` 走 `INSERT...SELECT` 直复 blob 列」的对象已不存在（blob 恒 NULL）；改为直复 `content_json`，或走 header 投影 + 事务外取 body |
| **S-CS-08** | 维持 P1，**台账位置需更新** | 文件已从 `packages/cloud-sync-driver-s3/src/impl/` 移到 `packages/cloud-sync-driver-s3/src/`（打包布局变化），病灶行 `:225-228` 不变 |
| **CS-03** | 维持 P1，**台账行号需更新** | `longest-common-substring.ts` 因头部注释扩充整体下移约 +88 行；病灶在 `:140-142` 与 `:164` |
| **S-CS-01 / RT-02** | 维持 P0 | 两条均 valid，无任何缓解措施落地 |
| **S-CS-07** | 维持 P1 且**在 Wave B 内优先级最高** | 本簇唯一不可逆本地数据丢失面，未被任何提交触及 |

Wave 提案层面，本轮 21 条**没有一条可以从既有波次里划掉**；唯一变化是 RT-01 从 Wave A/C 的性能改造队列移出、降为 P2 观察项。