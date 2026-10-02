---
zone: w8-ds-kkvstore-a
agent: 独立双扫 A（domain-survey schema 全量测绘）
files_scanned: 12（zone 内 git 跟踪文件全量）
---

# w8 · session-kkv + infra/kkv + infra/db-maintenance

覆盖目录（`git ls-files` 实测，共 12 个文件 / 2435 行）：

```
packages/core/src/domain/session-kkv/logic/deferred-file-cache-gc.ts        (42)
packages/core/src/domain/session-kkv/logic/file-cache-blob-codec.ts        (85)
packages/core/src/domain/session-kkv/model/session-kkv-domains.ts         (144)
packages/core/src/domain/session-kkv/model/session-kkv-entry.ts            (13)
packages/core/src/domain/session-kkv/repositories/session-kkv.port.ts      (45)
packages/core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts (499)
packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts               (21)
packages/core/src/infra/db-maintenance/db-maintenance.port.ts               (55)
packages/core/src/infra/db-maintenance/index.ts                             (46)
packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts      (142)
packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts   (793)
packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts  (550)
```

区外为确证结论而读取的消费方/邻接文件（不计入 files_scanned）：`bootstrap/session-kkv/file-cache-schema.ts`、`bootstrap/session-kkv/session-kkv-schema.ts`、`bootstrap/novel-master-bootstrap.ts`、`bootstrap/schema-migrations/dedup-file-cache-storage-v1.ts`、`service/session-kkv/**`、`service/chat/impl/{session,project,message}.service.ts`、`domain/workplace/logic/{rule-snapshot-codec,load-or-fill-file-cache,diff-workplace-paths}.ts`、`domain/vfs/content-store/logic/{hash-content,zlib-codec,blob-bytes-codec}.ts`、`infra/content-cache/logic/decoded-content-cache.ts`、双端 `apps/{desktop,mobile}/src/**`（db-maintenance / blob-binary / compaction / busy / runtime 调度）、`apps/cli/src/runtime.ts`。

---

## 摘要

本区是「按 sessionId 路由的会话级 KKV」存储层与其上的一套后台数据搬运/维护链路。`session-kkv` 提供一个 7 方法仓储端口，`file_cache` 域被分流到 `session_file_cache_blob`（内容寻址、正文全库单份）+ `session_file_cache_entry`（会话侧引用行）两表，其余域仍走 `session_kkv_entry` 旧表。`db-maintenance` 收敛了「缓存 GC → WAL checkpoint → VACUUM」维护链路，并挂两个谓词驱动的后台搬运任务：存量 blob 形态归一（zlib-b64 文本 → 二进制）与消息正文压缩搬运（`content_json != ''` → blob 两列）。三端各自调度、app 层组合守卫（Agent 活跃 / 云同步 / 数据清理 busy），core 不感知端形态。

## 职责与边界

**本区负责**

- KKV 行的持久化语义：域/键/值的 CRUD、批量读、整域清、整会话清；`file_cache` 域的双表分流与旧表退化兼容。
- file_cache blob 的编解码与「先哈希后压缩」的写序、`content_hash` 去重、进程内解压产物缓存的接线。
- 孤儿 `session_file_cache_blob` 行的回收（`runDeferredFileCacheGc`，引用集 = entry 全表）。
- 存储统计采样（PRAGMA page_count/page_size/freelist_count）与维护链路执行（GC → checkpoint → VACUUM）。
- 两个谓词驱动后台任务：blob 形态归一（`nm-blob-binary` 三张表各自完成标记）、消息正文压缩搬运（`nm-message-content` 完成标记）；含 keyset 游标、批 ≤100、零进展护栏、收尾谓词校验、坏行隔离、维护失败持久化兜底。

**本区不负责（明确边界）**

- 调度与运行守卫：谁在什么时机跑、Agent/云同步/清理 busy 让路、rebootstrap 重挂 —— 全在 app 层（desktop main services / mobile services / cli runtime），core 只接受 `shouldPause` / `syncBudgetMs` / `beforeMaintenance` / `afterMaintenance` 回调。
- 提示词拼装、压缩条件判定、置位/压缩的副作用编排 —— 在 `service/chat` 与 `service/compaction-conditions`。
- schema 迁移：本区两个任务**刻意不注册 schema migration**（`schema_migrations` 只有 `(id, applied_at_ms)` 两态、无进度列，且有「空占位登记禁令」）；文件缓存去重化那次是纯清空，才走了 `dedup-file-cache-storage-v1`。
- zlib/base64 编解码原语、VFS 内容存储 —— 在 `domain/vfs/content-store/logic/`，本区只 import 复用。

## 对外接口

**`domain/session-kkv/`**

