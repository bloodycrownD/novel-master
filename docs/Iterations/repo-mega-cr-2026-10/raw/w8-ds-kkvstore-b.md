---
zone: w8-ds-kkvstore-b
agent: 独立双扫 B（domain-survey 全量测绘）
files_scanned:
  - packages/core/src/domain/session-kkv/model/session-kkv-domains.ts (145)
  - packages/core/src/domain/session-kkv/model/session-kkv-entry.ts (13)
  - packages/core/src/domain/session-kkv/repositories/session-kkv.port.ts (46)
  - packages/core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts (499)
  - packages/core/src/domain/session-kkv/logic/deferred-file-cache-gc.ts (42)
  - packages/core/src/domain/session-kkv/logic/file-cache-blob-codec.ts (85)
  - packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts (21)
  - packages/core/src/infra/db-maintenance/db-maintenance.port.ts (55)
  - packages/core/src/infra/db-maintenance/index.ts (46)
  - packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts (142)
  - packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts (793)
  - packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts (550)
  # 消费侧（只读，用于测绘「三个后台搬运任务的调度与守卫」）
  - apps/cli/src/runtime.ts:187,191
  - apps/desktop/src/main/services/blob-binary-normalization.service.ts
  - apps/desktop/src/main/services/message-content-compaction.service.ts
  - apps/desktop/src/main/services/db-maintenance.service.ts
  - apps/mobile/src/services/blob-binary-normalization.service.ts
  - apps/mobile/src/services/message-content-compaction.service.ts
  - apps/mobile/src/services/db-maintenance.service.ts
  - packages/core/src/service/chat/impl/session.service.ts:191-198
  - packages/core/src/service/chat/impl/project.service.ts:190-197
  - packages/core/src/service/session-kkv/create-session-kkv-service.ts
  - packages/core/src/infra/content-cache/logic/decoded-content-cache.ts
---

## 摘要

两块拼在一起的一小块存储基建。左边 `domain/session-kkv/` 是「按 sessionId 路由的会话级键值存储」，
`file_cache` 域已做内容寻址去重（正文压成 blob 全库一份、会话侧只留 hash 引用），其余域走老表
`session_kkv_entry`。右边 `infra/db-maintenance/` 是「存储统计 + 维护链路（缓存 GC → WAL checkpoint →
VACUUM）」，外加两个谓词驱动的后台搬运任务（blob 形态归一、消息正文压缩搬运）和一个延期 GC。
两个搬运任务都不注册 schema migration，靠 KKV 完成标记跨启动收敛。

## 职责与边界

- **会话 KKV 域模型**（`session-kkv-domains.ts`）：域常量 + 域内单键常量 + `SessionKkvDomain` 联合类型 +
  `fileCacheKey(status, path)` 键生成器。声明了 8 个域：`rule_snapshot` / `file_cache` /
  `user_vfs_pending`（历史域，无写入方）/ `backfill_cursor` / `stream_metrics` / `prompt_tokens` /
  `token_chunks` / `usage_stats`。
- **会话 KKV 仓储**（port + sqlite impl）：六方法契约 `get / getMany / set / delete / clearDomain /
  clearSession / listKeys`。`file_cache` 域**透明分流**到 `session_file_cache_entry`（会话引用：
  session_id+key→content_hash+mtime）+ `session_file_cache_blob`（全库单份：`content_hash` 主键，
  `WITHOUT ROWID`）；其余域走 `session_kkv_entry` 老表。`file_cache` 读路径走两层：进程内解压产物池
  （`infra/content-cache`，键=明文 sha256）→ blob 行解压。
- **file_cache blob 编解码**（`file-cache-blob-codec.ts`）：只哈希 / 压缩 / 解码三段，压缩与哈希全部
  复用 vfs ContentStore 侧共享模块，不另起实现。
- **延期 GC**（`deferred-file-cache-gc.ts`）：全表引用集判定，回收无引用的 `session_file_cache_blob` 行。
- **db-maintenance**：`StorageStats`（三条 PRAGMA 直读）、`runDatabaseMaintenance`（用户手动「数据清理」
  与启动期收尾共用同一条链路）、`runStartupMaintenanceOnce`（进程级去重入口）。