| 符号 | 位置 | 说明 |
|---|---|---|
| `SessionKkvRepository`（7 方法） | `repositories/session-kkv.port.ts:12-45` | `get` / `getMany` / `set` / `delete` / `clearDomain` / `clearSession` / `listKeys` |
| `SqliteSessionKkvRepository` | `repositories/impl/sqlite-session-kkv.repository.ts:64` | 唯一实现；`file_cache` 域在 6 个方法里各自分流 |
| `SessionKkvEntry` | `model/session-kkv-entry.ts:8` | `{sessionId, domain, key, value}` 全 readonly |
| `SessionKkvDomain`（联合类型） | `model/session-kkv-domains.ts:123-131` | 8 个域 + `(string & {})` 兜底 |
| 域常量（10 个） | `model/session-kkv-domains.ts:8-121` | `rule_snapshot` / `file_cache` / `user_vfs_pending` / `backfill_cursor` / `stream_metrics` / `prompt_tokens` / `token_chunks` / `usage_stats` + 6 个键常量 |
| `SESSION_KKV_COMPOSER_STATUS_DOMAINS` | `model/session-kkv-domains.ts:109-112` | 回滚可按域清空的两域；**刻意不含 `rule_snapshot`** |
| `fileCacheKey(status, path)` | `model/session-kkv-domains.ts:139` | `` `${status}:{path}` `` |
| `runDeferredFileCacheGc(conn)` | `logic/deferred-file-cache-gc.ts:29` | 返回删除行数；**唯一被调用于删 entry 引用行的事务提交后** |
| `hashFileCachePayload` / `compressFileCacheBodyForBlob` / `decodeFileCacheBlobBody` | `logic/file-cache-blob-codec.ts:38/53/74` | 只哈希 / 压缩 / 解压；复用 vfs 的 `hash-content` 与 `zlib-codec` |

**`infra/db-maintenance/`**（`index.ts` 全量转出，再由 `core/src/index.ts:92-115` 进主入口）

| 符号 | 位置 |
|---|---|
| `createDbMaintenanceService(conn)` → `{getStorageStats, runDatabaseMaintenance}` | `impl/db-maintenance.service.ts:54` |
| `runStartupMaintenanceOnce(conn)` | `impl/db-maintenance.service.ts:134` |
| `runBlobBinaryNormalization(conn, options?)` / `BlobBinaryRunResult` / `BlobBinaryStatus` | `impl/blob-binary-normalization.ts:703/255/219` |
| `getBlobBinaryStatus(conn)` / `BLOB_BINARY_KKV_MODULE` / `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS` | `impl/blob-binary-normalization.ts:461/60/97` |
| `runMessageContentCompaction(conn, options?)` / `MessageCompactionRunResult` / `MessageCompactionStatus` | `impl/message-content-compaction.ts:349/127/89` |
| `getMessageCompactionStatus(conn)` / `MESSAGE_COMPACTION_KVV_MODULE` / `_KEY` / `DEFAULT_COMPACTION_SYNC_BUDGET_MS` | `impl/message-content-compaction.ts:318/56/57/86` |
| `StorageStats` / `DatabaseMaintenanceResult` / `DbMaintenanceService` | `db-maintenance.port.ts:16/35/45` |
| `__resetStatusSamplingThrottleForTests`（两个任务各一份，**同名不同模块**） | `blob-binary:371` / `message-content-compaction:192` |

`infra/kkv/logic/parse-kkv-json-document.ts` 导出 `parseKkvJsonDocument<T>(raw, decodeFn)`，**无任何 barrel 转出**（见 F-09）。

## 数据访问

| 表 / 存储 | 触点 | 证据 |
|---|---|---|
| `session_kkv_entry`（旧表，PK `(session_id, domain, key)`） | 非 file_cache 域全部读写；file_cache 域的防御性删除 | `sqlite-session-kkv.repository.ts:215-217, 338-340, 347-349, 359, 391-394, 473-475, 493-496` |
| `session_file_cache_blob`（`WITHOUT ROWID`，PK `content_hash`） | 写：INSERT OR IGNORE（`:260-262`）；读：`getMany` IN 查询（`:152-153`）、`getFileCacheEntry` 单查（`:441-442`）；归一 UPDATE（`blob-binary:179-181`）；GC 全表 DELETE（`deferred-file-cache-gc:36-38`） | 同左 |
| `session_file_cache_entry`（PK `(session_id, key)`，索引 `idx_session_file_cache_hash`） | 写：upsert（`:274-278`）；读：IN（`:109-110`）/ 单查（`:417-418`）；`delete` / `clearDomain` / `clearSession` 全域 DELETE | 同左 |
| `kkv_entry` | 两个任务的完成标记与 pending 标记（`SqliteKkvRepository`）；db-maintenance 手动清理时一条裸 DELETE | `blob-binary:308/390/411/435`、`message-content-compaction:208/268/491/513/533`、`db-maintenance.service.ts:89-92` |
| `chat_message` | 压缩任务：SELECT `rowid,id,content_json`（`:391-392`）、逐行 UPDATE（`:428-430`）、COUNT（`:161`）；归一任务：SELECT/UPDATE（`blob-binary:191-197`） | 同左 |
| `vfs_content_blob` | 归一任务第三张表（`blob-binary:152-166`） | 同左 |
| 进程内 LRU（非持久） | `infra/content-cache` 的 `contentBodyPool`：`lookupDecodedContentBody` / `rememberDecodedContentBody`，键 = 明文 sha256 hex，两套内容寻址存储共用 | `sqlite-session-kkv.repository.ts:135, 169, 429, 451` |
| 文件路径 | 无。本区不碰文件系统（blob 存库、`byte_len` 只作诊断列，无生产读方） | `blob-binary:180` / `sqlite-session-kkv.repository.ts:261` 写；`git grep byte_len` 全仓无 file_cache 读点 |