- **两个搬运任务**：`runBlobBinaryNormalization`（三表：vfs_content_blob / session_file_cache_blob /
  chat_message，zlib-b64 文本 → 二进制 BLOB）、`runMessageContentCompaction`（chat_message
  `content_json != ''` → blob + 置空串）。骨架同款：谓词分批（≤100）→ 单行短事务 → 批间
  setTimeout(0) 让步 → 单轮 60s 同步预算 → 零进展护栏 → 收尾谓词校验 → 每表 KKV 完成标记 →
  满足门条件时挂一次维护链路。
- **`infra/kkv/`** 只有 `parse-kkv-json-document.ts` 一个 21 行的薄封装（见 F-2）。

## 对外接口

| 模块 | 关键导出 |
|---|---|
| `domain/session-kkv/model/session-kkv-domains.ts` | `SESSION_KKV_DOMAIN_*`（8 个）、`*_KEY`（7 个）、`SESSION_KKV_COMPOSER_STATUS_DOMAINS`、`WorkplaceDisplayStatus`、`fileCacheKey()`、`SessionKkvDomain` |
| `domain/session-kkv/repositories/session-kkv.port.ts` | `SessionKkvRepository`（接口，7 方法） |
| `domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts` | `SqliteSessionKkvRepository` |
| `domain/session-kkv/logic/file-cache-blob-codec.ts` | `hashFileCachePayload` / `compressFileCacheBodyForBlob` / `decodeFileCacheBlobBody` / `HashedFileCachePayload` |
| `domain/session-kkv/logic/deferred-file-cache-gc.ts` | `runDeferredFileCacheGc` |
| `infra/db-maintenance/index.ts` | `createDbMaintenanceService` / `runStartupMaintenanceOnce` / `getStorageStats` / `runDatabaseMaintenance`；`getBlobBinaryStatus` / `runBlobBinaryNormalization` / `BLOB_BINARY_KKV_MODULE` / `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS`；`getMessageCompactionStatus` / `runMessageContentCompaction` / `MESSAGE_COMPACTION_KKV_MODULE` / `MESSAGE_COMPACTION_KKV_KEY` / `DEFAULT_COMPACTION_SYNC_BUDGET_MS` |
| `infra/db-maintenance/impl/*` | 另有 `__resetStatusSamplingThrottleForTests`（blob 侧与 compaction 侧**同名不同模块**，测试各自深路径 import）、`MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY`（**未**从 index 转出） |
| 主入口 `packages/core/src/index.ts:92-115` | 转出上述**除** `MESSAGE_COMPACTION_KKV_MODULE/KEY` 与两个 `__reset*` 之外的全部（对照 `packages/core/test/package-exports/snapshots/main-entry-allowlist.json`） |

## 数据访问

| 表 | 触点 | 证据 |
|---|---|---|
| `session_kkv_entry` | 除 `file_cache` 外全部域的读写；`file_cache` 的退化路径 | `sqlite-session-kkv.repository.ts:215,309,318,338,347,359,381,391,473,493` |
| `session_file_cache_entry` | 引用行读写（get/getMany/set/delete/clearDomain/clearSession/listKeys） | `sqlite-session-kkv.repository.ts:109,302,332,365,378,417` |
| `session_file_cache_blob` | 读（解压器命中后免读）、写（INSERT OR IGNORE）、GC 全表删 | `sqlite-session-kkv.repository.ts:152,251,260,441`；`deferred-file-cache-gc.ts:36` |
| `kkv_entry` | 两个搬运任务的完成标记与 pending 标记；手动清理路径**直写 SQL** | `blob-binary-normalization.ts:309,412,435,683`；`message-content-compaction.ts:208,268,280,491,513,533`；`db-maintenance.service.ts:90` |
| `vfs_content_blob` | 归一任务的搬运源/目标（只 SELECT 主键+encoding+bytes，只 UPDATE bytes/encoding/byte_len） | `blob-binary-normalization.ts:159-165` |
| `chat_message` | 压缩搬运（`content_json != ''`）；blob 归一（`content_encoding`/`content_blob`） | `message-content-compaction.ts:161,391,428`；`blob-binary-normalization.ts:113,191-197` |

- 文件路径：本区**不直接触碰任何文件系统路径**，VACUUM/checkpoint 落在连接所指的库文件上，体积口径由
  app 层 `stat` 补（`apps/desktop/src/main/services/db-maintenance.service.ts:35`、`apps/mobile/src/services/db-maintenance.service.ts:37`）。
- 进程内缓存：写侧只进 `infra/content-cache` 的 `contentBodyPool`（键=明文 sha256，`sqlite-session-kkv.repository.ts:135,169,429,451`）。

## 依赖关系

**import 了谁**

- `domain/session-kkv/*` → `infra/tdbc/ports/connection.port`、`infra/sql-template`、`infra/tdbc/logic/template-helper`、
  `infra/tdbc/types`、`infra/content-cache/logic/decoded-content-cache`、
  `domain/vfs/content-store/logic/{hash-content,zlib-codec}`、`domain/workplace/logic/rule-snapshot-codec`。
- `infra/db-maintenance/impl/db-maintenance.service.ts` → `domain/session-kkv/logic/deferred-file-cache-gc`、
  `infra/tdbc/ports/connection.port`。
- `infra/db-maintenance/impl/blob-binary-normalization.ts` → `domain/kkv/repositories/impl/sqlite-kkv.repository`、
  `domain/vfs/content-store/logic/{blob-bytes-codec,zlib-codec}`、`./db-maintenance.service`。
- `infra/db-maintenance/impl/message-content-compaction.ts` → `domain/kkv/repositories/impl/sqlite-kkv.repository`、
  `domain/chat/logic/message-content-codec`、`./db-maintenance.service`。
- `infra/kkv/logic/parse-kkv-json-document.ts` → **零 import、零消费者**。

**被谁消费**

- `SqliteSessionKkvRepository` ← `service/session-kkv/create-session-kkv-service.ts:20`（再经
  `session.service.ts` / `project.service.ts` / workplace / 压缩·置位链路消费）。
- `runDeferredFileCacheGc` ← `session.service.ts:197`、`project.service.ts:196`（均在 delete 事务
  **提交后** await）、`db-maintenance.service.ts:66`（维护链路第 1 步）。
- `runBlobBinaryNormalization` ← `apps/cli/src/runtime.ts:191`（内联 await，无守卫）、desktop/mobile 各自的
  调度服务（fire-and-forget 循环）。
- `runMessageContentCompaction` ← `apps/cli/src/runtime.ts:187`、desktop/mobile 调度服务。
- `createDbMaintenanceService` / `runStartupMaintenanceOnce` ← desktop/mobile `db-maintenance.service.ts`；
  `runStartupMaintenanceOnce` 另被两个搬运任务内部调用（主入口导出仅被 core 测试消费）。

**依赖环**：`db-maintenance.service → deferred-file-cache-gc` 单向；`blob-binary-normalization` /
`message-content-compaction → db-maintenance.service` 单向。`db-maintenance.service` **刻意不反向 import**
两个任务的常量（会成环），故 F-7。

## 发现清单

### F-w8-ds-kkvstore-b-1 | P2 | `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:89-92`

```ts
await conn.execute(
  "DELETE FROM kkv_entry WHERE module = ? AND key = ?",
  ["nm-blob-binary", "startupMaintenancePending"]
);
```

手动「数据清理」成功后只清 `nm-blob-binary/startupMaintenancePending`，**没清**
`nm-message-content/startupMaintenancePending`。而 compaction 侧的注释明确声称会清：

> `message-content-compaction.ts:426-428`
> 「…最坏后果是下次冷启动多跑一次全库维护（纯浪费、无正确性损失）。**手动「数据清理」成功后
> db-maintenance 侧也会顺带清这个标记（advisory③ 方案 A）**。」

**描述**：文档与实现不一致。advisory③（`docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec.md:87`）
拍板时 pending 只有 `nm-blob-binary` 一个 key；后来 ic-01 方案 b 拆成两任务各自独立 pending key
（`cr-fix-spec-integration.md:553`），db-maintenance 侧没跟着扩。

**后果**：用户在压缩任务的 pending 标记残留期间点过一次手动清理（已经把 freelist 收干净了），下次冷启动
`runPendingStartupMaintenance` 仍会强制跑一遍 GC + checkpoint + VACUUM（desktop 上冻一次 main 事件循环）。
非正确性问题、一次性浪费。

**建议**：在 `runDatabaseMaintenance` 的同一个 try 块里补一条 DELETE（module 换成 compaction 侧常量，
或两条都删）；若坚持不改，至少把 `message-content-compaction.ts:426-428` 的注释改成事实描述。
**置信：confirmed**（两侧代码与 cr-fix-spec 原文均已核对）。

### F-w8-ds-kkvstore-b-2 | P2 | `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts:15`

```ts
export function parseKkvJsonDocument<T>(raw: string, decodeFn: (parsed: unknown) => T): T
```