## 依赖关系

**本区 import（生产）**

- `@/infra/tdbc/ports/connection.port`（`TdbcConnection`）、`@/infra/tdbc/logic/template-helper`（`queryTemplate` / `executeTemplate`）、`@/infra/tdbc/types`（`Row` / `SqlValue`）
- `@/infra/sql-template`（`SqlTemplateParser`）—— 三个文件各自 `new` 一个实例，无共享
- `@/domain/vfs/content-store/logic/{hash-content, zlib-codec, blob-bytes-codec}`（`hashContent` / `compressZlib` / `decompressZlib` / `tightBytes` / `decodeCompressedBytes` / `asBase64Text` / `base64ToBytes` / `VFS_CONTENT_ENCODING_ZLIB`）
- `@/domain/workplace/logic/rule-snapshot-codec`（`parseFileCachePayload` / `serializeFileCachePayload`）—— **方向反直觉：domain/session-kkv 依赖 domain/workplace**，见「争议与存疑」
- `@/domain/kkv/repositories/impl/sqlite-kkv.repository`（`SqliteKkvRepository`，两个任务各自 `new`）
- `@/infra/content-cache/logic/decoded-content-cache`
- `@novel-master/...` 无跨包依赖

**本区被谁消费**

- `service/session-kkv/**`（`DefaultSessionKkvService` 薄委托 + `createSessionKkvService` 工厂）→ 被 `workplace`、`message-transcript-effects`、`clear-session-prompt-caches`、`refresh-rule-snapshot`、`infra/tokenizer/logic/{session-api-prompt-token-store, token-chunk-cache, prompt-whole-cache}`、`usage-stats`、`message-rollback`、`truncate-tail-in-transaction`、双端 app 层使用
- `public/session-kkv.ts` 子路径出口（`createSessionKkvService` + 域/键常量 + `fileCacheKey`），`tsconfig.test.json:27` 有对应 paths 映射
- `domain/session-kkv/logic/file-cache-blob-codec` → 被 `domain/workplace/logic/rule-snapshot-codec` 的对偶 `assemble-workplace-display` / `load-or-fill-file-cache` 经仓储间接消费
- `runDeferredFileCacheGc` → `service/chat/impl/session.service.ts:197`、`project.service.ts:196`
- `runBlobBinaryNormalization` / `runMessageContentCompaction` / `get*Status` / `createDbMaintenanceService` / `runStartupMaintenanceOnce` → `core/src/index.ts:92-115` → `apps/cli/src/runtime.ts:187,191`、`apps/desktop/src/main/services/{db-maintenance, blob-binary-normalization, message-content-compaction}.service.ts`、`apps/mobile/src/services/` 同名文件、`apps/desktop/src/main/main.ts:177,180`

**依赖环检查**：本区内部无环。`db-maintenance.service.ts:7` import `domain/session-kkv/logic/deferred-file-cache-gc`，而后者不 import db-maintenance；`blob-binary-normalization.ts:56` import `db-maintenance.service`，后者不 import blob-binary —— 这条边正是 `db-maintenance.service.ts:84-87` 注释里说「key 用字面量而不 import 常量，否则形成循环依赖」的原因（实测确认：该 DELETE 的 SQL 参数是硬编码 `["nm-blob-binary", "startupMaintenancePending"]`）。

---

## 发现清单

### F-w8-ds-kkvstore-a-01 | P2 | `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:762-774` + `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:506-524`

```ts
      const result = await runStartupMaintenanceOnce(conn);
      if (result !== null) {
        await clearStartupMaintenancePending(conn);
      } else {
        console.warn(
          "[blob-binary-normalization] 本进程已跑过收尾维护，startupMaintenancePending 保留待下次冷启动"
        );
      }
```

**描述**：desktop 启动链上两个搬运任务**并发**调度（`main.ts:177` compaction 先、`:180` blob-binary 后），二者最终都撞上 `runStartupMaintenanceOnce` 的进程级去重标记（`db-maintenance.service.ts:121,137-141`）。先跑者执行 VACUUM 并消耗标记；后跑者拿到 `null`，走 else 分支 —— 但**它的 pending 标记此刻并不存在**（pending 只在维护**抛错**时才置，见 `blob-binary:775-779`），所以「保留待下次冷启动」是一句空话：下次冷启动两个任务的完成标记都已置，入口直接 `continue` / 早返回，**根本不会再进维护段**。

**后果**：同一进程内，后跑那个任务归一/搬运所释放的页永远挂 freelist 不被 VACUUM 归还，直到用户手动点「数据清理」。属于纯空间浪费（无正确性损失），但在 100MB+ 库上等于一次迁移省下的空间全丢。

**建议**：给两个任务的入口各加一条「上次维护由谁消耗」的持久化线索——最小改法是让 `runStartupMaintenanceOnce` 的 else 分支也置 pending 标记（把「本进程已跑过」升级成「本进程维护段已被别的任务消耗，你释放的页没被回收」），下次冷启动强制补跑一次；或者把 desktop 的调度改成 compaction 完成后再起 blob-binary（串行化，代价是迁移总时长变长）。