**描述**：全仓 `rg` 零命中——没有生产调用方、没有测试引用、没有从任何 barrel 转出（`infra/kkv/` 下也没有
`index.ts`）。这是 `infra/kkv/` 目录的全部内容，等于一个只占位不干活的小目录。L0 工具产物已独立标出同一项
（`L0/dead-exports.md:1128`）。

**建议**：删文件 + 删空目录；若后续确要「KKV JSON 文档 decode 单源入口」，应先把既有散点读口收口上来再留。
**置信：confirmed**。

### F-w8-ds-kkvstore-b-3 | P2 | `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:354`

```ts
// pending 兜底放在最前：完成标记短路的稳态路径也要补跑（见函数注释）。
await runPendingStartupMaintenance(conn, options);
```

**描述**：`runPendingStartupMaintenance` 在入口**无条件**执行，早于 marker 短路、也完全不看
`options.shouldPause`。app 层的守卫是「循环入口查一次 + core 批间查一次」（desktop
`message-content-compaction.service.ts:76,82`），而 pending 补跑正好落在这两条检查之间的缝隙里：
守卫刚放行 → 进入 core → 立刻在 t≈0 触发全库 VACUUM。若此刻 Agent 起跑（desktop 侧
better-sqlite3 的 VACUUM 同步执行、会冻住 main 事件循环），Agent 首 token 会被这次补跑拖住。

**建议**：`runPendingStartupMaintenance` 进入前先判一次 `options.shouldPause?.()`，命中就整体跳过本轮
（pending 标记留在 kkv 里，下次冷启动自然补跑，语义无损）。
**置信：suspected**（窗口很窄——需要守卫检查与补跑之间恰好起跑；但代码路径确定无守卫，这一点是确定的）。

### F-w8-ds-kkvstore-b-4 | P2 | `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:121,137-141`

```ts
let startupMaintenanceRan = false;
…
if (startupMaintenanceRan) { return null; }
startupMaintenanceRan = true;
return await createDbMaintenanceService(conn).runDatabaseMaintenance();
```

**描述**：进程级布尔，两个维度都不复位——
① 失败不回滚（注释写明「失败不影响正确性」，但意味着同进程内**再也不会**有第二次自动维护尝试，
blob 侧只能靠 pending 标记等下次冷启动）；
② 不按连接维度隔离：desktop 备份导入 / 云同步 pull 触发 rebootstrap 换连接后，进程没换，
新回灌的库在本进程内拿不到任何启动维护（新库里的 freelist 页不会在这次会话里归还）。
两个搬运任务都靠 `result === null` 分支保留 pending 标记等下次冷启动，所以**不会丢兜底**，
但「同进程换库后一次 VACUUM 都不跑」是实打实的行为。

**建议**：把布尔换成 `WeakSet<TdbcConnection>`（或 `let ranConn: TdbcConnection | null`），
失败时把连接从集合里摘掉。改动面只有本函数，语义不变但能覆盖 ②。
**置信：confirmed**（代码事实确定；①是有意的，②未见于任何文档，属遗漏）。

### F-w8-ds-kkvstore-b-5 | P2 | `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:352-356, 481-484, 496-498`

```ts
let statusSamplingThrottleCache = new WeakMap<TdbcConnection, { at: number; value: BlobBinaryStatus }>();
…
const cached = statusSamplingThrottleCache.get(conn);
if (cached != null && Date.now() - cached.at < STATUS_SAMPLING_THROTTLE_MS) { return cached.value; }
…
if (counted) { statusSamplingThrottleCache.set(conn, { at: Date.now(), value: status }); }
```

**描述**：节流命中时 `return cached.value` —— 返回的是**缓存里那个对象本身**（含 `tables` 数组与其行对象），
不是副本。desktop 侧做了防御（`db-maintenance.service.ts:84` `{...row}` 逐行摊平），
**mobile 侧只摊平了数组、行对象是共享引用**（`apps/mobile/src/services/db-maintenance.service.ts:55`
`[...(await getBlobBinaryStatus(conn)).tables]`）。当前两端都按 `readonly` 使用、没人改，风险低；
但这是「core 返回内部可变状态」的隐性契约，将来任一端在渲染前给行对象挂字段就会跨调用串值。

**建议**：命中时返回 `{ tables: cached.value.tables.map((r) => ({ ...r })) }`，或把类型收紧成
`Readonly<BlobBinaryStatus>` 之外再加一层冻结。低成本，值得顺手做。
**置信：suspected**（当前无实际 bug，是隐患）。