**置信**：confirmed

---

### F-w8-ds-kkvstore-a-02 | P2 | `packages/core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts:325-343`

```ts
  async clearDomain(sessionId: string, domain: string): Promise<void> {
    if (domain === SESSION_KDV_DOMAIN_FILE_CACHE) {
      // 只删该会话 entry 引用行，blob 与其他会话 entry 不动（GC 按全库
      // 引用集判定）；旧表行一并防御性删除（退化路径理论行）。
      await executeTemplate(
        this.conn,
        this.parser,
        `DELETE FROM session_file_cache_entry WHERE session_id = #{sessionId}`,
        { sessionId }
      );
```

**描述**：`clearDomain(file_cache)` 删掉该会话全部引用行后，`session_file_cache_blob` 里对应的 blob 立刻成为孤儿，而**本区没有任何调度点回收它们**。实测 `runDeferredFileCacheGc` 的调用方只有两处：`service/chat/impl/session.service.ts:197`（删会话）与 `project.service.ts:196`（删项目），外加 `db-maintenance.service.ts:66`（维护链路内）。

高频触发 `clearDomain(file_cache)` 的路径有四条，全部无 GC 调度：
- `service/vfs/logic/clear-session-prompt-caches.ts:35` —— 置位、压缩、导入缓存对齐（`docs/apm/RULE.md` 第 17 行明确这是三条路径的共同副作用）
- `service/workplace/refresh-rule-snapshot.ts:41` —— **每次规则保存**
- `domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:94-96` —— **每次回滚**
- `service/chat/impl/message-transcript-effects.service.ts:176` —— 置位

同样地，`clearSession`（`:353-368`，被 desktop `ipc/handlers/workplace.ts:148` 与 mobile `workplace-block.service.ts:42` 的「手动重置常驻工作区」调用）也只删引用行、留孤儿 blob，同样无 GC 调度。

**后果**：一个从不删会话/项目、只反复置位+压缩+改规则的用户，`session_file_cache_blob` 单调增长直到某次删会话才被回收。这不是崩溃级，但与 blob 去重化省空间的设计目标直接冲突——去重把 N 份正文压成 1 份，省下的空间会被孤儿副本慢慢吃回去。

**建议**：在 `clearDomain(file_cache)` 与 `clearSession` 的调用侧（或仓储内直接判断 `domain === file_cache` 时）挂一个 fire-and-forget 的 `runDeferredFileCacheGc`，与 `deferred-revision-orphan-gc.ts:55-79` 已有的「in-flight 去重 + setImmediate 脱离调用方」形态对齐；或给 blob 表加一个轻量水位（孤儿行数超阈值才跑全表 DELETE），避免每次置位都全表扫。

**置信**：confirmed（调用点与调度缺口均已 `git grep` 实测；blob 无引用行留存是设计意图，未回收是缺口）

---

### F-w8-ds-kkvstore-a-03 | P2 | `apps/mobile/src/services/message-content-compaction.service.ts:54-57` + `apps/mobile/src/services/blob-binary-normalization.service.ts:77-79`

```ts
      result = await runBlobBinaryNormalization(runtime.conn, {
        shouldPause: mobileNormalizationBlocked,
      });
```

**描述**：mobile 两个后台循环都**没有传** `beforeMaintenance` / `afterMaintenance`，因此 core 收尾维护段（GC + `PRAGMA wal_checkpoint(FULL)` + `VACUUM`，`db-maintenance.service.ts:62-79`）在 mobile 上执行时**不置 `isMobileDbMaintenanceBusy()`**。desktop 两个对应服务都传了，且注释写明理由（`apps/desktop/src/main/services/blob-binary-normalization.service.ts:98-107`：「better-sqlite3 的 VACUUM 同步执行、冻结 main 事件循环——core 不感知 app 的 busy 状态，由这里借回调只包住真正会冻结的那一段置位」）。

**后果**：mobile 上一个后台任务正在跑收尾 VACUUM 时，用户点「数据清理」不会被拦。`apps/mobile/src/services/db-maintenance.service.ts:123-138` 的手动链路只查 `isMobileAgentActive()`（**不查 busy**，与 desktop `db-maintenance.service.ts:106-114` 显式 `if (isDesktopDbMaintenanceBusy()) throw` 不一致），于是两条 VACUUM 会经 tdbc 驱动层 AsyncMutex 串行排队执行——不至于崩，但用户在 UI 上看到的是「处理中…」卡住十几秒，而 busy 信号此时是 false，同期任何依赖 busy 让路的逻辑都读不到正确状态。

**建议**：mobile 两个调度服务补齐 `beforeMaintenance: () => acquireMobileDbMaintenanceBusy()` / `afterMaintenance: () => releaseMobileDbMaintenanceBusy()`（mobile 用计数式 acquire/release，见 `db-maintenance-busy.ts:23-33`）；同时给 mobile 手动链路补 `isMobileDbMaintenanceBusy()` 前置拒绝，与 desktop 对齐。若确认 op-sqlite 的 VACUUM 不冻 JS 线程，也应在两侧注释里写明「mobile 不设 busy 是有意为之」并同步删掉 desktop 侧的对应注释里的隐含前提。

**置信**：suspected（VACUUM 在 op-sqlite 上的线程行为未实测；调用点缺失是 confirmed）

---

### F-w8-ds-kkvstore-a-04 | P3 | `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:121,134-142`

```ts
let startupMaintenanceRan = false;