### F-w8-ds-kkvstore-b-6 | P3 | `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:481-484`

**描述**：注释写「缓存检查放在『首次遇到标记未置的表』处」，但检查写在 `for` 循环体内、三张未置表各查一次。
因为 `set` 在循环**之后**（:496-498），同一轮内后两次必然 miss——功能上无害（每张表本来就要各 COUNT 一次），
只是注释与实现不完全对齐，容易让后来人以为「一轮只查一次」。

**建议**：要么把检查提到循环外（首次遇到未置表时 break-out 整轮回放缓存值），要么把注释改成
「每张未置表各查一次；本轮缓存写在循环后，故同一轮内必然 miss 是预期行为」。
**置信：confirmed**。

### F-w8-ds-kkvstore-b-7 | P3 | `packages/core/src/infra/db-maintenance/impl/db-maintenance.service.ts:90-91`（对照 `db-maintenance.service.ts:84-87` 注释）

**描述**：为避开循环依赖，module/key 用字面量硬编码，与 `BLOB_BINARY_KKV_MODULE` /
`STARTUP_MAINTENANCE_PENDING_KEY` 两处常量重复。同理 `MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY`
虽然 `export const` 了，但既没从 `infra/db-maintenance/index.ts` 转出、也没进主入口 allowlist，
只有 core 测试走深路径 import（`test/infra/message-content-compaction.test.ts:34`）——
「想被 db-maintenance 复用」这件事在结构上做不到。

**建议**：把三对 module/key 字面量提到一个无依赖的小模块（如 `infra/db-maintenance/impl/pending-keys.ts`），
三边共用，环就不存在了。属重构，不紧急。
**置信：confirmed**。

### F-w8-ds-kkvstore-b-8 | P3 | `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:507-509`（对照 `blob-binary-normalization.ts:734-740`）

```ts
// blob 侧：刻意**没有** `(result.done && result.failedCount > 0)` 这一支（cr-25 删除，勿补回）
processedAny = processedAny || result.normalizedCount > 0;
```

**描述**：两个姊妹任务口径不一致——blob 侧有 `processedAny` 门（零改写不跑 VACUUM），compaction 侧
置完成标记后**无条件**进维护段。一张 `content_json` 里全是编码失败坏行的库，会在置完标记后白跑一次
全库 VACUUM（零页释放）。

**建议**：compaction 侧对齐加一个 `processedAny`（记 `result.changes > 0`），并在 catch 里保留
pending 标记兜底（现有 catch 已会写）。注意别踩 RULE.md:82 记的那个坑——「零推进」的正向路径
在本进程不可观测，要单开测试文件。
**置信：confirmed**。

### F-w8-ds-kkvstore-b-9 | P3 | `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts:219-223`

```ts
failedCount:
  typeof parsed.failedCount === "number" && Number.isFinite(parsed.failedCount)
    ? parsed.failedCount : 0,
```

**描述**：两侧标记解析的校验强度不同。blob 侧是 `Number.isInteger(...) && >= 0`
（`blob-binary-normalization.ts:317-322`，注释明确说「负数/小数透传会让 UI 渲染出 nonsense」），
compaction 侧只判 `Number.isFinite`，`-3` 与 `1.5` 会原样透传。

**描述（续）**：更关键的是这条数据**根本没有出口**——`MessageCompactionStatus`（:89-94）根本没有
`failedCount` 字段，而两端调度循环都只看 `done` / `stalled`，把 `MessageCompactionRunResult.failedCount`
直接丢掉（`apps/mobile/.../message-content-compaction.service.ts:58-69`、
`apps/desktop/.../message-content-compaction.service.ts:94-105`）。
所以「有坏行需人工关注」这个信号在压缩任务侧是写进去就再也没人读出来的死数据。

**注**：`MessageCompactionStatus` 无 `failedCount` 是**有意的**（`apps/mobile/__tests__/storage-config-migration-values.test.ts:10`
「BlobBinaryTableStatus 携带 failedCount；MessageCompactionStatus 无此」；spec `ic-36g`「两端有意不设
messageContent 状态行」）。要报的是**校验强度不一致** + **run 结果被丢弃**这两点。

**建议**：把 compaction 的解析校验收紧到与 blob 侧同款；若要真正暴露坏行信号，给
`MessageCompactionStatus` 补 `failedCount` 并让存储页出第三态（属产品决策，先登记）。
**置信：confirmed**（字段缺失是有意的；校验强度与结果丢弃不是）。

### F-w8-ds-kkvstore-b-10 | P3 | `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts:123-131`

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

**描述**：上面 :87 已经声明并投入使用 `SESSION_KKV_DOMAIN_USAGE_STATS`，联合类型里却漏了这一支。
因为末尾有 `(string & {})` 兜底，编译器不会报错，纯粹是类型漂移。（顺带：L0 已记录
`SessionKkvDomain` 本身是零消费者导出。）

**建议**：补上 `| typeof SESSION_KKV_DOMAIN_USAGE_STATS`。**置信：confirmed**。

### F-w8-ds-kkvstore-b-11 | P3 | `packages/core/src/domain/session-kkv/logic/deferred-file-cache-gc.ts:33-40`

```sql
DELETE FROM session_file_cache_blob WHERE content_hash NOT IN (
  SELECT content_hash FROM session_file_cache_entry WHERE content_hash IS NOT NULL)
```

**描述**：单条不分批的全表 DELETE + 全表引用子查询，触发点是**每一次会话删除**、**每一次项目删除**
（`session.service.ts:197`、`project.service.ts:196`）以及**每一次启动期/手动维护链路**
（`db-maintenance.service.ts:66`）。`idx_session_file_cache_hash` 帮得上引用集侧，但 blob 侧仍是全表扫。
两个搬运任务都刻意做了「批 ≤100 + 批间让步」来保护事件循环，这里没有对等保护——
启动维护里 VACUUM 本来就同步阻塞，这一段全表扫是叠加在同一段冻结窗口里的。

**建议**：给 GC 加一个可选的批次上限（如每轮 ≤2000 行），调用方循环直到 `changes === 0`；或至少在
维护链路的 GC 前加注释说明该段是同步阻塞的一部分。**置信：confirmed**（触发点与无分批是确定的；
具体耗时未实测，按「需人工关注」而非「已知慢」登记）。

### F-w8-ds-kkvstore-b-12 | P3 | `packages/core/src/domain/workplace/logic/rule-snapshot-codec.ts:97-116`（经 `sqlite-session-kkv.repository.ts:183` 消费）

**描述**：`parseFileCachePayload` 只挑 `{ body, mtimeMs }` 两个字段返回，多余字段被丢弃、键序被归一化到
`body` 在前。因此 `sqlite-session-kkv.repository.ts` 的注释「用 serializeFileCachePayload 还原出与 set 时
**逐字节相同**的 JSON 字符串（键序固定）」只在「所有 set 的 value 都由 serializeFileCachePayload 产出」
这一前提下成立；若手写 `set(..., JSON.stringify({ mtimeMs, body }))`，`get` 回来的字符串键序不同、
多余字段丢失。仓储本身有兜底（value 解析不出 payload 形态 → 整条退旧表存储，逐字节还原），
所以这条只在「形态合法但键序/字段不同」时才会出现。

**建议**：要么在 `parseFileCachePayload` 里保留原串（多返回一个 `raw`），要么把仓储注释里的
「逐字节相同」限定条件写明。**置信：confirmed**（行为确定；触发前提未实测）。

### F-w8-ds-kkvstore-b-13 | P3 | `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts:552-570`

```ts
const rows = await conn.query<{ content_hash: string; encoding: string; bytes: SqlValue }>(
  adapter.selectSql, [cursor]);
…
const record = row as unknown as Record<string, unknown>;
const primaryKey = String(record[adapter.primaryKeyColumn]);
```

**描述**：行类型对 `messageContent` 适配器是**假的**——该适配器的 SELECT 走
`SELECT id, content_encoding AS encoding, content_blob AS bytes`（:191-194），主键列是 `id` 而不是
声明的 `content_hash`。运行时靠 `as unknown as Record<...>` + 动态取列名绕过了类型检查，所以现在能跑；
但任何将来基于 `row.content_hash` 的改动都会静默拿到 `undefined`。

**建议**：把行类型改成 `{ [k: string]: SqlValue }`（或给适配器补一个 `selectRowType` 形状），
让「主键列名由适配器给出」这件事在类型层也成立。**置信：confirmed**。

### F-w8-ds-kkvstore-b-14 | intentional | 见下

以下几处看着像缺陷、实为拍板设计，**不计问题**，登记出处供 reduce 阶段免重复上报：