export async function runStartupMaintenanceOnce(
  conn: TdbcConnection
): Promise<DatabaseMaintenanceResult | null> {
  if (startupMaintenanceRan) {
    return null;
  }
  startupMaintenanceRan = true;
```

**描述**：进程级去重标记不可复位。desktop 的 rebootstrap（备份导入 / 云同步 pull，`close 连接 → 覆盖库文件 → 重新 open + bootstrap`，见 `bootstrap/novel-master-bootstrap.ts:331-338` 的说明）会换掉整个连接与库，但 `startupMaintenanceRan` 仍是 true。与此对照，`bootstrapNovelMaster` 入口**显式**调了 `clearDecodedContentCaches()`（`novel-master-bootstrap.ts:345`）来守「派生缓存与库同寿命」这条纪律——同一个纪律下，维护去重标记没被一起清。

**后果**：rebootstrap 后的新库在本进程内拿不到任何启动期维护。与 F-01 叠加时更明显：blob-binary 服务自称「连接被 rebootstrap 换掉时本任务视为可重挂」（`apps/desktop/src/main/services/blob-binary-normalization.service.ts:26-29`），但重挂后的维护段会被这个标记挡成 `null`，重挂实际只完成了归一、没完成维护。

**建议**：给 `runStartupMaintenanceOnce` 加一个 `resetStartupMaintenanceDedupForTests()`（或直接导出 `startupMaintenanceRan` 的复位入口），在 `bootstrapNovelMaster` 的 `clearDecodedContentCaches()` 旁边一并调用 —— 让「派生状态随库同寿命」这条纪律覆盖到维护去重标记。测试侧另需注意 `docs/apm/RULE.md` 第 82 行点名的「进程级模块标记被同文件首条用例消费」陷阱（现有测试已用独立文件规避，见 `blob-binary-normalization-maintenance.test.ts:74` 的说明）。

**置信**：confirmed（代码路径），影响面 suspected

---

### F-w8-ds-kkvstore-a-05 | P3 | `packages/core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts:255-285`

```ts
      if (existing.length === 0) {
        const blob = compressFileCacheBodyForBlob(hashed.body);
        await executeTemplate(
          this.conn,
          this.parser,
          `INSERT OR IGNORE INTO session_file_cache_blob
             (content_hash, encoding, bytes, byte_len)
           VALUES (#{contentHash}, #{encoding}, #{bytes}, #{byteLen})`,
```

**描述**：`set` 在 file_cache 域走三条独立语句：`SELECT 1 FROM session_file_cache_blob WHERE content_hash = ?`（`:248-254`）→ 必要时 INSERT blob → upsert entry。三条之间**没有包在一个事务里**。注释（`:244-247`）论证了「先内容后引用」的写序，理由是「中途崩溃最坏产生孤儿 blob（GC 可回收），绝不悬空引用」——这个论证对**崩溃**成立，但对**并发 GC** 不成立。

**后果**：`runDeferredFileCacheGc` 可以在 blob INSERT 与 entry upsert 之间执行（两者都是独立 `await`，驱动层 AsyncMutex 只保证单语句串行，不保证这一对语句原子）。此时新写入的 blob 因「还没有任何 entry 引用它」而被判为孤儿删除，紧接着 entry 行写入成功 → **悬空引用**。读路径 `getFileCacheEntry` 会走 `blobs.length === 0 → return null`（`:445-446`），上层 `loadOrFillFileCache` 当 miss 自愈重读（`load-or-fill-file-cache.ts:51-57`），所以最终一致、不丢数据，但每次命中这个窗口都要付一次「读 VFS + 重新压缩写回」的代价（Hermes 纯 JS deflate 不便宜，见 `file-cache-blob-codec.ts:34-37` 的量化说明）。

窗口极窄（两次 await 之间），且自愈路径存在，故列 P3。

**建议**：把 blob INSERT 与 entry upsert 包进同一个 `conn.transaction(...)`，写序不变、原子性补齐；`existing` 探测留在事务外即可（`INSERT OR IGNORE` 本身幂等，探测只是省压缩）。

**置信**：suspected（窗口存在性与自愈路径已确认；实际命中率未实测）

---

### F-w8-ds-kkvstore-a-06 | P3 | `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts:87` vs `:123-131`

```ts
export const SESSION_KKV_DOMAIN_USAGE_STATS = "usage_stats" as const;
```
```ts
export type SessionKkvDomain =
  | typeof SESSION_KKV_DOMAIN_RULE_SNAPSHOT
  | typeof SESSION_KKV_DOMAIN_FILE_CACHE
  | typeof SESSION_KKV_DOMAIN_USER_VFS_PENDING
  | typeof SESSION_KKV_DOMAIN_BACKFILL_CURSOR
  | typeof SESSION_KKV_DOMAIN_STREAM_METRICS
  | typeof SESSION_KKV_DOMAIN_PROMPT_TOKENS
  | typeof SESSION_KKV_DOMAIN_TOKEN_CHUNKS
  | (string & {});
```

**描述**：`SESSION_KDV_DOMAIN_USAGE_STATS` 是本文件定义的第 8 个域，有三个真实消费方（`service/chat/impl/message.service.ts:115`、`service/chat/impl/usage-stats.service.ts:474,550`、`service/message-checkpoint/impl/message-rollback.service.ts:279`、`service/vfs/logic/clear-session-prompt-caches.ts:44`），但**没有出现在 `SessionKkvDomain` 联合类型里**。因为联合末尾有 `(string & {})` 兜底，编译不报错，域类型实际退化为「任意字符串」。

**后果**：`SessionKkvDomain` 名义上是「域清单单源」，实际漏了一个域。任何依赖它做穷举校验或文档生成的地方都会静默漏掉 `usage_stats`。

**建议**：把 `| typeof SESSION_KKV_DOMAIN_USAGE_STATS` 补进联合；顺手考虑给域常量加一条 `ALL_SESSION_KKV_DOMAINS` 数组作为唯一真源，联合类型与它用 `typeof` 派生，避免以后再漏。

**置信**：confirmed

---

### F-w8-ds-kkvstore-a-07 | P3 | `apps/mobile/src/services/blob-binary-normalization.service.ts:108-116`

```ts
export function scheduleMobileBlobBinaryNormalization(
  runtime: MobileNovelMasterRuntime,
): void {
  if (scheduledRuntime === runtime) {
    return;
  }
  scheduledRuntime = runtime;
  void runNormalizationLoop(runtime);
}
```

**描述**：三处同款「按 runtime 身份去重」的调度里，只有 mobile blob-binary 这一处**没有在循环退出时清登记键**。desktop blob-binary 在 `finally` 里清（`apps/desktop/src/main/services/blob-binary-normalization.service.ts:167-172`，注释：「循环退出即清键：防『失败收手后身份键挂死』阻断后续重挂」）；mobile compaction 也在 `.finally` 里清（`apps/mobile/src/services/message-content-compaction.service.ts:93-99`）。

**后果**：mobile blob-binary 的循环一旦以任何方式退出（`done` / `stalled` / `console.error` 后 return），`scheduledRuntime` 永久等于该 runtime 对象，同 runtime 的后续调度被静默吞掉。实际触发概率低（effect 依赖 `[runtime]`，runtime 不变则 effect 不重跑，见 `novel-master-context.tsx:260`），但这是三处实现里唯一的例外，与另两处的注释所防的是同一个失败模式。

**建议**：照抄 mobile compaction 的 `.finally` 条件复位写法（`scheduled-runtime === runtime` 时置 undefined）。

**置信**：confirmed

---

### F-w8-ds-kkvstore-a-08 | P3 | `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:88-92`

```ts
      try {
        await conn.execute(
          "DELETE FROM kkv_entry WHERE module = ? AND key = ?",
          ["nm-blob-binary", "startupMaintenancePending"]
        );
```

**描述**：手动「数据清理」成功后只清 `nm-blob-binary` 模块的 pending 标记，**不清 `nm-message-content` 模块的同名 pending 标记**（`message-content-compaction.ts:67-68` 定义、`:277-283` 与 `:509-516` 消费）。两个模块的 pending key 各自独立是有意设计（`message-content-compaction.ts:62-66` 的 OQ-I2 口径），但手动清理只覆盖了一边。

**后果**：压缩任务的收尾维护若曾失败置下 pending，用户手动点了「数据清理」（页已归还、标记却还在），下次冷启动仍会强制补跑一次全库 VACUUM。纯浪费、无正确性损失，且用户无法从 UI 察觉。

**建议**：这条 DELETE 扩成两条（或 `WHERE module IN ('nm-blob-binary','nm-message-content') AND key = 'startupMaintenancePending'`）；两条 pending key 相同、模块名不同，一次 IN 即可，不必为两个任务各写一条。

**置信**：confirmed

---

### F-w8-ds-kkvstore-a-09 | P3 | `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts:15-21`

```ts
export function parseKkvJsonDocument<T>(
  raw: string,
  decodeFn: (parsed: unknown) => T
): T {
  const parsed = JSON.parse(raw) as unknown;
  return decodeFn(parsed);
}
```

**描述**：全仓零消费方。`git grep -rn "parseKkvJsonDocument"` 只命中自身定义与 `docs/Iterations/core-architecture-style/spec.md:45,69,140,195`（该迭代为当时的 `events-config` 域规划此单源，而 `events-config` 域现已不存在于 `packages/core/src`——`git grep -rl "event-config\|eventsConfig\|event_config"` 在 `packages`/`apps` 下零命中）。文件也未从任何 barrel 转出（`core/src/index.ts` 无、`infra/db-maintenance/index.ts` 无、`public/kkv.ts` 只转 `createKkvService` 与错误类型）。

**后果**：19 行死代码留在仓里，`infra/kkv/logic/` 整个目录只服务它一个文件。ARCHITECTURE 文档（`packages/core/ARCHITECTURE.md:125`）记载的是 `infra/kkv-value-codec.ts`（另一个真实在用的文件，被 `persistent-preferences.service.ts:9` 消费），本文件连文档都没被记进去。

**建议**：直接删除文件与 `infra/kkv/` 空目录；若要保留作「KKV JSON 解析单源」的未来契约，移到 `docs/Iterations/` 下做设计稿而非生产代码。

**置信**：confirmed

---

### F-w8-ds-kkvstore-a-10 | P3 | `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:743` + `:734-740`

```ts
  if (allDone && (processedAny || maintenancePending)) {
    // 归一释放的页挂 freelist，VACUUM 归还文件系统。
```

**描述**：blob 归一任务的收尾维护有 `processedAny` 门（只有真正改写过 ≥1 行才跑 VACUUM，cr-25 明确删除了 `done && failedCount > 0` 那一支，理由是「没有释放任何页，跑 VACUUM 是纯成本」）。但**压缩任务没有对应门**：`message-content-compaction.ts:487-548` 在置完成标记后无条件走维护段。一个谓词本就为空的库（全新安装、或全部行由 e2e fixture 直插明文且已被别处压缩）首次调用时会白跑一次全库 VACUUM。

**后果**：影响面比 F-01 小（compaction 在 desktop 上通常先跑，消耗掉维护标记，blob-binary 的 `processedAny` 门此时根本没机会生效），但方向与 blob 侧花了 cr-25 才想清楚的结论相反。CLI 场景更明显：`apps/cli/src/runtime.ts:187,191` 每次命令都无条件调两个任务，空库上每条 CLI 命令都会付一次 VACUUM。

**建议**：给压缩任务补一个与 blob 侧同款的 `processedAny` 门（`compactedCount > 0` 才进维护段），两个任务口径统一。若要保留「谓词空也确认一次全库干净」的原意，应写进注释说明这是刻意与 blob 侧分叉。

**置信**：confirmed

---

### F-w8-ds-kkvstore-a-11 | P3 | `apps/mobile/src/services/db-maintenance.service.ts:123-138` vs `apps/desktop/src/main/services/db-maintenance.service.ts:106-115`

**描述**：两端手动「数据清理」的守卫集合不一致。desktop 依次拒绝 Agent 活跃、云同步 busy、数据清理 busy 三种情形；mobile 只拒绝 `isMobileAgentActive()`，另外两种都不查——直接 `acquireMobileDbMaintenanceBusy()` 然后开跑。

**后果**：mobile 上「云同步进行中」或「另一个数据清理在跑」都不拦。因为 busy 是计数式（`db-maintenance-busy.ts:15-33`），第二次调用会把计数 +1 并真的进 VACUUM；两次 VACUUM 经驱动层互斥串行，不会崩，但用户在 UI 上看到的是长时间「处理中…」，且期间后台搬运循环读到的 busy 语义与用户预期不符。

**建议**：mobile 补齐 `if (isMobileDbMaintenanceBusy()) throw new Error('数据清理进行中，请稍后再操作')`（该文案 desktop 已在用）。若 mobile 端确有「允许叠加」的刻意设计（如备份导入完成后立刻手动清理），在两处注释里写明。

**置信**：confirmed（守卫缺失），是否刻意 suspected

---

### F-w8-ds-kkvstore-a-12 | P3 | `packages/core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts:191-196`

```ts
      // 退化路径（旧表行）批量补齐：新表没命中的键查一次 legacy。
      if (missing.length > 0) {
        const legacy = await this.getManyLegacy(sessionId, domain, missing);
        for (const [key, value] of legacy) {
          out.set(key, value);
        }
      }
```

**描述**：`missing` 的语义是「entry 表里没有行的键」（`:113-122`）。若某键的 entry 行**存在**但 blob 行缺失或解码失败，该键在 `:176-188` 被 `continue` 掉，既不进 `out` 也不进 `missing` —— 不会再去旧表找。单键路径 `getFileCacheEntry` 同理（`:445-446` 直接 `return null`，不回退 legacy）。

**后果**：这是**正确**的（entry 行存在即表示该键已迁到新表形态，旧表不应有同键行；回退反而可能读到被 migration 清空前的老行）。但代码里没有一句话说明「entry 行存在时故意不回退 legacy」，与 `:190` 注释「退化路径（旧表行）批量补齐」并列放着，容易被后来者读成 bug 并「修」它——比如在 `continue` 前补一次 legacy 探测，那会给已损坏的新表行开了旧表后门。

**建议**：在 `:176-188` 的 `if (body == null) { continue; }` 上补一行注释：「entry 行存在 = 该键已迁新表形态，此时回退 legacy 会读到 migration 清空前的老行，故按 miss 处理（上层自愈重读）」。

**置信**：confirmed（现状正确，缺注释）

---

### F-w8-ds-kkvstore-a-13 | P3 | `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts:13-14,102-112`

```ts
/** 用户 VFS pending 队列域（随 clearSession 清空）。 */
export const SESSION_KDV_DOMAIN_USER_VFS_PENDING = "user_vfs_pending" as const;
```
```ts
export const SESSION_KKV_COMPOSER_STATUS_DOMAINS = [
  SESSION_KDV_DOMAIN_FILE_CACHE,
  SESSION_KDV_DOMAIN_USER_VFS_PENDING,
] as const;
```

**描述**：`user_vfs_pending` 已是历史域——`docs/apm/RULE.md:12` 记载 user_ops 功能已整体拆除，该域「已无写入方，仅剩 truncate 清旧域路径与域常量」。但它仍留在 `SESSION_KKV_COMPOSER_STATUS_DOMAINS` 里，于是每次回滚（`truncate-tail-in-transaction.ts:94-96`）都会多发一条恒删 0 行的 `DELETE FROM session_kkv_entry WHERE session_id=? AND domain='user_vfs_pending'`。

**后果**：一条恒空操作，代价可忽略。真正的问题是它让「回滚清哪些域」这份清单读起来像是还有第三个活跃域，未来改域语义时容易误判。

**建议**：保留常量（历史数据清理路径仍需要它能被清），但在 `SESSION_KKV_COMPOSER_STATUS_DOMAINS` 的注释里标注 `user_vfs_pending` 为历史域、无写入方；或从该数组移除并在 `truncate-tail-in-transaction.ts` 里单列一行带注释的清理。

**置信**：confirmed（域已死是 RULE 明文），保留与否属设计取舍

---

## 争议与存疑

**1. `domain/session-kkv` 反向依赖 `domain/workplace`（未报为问题，但方向可疑）**

`file-cache-blob-codec.ts:20` 与 `sqlite-session-kkv.repository.ts:31` 都 import `@/domain/workplace/logic/rule-snapshot-codec` 的 `parseFileCachePayload` / `serializeFileCachePayload`。也就是说，**存储层依赖了它所存数据的领域模型所在的域**。按 `docs/Iterations/core-architecture-style` 的分层意图，`rule-snapshot-codec` 里放 `FileCachePayload` 是因为它与 `RuleSnapshot` 共处一文件——但 `FileCachePayload` 的真实归属是 session-kkv（`{body, mtimeMs}` 是 file_cache 专属载荷，`rule_snapshot` 域用的是 `canon` 键的另一种形态，见 `session-kkv-domains.ts:115`）。

**处理**：不报为 finding，因为改动面会波及 `load-or-fill-file-cache`、`assemble-workplace-display`、`vfs-tools`、`diff-workplace-paths` 与 workplace 侧全部测试。**但建议 reduce 阶段裁决**：把 `FileCachePayload` + 两个 parse/serialize 函数下沉到 `domain/session-kkv/model/`，`rule-snapshot-codec` 反向 import 它（或各留一份薄壳）。这一条我拿不准是否值得动，故明确标出而非自行下判断。

**2. F-01 的严重度我拿不准在 P2 还是 P3**

失效后果确认是「空间不回收」，无数据/正确性损失。但触发条件是「desktop 启动时两个任务都有活干」——也就是**仅在升级迁移窗口**出现，迁移完成后两个标记都置好、后续启动都是零成本短路。所以我给 P2（一次性、有明确浪费），但如果台面上已有专门跟踪「迁移期空间」的台账，这条更可能是 P3。**留给裁决。**

**3. F-03 的前提未实测**

「mobile 的 VACUUM 是否冻结 JS 线程」我没有实测 op-sqlite 侧行为。若 op-sqlite 的 VACUUM 走原生异步（不阻塞 JS），则 mobile 不设 busy 副作用很小，F-03 降到 P3/关闭都合理。desktop 侧明确注明 better-sqlite3 的 VACUUM 是同步的（`apps/desktop/src/main/services/blob-binary-normalization.service.ts:99-101`），mobile 无对应说明——**这本身可能就是缺口**：没人记录过 mobile 的口径。

**4. `byte_len` 列在 file_cache 侧无生产读方**

`session_file_cache_blob.byte_len` 被写（`sqlite-session-kkv.repository.ts:261`、`blob-binary-normalization.ts:180`），schema 里是 `NOT NULL`，但 `git grep byte_len` 显示唯一的生产读方在 VFS 侧（`sqlite-vfs-entry.repository.ts:241-253` 算文件体积）。file_cache 的 `byte_len` 目前是纯诊断列。

**不报为 finding**（schema 对齐 vfs 的既有设计，且 blob 归一任务需要它来重算存量行的物理长度，见 `blob-binary-normalization.ts:27-29`），但如果台账要记「无消费方的持久化字段」，这是本区的一条。

**5. 与另一份双扫（`w8-ds-kkvstore-b`）的区界**

我按 zone prompt 只扫了 `session-kkv/` + `infra/kkv/` + `infra/db-maintenance/`。`domain/kkv/`（模块级 KKV，与 session-kkv 是两套）、`domain/workplace/`、`service/session-kkv/` 均**未纳入本区测绘**（仅在确证结论时定点读取）。若 B 机位恰好覆盖了 `service/session-kkv/` 的薄委托层，重合面预计很小——本区的实质逻辑全在仓储实现与两个搬运任务里，这两处不太可能被他认领。**未读 B 的任何文件。**