| 观察点 | 判定 | 出处 |
|---|---|---|
| 搬运任务不注册 schema migration，只靠谓词 + KKV 标记跨启动续跑 | intentional | `docs/apm/RULE.md:109`（「空占位禁令 + bootstrap 单事务同步」） |
| `runStartupMaintenanceOnce` 是模块级布尔且失败不回滚 | intentional（连接维度不隔离的部分见 F-4） | `db-maintenance.service.ts:128-130` + `docs/Iterations/binary-blob-and-vfs-pack/cr-fix-spec.md` NF-1（为让「标记真被清」这条正向路径可观测，被迫接受进程级污染） |
| `beforeMaintenance` 早于 `runStartupMaintenanceOnce` 调用（即使会被去重短路） | intentional | `cr-fix-spec.md:537`（「`maintCalls` = 进入收尾维护段的次数，不代表 VACUUM 真跑」） |
| 坏行（base64 解码 / 正文编码失败）不阻断完成标记、只计数 | intentional | `blob-binary-normalization.ts:39-43`、`message-content-compaction.ts:132-138` |
| 归一谓词用 `TYPEOF(bytes)='text'` 兜「encoding=zlib 但存的是文本」的脏形态 | intentional | `blob-binary-normalization.ts:102-105` |
| `clearDomain` / `clearSession` 只删引用行不删 blob，交给 GC | intentional | `sqlite-session-kkv.repository.ts:297-298,353-355`、`deferred-file-cache-gc.ts:11-18` |
| `set` 先写 blob 再写 entry、不包事务（崩了留孤儿 blob 不留悬空引用） | intentional | `sqlite-session-kkv.repository.ts:244-246` |
| CLI 每条命令内联 await 两个任务，最坏合计 ~120s | intentional（已知代价） | `apps/cli/src/runtime.ts:184-191` |
| 状态采样 3s 节流（含「命中回放整轮旧值」） | intentional | `blob-binary-normalization.ts:342-358`（ic-06①）、`message-content-compaction.ts:166-172` |
| `MessageCompactionStatus` 不带 `failedCount`（两端形状不统一） | intentional | `cr-fix-spec.md` ic-36g / `cr-22 ①` |

## 争议与存疑

1. **F-1 算不算 bug**：实现只清一个 key，而 compaction 侧注释声称两个都清。查 `cr-fix-spec.md:87`，
   advisory③ 拍板时 pending 确实只有一个 key（`nm-blob-binary`），所以**不是漏做修复，而是注释没跟上
   后续的 key 拆分**。我按 P2 记（文档说了但没做，后果是一整轮全库 VACUUM），但如果 reduce 阶段认为
   补偿标记的清理本就只对 blob 侧有拍板依据，可以降级到 P3 并改成纯文档项。

2. **F-3 的窗口有多宽**：需要「app 层守卫刚放行 → core 入口 → pending 标记存在 → Agent 恰好此刻起跑」
   四件事叠加。desktop 上 VACUUM 会冻 main 事件循环，但 Agent 的 run 是在 renderer 侧发起的，
   窗口不是零。**我没有实测复现**，按 suspected 记。

3. **F-11 的严重度未定**：`runDeferredFileCacheGc` 的实际耗时我没在真库上量过（规范要求数字必须实测，
   这里就不给数字）。如果 file_cache blob 行数量级只有几千，全表扫在毫秒级，F-11 应降到「仅注释」；
   如果是几万行且在 desktop main 上，就得按 P2 处理。**建议 W6 验证代理实测一次**。

4. **F-4② 是否有意**：desktop rebootstrap 后「同进程不再自动维护」在任何文档里都没出现过；
   但 blob/compaction 两侧都靠 `result === null` 保留 pending 标记，说明设计者意识到进程级去重会短路，
   只是把补救推给了「下次冷启动」。也就是说这条**可能是有意的取舍**，只是没人写下理由。
   我按 P2 记为「遗漏文档 + 可低成本修」，但这一条最容易在 reduce 阶段被辩护掉。

5. **本机位与 A 机位的覆盖重叠面**：两个后台搬运任务 + db-maintenance 维护链路在同一 zone，
   建议 L2 reduce 时把 `blob-binary-normalization.ts` / `message-content-compaction.ts` 归为单一
   「搬运任务族」处理，避免两机位各报一半的兄弟口径问题（尤其 F-8 这种「一侧有门、一侧没门」）。