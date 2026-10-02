---
zone: w9-checkpoint-pro
agent: 检察官（对抗机位·猎杀冗余/死路径/数据丢失风险/竞态）
files_scanned: 18（zone 内全量）+ 8（消费方定点核实）
head_sha: 9ca5f5ad
---

# w9-checkpoint-pro 报告

## 摘要

`packages/core/src/domain/message-checkpoint/` 是「消息级文件树检查点」域：agent 每条带改写工具的消息落一条锚点行
（`message_checkpoint`）+ 一份 capture 时点的文件指针快照（`message_checkpoint_file`，指向 `vfs_entry.entry_id` +
`head_version` + path 快照）。它给回滚提供 target tree，给 revision GC 提供 ref_count 可达集，给 baseline backfill 提供
「空窗消息补点」。域内 15 个 logic + 1 model + 1 port + 1 sqlite 实现，共 2270 行。整体实现质量高、口径注释密，
但存在 **1 处跨 entry 内容串味隐患**、**1 处大批量 IN 子句未分块**、**1 处非原子删除路径**，以及一批死代码/死接口。

## 职责与边界

- **capture**（写）：`backfill-baseline-checkpoints.ts` / `sqlite-message-checkpoint.repository.ts:insertCheckpoint` /
  `seedCheckpoints`。锚点语义 = 「该消息完成时的工作区文件树」。
- **回滚解析**（读）：`resolve-rollback-anchor.ts`（点击消息 → 回合边界锚点）、`resolve-target-tree.ts`（锚点树 /
  prior 树）、`resolve-reconcile-paths.ts`（筛「必写盘 / 必删」）、`detect-missing-revisions.ts`（回滚前体检）。
- **回滚执行**：`restore-path.ts`（正向 restore，含 revive 委派）、`revive-deleted-entry.ts`（物理删 entry 原位复活）、
  `backfill-missing-revision.ts`（缺 revision 行补占位）、`ensure-directory-chain.ts`（父目录链幂等 mkdir）。
- **GC**：`revision-gc.ts`（scoped + 全局孤儿两段）、`deferred-revision-orphan-gc.ts`（回滚链 deferred 兜底）。
- **截断**：`truncate-tail-in-transaction.ts`（回滚 / 批量删共用的 tail 截断事务）。
- **不在本域**：ref_count 的加减实现（`domain/vfs/logic/revision-ref-count.ts`）、消息删除（`domain/chat`）、
  回滚编排（`service/message-checkpoint/impl/message-rollback.service.ts`）——本报告仅在解释本域行为时引用。

## 对外接口

| 符号 | 位置 | 生产消费方 |
|---|---|---|
| `backfillBaselineCheckpoints` / `decideBackfillShortCircuit` / `createBaselineCheckpointBackfillOperation` | `logic/backfill-baseline-checkpoints.ts:139/69/220` | `service/message-checkpoint/impl/message-checkpoint.service.ts`、integrity-repair |
| `resolveRollbackAnchorMessage` | `logic/resolve-rollback-anchor.ts:50` | `message-rollback.service.ts:352` |
| `resolveRollbackTargetTree` / `resolvePriorRollbackTargetTree` | `logic/resolve-target-tree.ts:46/77` | `message-rollback.service.ts:403/371` |
| `resolveReconcilePathSets` | `logic/resolve-reconcile-paths.ts:32` | `message-rollback.service.ts:416` |
| `findMissingRevisionPointers` | `logic/detect-missing-revisions.ts:23` | `message-rollback.service.ts` |
| `restorePathToRevision` / `restorePathToRevisionWithBackfill` | `logic/restore-path.ts:98/231` | `message-rollback.service.ts:572/584` |
| `reviveDeletedEntryForRestore` | `logic/revive-deleted-entry.ts:48` | 仅 `restore-path.ts:137/190` |
| `sweepSessionRevisions` / `scheduleDeferredRevisionOrphanGc` | `logic/revision-gc.ts:55`、`logic/deferred-revision-orphan-gc.ts:55` | `truncate-tail-in-transaction.ts:76`、`message.service.ts:254`、`message-rollback.service.ts:295` |
| `truncateTailInTransaction` | `logic/truncate-tail-in-transaction.ts:58` | `message-rollback.service.ts:239`、`message-transcript-effects.service.ts:70` |
| `listSessionFileHeads` | `logic/list-session-files.ts:16` | capture / backfill / reconcile / fork seed |
| **无生产消费方**：`revisionReachableKey`、`loadFileTree`、`listDistinctCheckpointPointersForSession`、`ensureDirectoryChain` 的 re-export、`MessageCheckpointService.release?` | 见 F-5/F-6/F-12 | 仅测试或零引用 |

## 数据访问

| 表 / 域 | 读 | 写 | 证据 |
|---|---|---|---|
| `message_checkpoint` | `hasCheckpoint` / `hasAnyCheckpointForSession` / `countCheckpointsForMessages` / `findCheckpointMessageIdAtOrBefore` | insert / delete | `sqlite-message-checkpoint.repository.ts:88-135, 313-330, 390-463` |
| `message_checkpoint_file` | `loadFilePointerTree`（LEFT JOIN `vfs_entry`）、`listFilePointersForSession`、`listFilePointersForMessages`、`listDistinctCheckpointPointersForSession` | insert（多值分块 900 变量）/ delete | 同上 `:41, 184-193, 227-242, 271-311, 332-388` |
| `vfs_entry`（读） | `listFileHeadsUnderPrefix`（`entry_kind='file'`，见 `sqlite-vfs-entry.repository.ts:672`）、`findByPath`、`reviveEntryAtVersion` | — | `logic/list-session-files.ts:22`、`revive-deleted-entry.ts:92,113` |
| `vfs_revision`（ref_count） | `findMeta(s)ByEntryVersions`、`existsByEntryAndVersion`、`findByEntryAndVersion` | `append` + `adjustRef(±1)`、`deleteGlobalOrphans` | `backfill-missing-revision.ts:60-79`、`revision-gc.ts:70-81` |
| KKV 域 `backfill_cursor` | `decideBackfillShortCircuit` 读 `lastScannedCount` | service 层写；删除路径 `clearDomain` | `backfill-baseline-checkpoints.ts:77-81`、`truncate-tail-in-transaction.ts:90-93` |
| KKV 域 `file_cache` / `user_vfs_pending` | — | tail 截断时清空 | `truncate-tail-in-transaction.ts:94-96` |

表结构要点（`bootstrap/message-checkpoint/message-checkpoint-schema.ts:13-37`）：两张表均 `WITHOUT ROWID`；
`message_checkpoint` PK `(session_id, message_id)`（故 `COUNT(*)` 计数等价性成立）、`message_checkpoint_file` PK
`(session_id, message_id, entry_id)`、末列 `path TEXT NULL`（存量行 NULL）。

## 依赖关系

**import 了**：`domain/vfs/logic/{vfs-path-mapper, revision-ref-count, revision-pair-key, vfs-move, parent-dir}`、
`domain/vfs/repositories/*`、`domain/chat/repositories/message.port`、`domain/session-kkv/*`、`infra/tdbc/*`、
`infra/sql-template`、`errors/*`。**不 import** 任何 service（`backfill-baseline-checkpoints.ts:20` 的
`IntegrityRepairOperation` 是 type-only import，无运行时环）。

**被谁消费**：`service/message-checkpoint/impl/{message-checkpoint.service, message-rollback.service}`、
`service/chat/impl/{message.service, message-transcript-effects.service}`、`domain/chat/logic/seed-fork-copy-parity.ts:135`、
`service/session-fs/create-session-fs-service.ts:71`、`domain/vfs/logic/revision-ref-count.ts:113`。

## 发现清单

### F-w9-checkpoint-pro-1 | P2 | `logic/backfill-missing-revision.ts:49-67`

```ts
const entry = await deps.entryRepo.findByPath(scopeKey, logicalPath);
...
if (entry != null && entry.entryKind === "file") {
  const contentHash = await deps.entryRepo.findContentHash(scopeKey, logicalPath);
  ...  await deps.revisionRepo.append({ entryId, version: targetVersion, content: null, contentHash, ... });
```

**描述**：该函数同时接收 `logicalPath` 和 `entryId`，但**从不校验二者指向同一个 entry**。唯一会传错配组合的调用方是
本域 `restore-path.ts:278-279`：

```ts
const diverged = cpEntryId != null && entryId != null && cpEntryId !== entryId;
const backfillEntryId = diverged ? cpEntryId : entryId ?? cpEntryId;
```

diverged（同路径删除后重建）或 entry 已删时，`backfillEntryId` 是 **checkpoint 的旧 entryId**，而函数体里
`findByPath(logicalPath)` 拿到的是 **live 新 entry**。结果是：把 live 新文件的 `contentHash` 写进旧 entryId 的 revision 行，
且 `contentStore.ensureBlob(contentHash, null)`（`:57-59`）把这份内容**固化为可解**。随后 restore 走
`reviveDeletedEntryForRestore`（`restore-path.ts:137/190`），`rev.content != null` 成立 → **旧 entry 被复活成 tail 期新文件的
内容**，正是本域注释（`restore-path.ts:276-278`）「不给 live 新 entry 伪造占位行」想避免的那件事。
另：即使走到 deleted 分支也已在旧 entryId 上凭空造出一条墓碑行，`ref_count` 各 +1 永不回收（`repairRefCounts` 只上调不下调，
`revision-ref-count.ts:136 batchRepairRefCountFloor`）。
**建议**：函数入口加 `if (entry != null && entry.entryId !== entryId) → 只按 deleted 墓碑语义处理（或直接 return false 交给
restore 抛 restore-missing）`，不要拿 live 路径的 hash 去填别的 entry。
**置信**：confirmed（代码事实）／suspected（触发需要旧 entry 的目标 revision 行真缺——纯删除场景行还在，故属窄路径）。

### F-w9-checkpoint-pro-2 | P2 | `repositories/impl/sqlite-message-checkpoint.repository.ts:398-431`

```ts
const inClause = messageIds.map((_, i) => `#{id${i}}`).join(", ");
... `... AND message_id IN (${inClause})`
```

**描述**：三个按消息集合读写的 repo 方法（`countCheckpointsForMessages:128-130`、`listFilePointersForMessages:382-384`、
`deleteCheckpointsForMessages:401/422/429`）把**整个入参数组**展开进单条 SQL 的变量位，**没有任何分块**。而同文件
`insertMultiValues` 恰恰是按 900 变量分块的（`:41, 59-62`），邻域 `sqlite-vfs-entry.repository.ts:171` 的
`findContentHashesByPaths` 也是硬编码 chunkSize=200——说明「SQLite 变量上限」在本仓是被认真对待过的约束，唯独这三条漏了。
触发面随 tail 规模线性增长：`truncate-tail-in-transaction.ts:64-67`（`listIdsAfterSeq` 全 tail）、
`message-rollback.service.ts:427-431`（tailMessageIds）、`message.service.ts:444-455`（整会话 id 全集）。
超过驱动上限（better-sqlite3 ^11.10 打包 SQLite 3.4x → 32766；老 quick-sqlite 回退驱动为 999）时直接抛
"too many SQL variables"，**回滚 / 截断整体失败**。
**建议**：三条路径统一复用 `insertMultiValues` 那套分块常量（抽出 `chunkByVarLimit`），或按 messageId 分批 + 汇总。
**置信**：confirmed（无分块为代码事实）／suspected（实际越界阈值取决于驱动版本，需在 L0 层实测确认）。

### F-w9-checkpoint-pro-3 | P2 | `repositories/impl/sqlite-message-checkpoint.repository.ts:411-431`

```ts
if (fileRows.length > 0) { await decrementRefsForCheckpointFiles(...); }
await executeTemplate(... `DELETE FROM message_checkpoint_file ...`);
await executeTemplate(... `DELETE FROM message_checkpoint ...`);
```

**描述**：`deleteCheckpointsForMessages` 是「先减 ref_count、再删行」的三条独立语句，**自身不包事务**，原子性完全依赖调用方。
仓内三条调用方里，`message.service.ts:253`（delete 单条）、`:455`、`:487`（truncateAfter）都在 `conn.transaction` 内，
`truncate-tail-in-transaction.ts:67` 由 `createTruncateTailDepsFromTx(tx)` 保证——这几处是安全的。但
`message-checkpoint.service.ts:145-148` 的 `release()` **裸用 `this.deps.conn`** 调本方法。崩溃/异常落在 decrement 与
DELETE 之间 → checkpoint 行还在、ref_count 已被减 → 该 revision 归零被 GC 删掉 → 日后回滚命中
`sessionFsRestoreRevisionMissing`（`restore-path.ts:160/203/220`）整条回滚失败。
**建议**：要么把 decrement+DELETE 收进 `conn.transaction`，要么在 port 注释里写死「必须事务内调用」并删掉裸调用的 `release`（见 F-12）。
**置信**：suspected（`release` 当前零生产调用方，风险靠未来复用者踩到；`repairRefCounts` 只能上调 ref_count，救不回已删的 revision 行）。

### F-w9-checkpoint-pro-4 | P2 | `logic/truncate-tail-in-transaction.ts:87-97` vs `service/chat/impl/message.service.ts:479-489`

```ts
// truncate-tail-in-transaction.ts（回滚 / 批量删共用）
await deps.sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_BACKFILL_CURSOR);
for (const domain of SESSION_KKV_COMPOSER_STATUS_DOMAINS) { await deps.sessionKkv.clearDomain(sessionId, domain); }
```

**描述**：仓内存在**两份 tail 截断实现**。`message.service.ts:truncateAfter` 自己内联了
「清 backfill 游标 → deleteCheckpointsForMessages → deleteAfterSeq」，但**没有 sweepSessionRevisions**（`delete` 路径有，
`:254-261`），也**没有清 `SESSION_KKV_COMPOSER_STATUS_DOMAINS`**（含 `file_cache`、`user_vfs_pending`，
`session-kkv-domains.ts:109-112`）。同一个「截断 tail」语义在两条入口下产出不同的缓存/ref 状态，属于典型的实现漂移面。
**建议**：`truncateAfter` 改调 `truncateTailInTransaction`（接线点已存在：`service/message-checkpoint/truncate-tail-wiring.ts:20`），
或至少把「是否清 composer 域 / 是否 sweep」抽成显式参数由调用方声明。
**置信**：confirmed（两份实现语义不一致为代码事实）／suspected（对用户的实际影响取决于 `truncateAfter` 的调用方，desktop/mobile 端使用情况未在本机位核实）。

### F-w9-checkpoint-pro-5 | P3 | `logic/revision-gc.ts:23-26` + `:55-63`

```ts
export function revisionReachableKey(entryId: number, version: number): string {
  // 保留供 seed-fork / 测试代码复用，不再在本模块内部使用。
  return revisionPairKey(entryId, version);
```

**描述**：两个死件。①`revisionReachableKey` 是 `revisionPairKey` 的同名转发，注释自承「不再在本模块内部使用」，
`git grep` 全仓只有 `packages/core/test/message-checkpoint/revision-gc.test.ts:66` 一处引用——**该测试断言的是
`revisionPairKey` 的行为，穿了个马甲测**，对本模块零覆盖价值。②`sweepSessionRevisions` 的 6 个参数里
`_entryRepo` / `_checkpoints` / `_conn` 三个已完全不用（`:33` 注释自承「仅保留原签名以兼容调用方」），
但 6 个调用方（`truncate-tail-in-transaction.ts:76`、`message.service.ts:254` 等）仍在逐个传 `undefined` 占位。
**建议**：删 `revisionReachableKey` 及其测试；`sweepSessionRevisions(revisionRepo, projectId, sessionId, options)` 收窄签名，
一次性改掉 6 处调用点。
**置信**：confirmed。

### F-w9-checkpoint-pro-6 | P3 | `repositories/message-checkpoint.port.ts:97-100, 131-138`

**描述**：`loadFileTree`（生产零调用，仅 `packages/core/test/**` 8 处）与
`listDistinctCheckpointPointersForSession`（生产零调用，仅 2 处测试）仍在 port 上占位。两者都是
`loadFilePointerTree` / `listFilePointersForSession` 的降维投影——**在生产侧它们表达的是同一份数据的两种形状**，
属于把测试便利性固化进了持久层契约。`MessageCheckpointDistinctPointer` 类型同样只服务这两个测试。
**建议**：生产调用方一律迁到 `loadFilePointerTree`（`.tree` 视图一行 map 即可），然后把这两个方法与
`MessageCheckpointDistinctPointer` 从 port 撤下、测试改用底层方法拼装。
**置信**：confirmed（`git grep` 全仓 `packages` + `apps` 无生产引用）。

### F-w9-checkpoint-pro-7 | P3 | `repositories/impl/sqlite-message-checkpoint.repository.ts:298-309`

```ts
const path = row.snapshot_path ?? row.live_path;
if (path == null) { continue; }
tree.set(String(path), { path: String(path), entryId: ..., revisionVersion: ... });
```

**描述**：Map 以「解析后的 path」为 key、**后写覆盖**，而 PK 是 `(session_id, message_id, entry_id)`——**path 上没有唯一性约束**。
当同一 checkpoint 内两行解析出同一个 path 时（可行组合：A 行有 path 快照 `old.md`；B 行快照为 NULL、其 entry 现路径已被 rename 成
`old.md`），B 会静默覆盖 A，`targetTree` 丢掉一个文件指针 → 回滚时该路径不被写盘、也不被判定需删除。
**建议**：`tree.set` 前检测 `tree.has(path)`，冲突时保留 revisionVersion 较小者（= 更早的检查点态）并打 warn；
或在 DDL 增补 `UNIQUE(session_id, message_id, path)` 前的过渡期至少留日志。
**置信**：suspected（需「存量 NULL 快照行 + entry rename」叠加，窄但无任何防护）。

### F-w9-checkpoint-pro-8 | P3 | `logic/restore-path.ts:245-257`

```ts
const liveEntryIdEarly = prefetch?.entryIdByPath?.get(logicalPath) ?? null;
const divergedEarly = cpEntryIdEarly != null && liveEntryIdEarly != null && cpEntryIdEarly !== liveEntryIdEarly;
if (!divergedEarly && liveHeadByPath?.get(logicalPath) === version) {
  return { backfilled: false, outcome: "skipped_same_version" };
}
```

**描述**：diverged 判定**只认 prefetch**，prefetch 未注入时 `liveEntryIdEarly` 恒 null → `divergedEarly` 恒 false →
在尚未解析 live entryId 的情况下就按「同版本」短路。两个不同 entry 的版本空间互相独立（这正是 `:243-244` 注释承认的前提），
「同号版本」不代表同内容，于是本该走墓碑+复活的 diverged 路径被静默跳过。生产唯一调用方
（`message-rollback.service.ts:542-547`）两个 prefetch 字段都注入了，**当前不可达**；但 `restorePathToRevision`
本体（`:130-149`）是先把 diverged 判完再短路，语义正确——两处口径不一致本身就是隐患。
**建议**：`prefetch == null` 时不做 early short-circuit，直接下探（与 `restorePathToRevision` 对齐）。
**置信**：confirmed（口径不一致）／当前生产不可达。

### F-w9-checkpoint-pro-9 | P3 | `logic/backfill-baseline-checkpoints.ts:114`

```ts
const segment = await messageRepo.listBySessionOffset(sessionId, cursor);
```

**描述**：同一文件 `:156` 与 `:249` 都刻意改用 `listMessageHeadersBySession` 来避开「全会话正文解压」（`:152-155` 明说是
2026-09-30 实锤的性能主源），但两段式判定的第二段却走了**全字段**的 `listBySessionOffset`，把新增段正文又解了一遍。
段通常很小（一个回合 2 条）所以不致命，但这与本模块自己的性能论证自相矛盾，将来新增段变大时这条会先炸。
**建议**：给 message port 加 `listMessageHeadersBySessionOffset`（或让 `listBySessionOffset` 支持 header 投影）。
**置信**：confirmed（代码事实）／影响 suspected。

### F-w9-checkpoint-pro-10 | P3 | `logic/backfill-baseline-checkpoints.ts:165-177`

```ts
for (let i = messages.length - 1; i >= 0; i--) {
  if (signal?.aborted === true) { return { confirmedNoGap: false }; }
  const has = await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id);
```

**描述**：倒序找「最后一个有 checkpoint 的消息」是**每条消息一次单行 SELECT**，全会话 O(N) 次 IO。
两段式短路只在「新增段已被全覆盖」时生效；一旦出现真实空窗（纯文本对话尾部 assistant 无源头建点，`:60-63` 自己承认这是常态），
每次发送前的 backfill 阶段都要付这 N 次查询——而 backfill 挂在用户发送的关键路径上（`message-checkpoint.service.ts:86`
包的事务内）。同一文件的 `createBaselineCheckpointBackfillOperation.detect()`（`:254-263`）有一份**逐字重复**的倒扫。
**建议**：一次性 `SELECT message_id FROM message_checkpoint WHERE session_id=? ORDER BY ...` 取集合，
或沿用 `findCheckpointMessageIdAtOrBefore(sessionId, MAX(seq))` 一条查询定位尾锚点（该方法 `:313-330` 已存在且带 JOIN 优化）。
**置信**：confirmed。

### F-w9-checkpoint-pro-11 | P3 | `logic/restore-path.ts:32-36`

```ts
export { ensureDirectoryChain } from "./ensure-directory-chain.js";
export type { RestorePathOutcome, RestorePathPrefetch } from "./restore-path-model.js";
```

**描述**：转发桶零消费方——`ensureDirectoryChain` 的真实调用方都直接 import 自 `./ensure-directory-chain.js`
（`restore-path.ts:217`、`revive-deleted-entry.ts:112`），两个类型的消费方也全部直接 import 自 `restore-path-model.js`
（含测试 `rollback-reach-hash-batch.test.ts:6`）。这是 module 拆分过程中留下的过渡转发，属纯冗余导出面。
**建议**：删 `:32-36`。
**置信**：confirmed。

### F-w9-checkpoint-pro-12 | P3 | `service/message-checkpoint/message-checkpoint.port.ts:56`

**描述**：`release?(sessionId, messageId)` 是**可选方法**，实现见 `message-checkpoint.service.ts:145-148`，
但 `git grep` 全仓（`packages` + `apps`，含测试）**零调用方**。它同时是 F-3 里那条「裸连接非原子删 checkpoint」路径的载体，
留着只会诱导后来者踩非原子删除。
**建议**：删除 port 声明与实现（真要用走 `message.service` 已有的事务内路径）。
**置信**：confirmed。

### F-w9-checkpoint-pro-13 | intentional | `logic/backfill-baseline-checkpoints.ts:103-111`

```ts
if (count === cursor) { return { kind: "short-circuit", newCursor: cursor, previousCursor: cursor }; }
if (count < cursor) { return { kind: "full-scan", count }; }
```

**描述**：这是本机位**重点攻击**的靶心——「回滚物理删尾 + 新消息复用 seq」会不会让 `count === cursor` 把「有缺口」误判成
「已确认无空窗」，导致空窗永远补不上（数据丢失：回滚到缺口消息时 targetTree 取到错误的更早树）。
逐条核实结论是**防线闭合**：`truncate-tail-in-transaction.ts:88-93` 明写「发生删除即清 backfill 游标（seq 复用防线）」，
`message.service.ts:249-252`（delete 单条）、`:451-454`（整会话清空）、`:483-486`（truncateAfter）三条删除路径同样清域；
`truncateAfter` 的 `tailIds.length === 0` 早退分支（`:473-477`）不清理是**正确的**——没有删除就不需要清。
计数口径也一致：`countBySession`（COUNT(*) 含 hidden）与 `listBySessionOffset`（ORDER BY seq OFFSET，游标行数口径）、
`listMessageHeadersBySession`（含 hidden）三者同口径，游标值不会因「含不含 hidden」错位。
**结论**：判定为有意设计，`intentional`，不作为问题上报；**出处的 RULE/迭代依据**：代码注释 `:88-93`（seq 复用防线）
+ `docs/apm/RULE.md`「seq（消息编号）」条（回滚是物理删尾、删后新消息复用旧 seq）。
**置信**：intentional。

### F-w9-checkpoint-pro-14 | intentional | `logic/revive-deleted-entry.ts:89-101`

**描述**：`reviveDeletedEntryForRestore` 在目标路径被 live 新 entry 占用时，**先 `vfs.delete(logicalPath)` 墓碑掉新 entry**
（连带物理删它的 `vfs_entry` 行），再把 checkpoint 旧 entry 复活到同一路径——净效果是「tail 期新建的同路径文件被回退」。
这在数据丢失维度上是最刺眼的一段，但 `:90-91` 的 `:90-91` 行与 `restore-path.ts:131-134` 都写明是
**「回滚后工作区正文 = 目标检查点完成态」的拍板语义**；且新 entry 的 revision 历史仍留在其 entryId 下、ref_count 由
tail 期 checkpoint 持有，日后再回滚到那些消息仍可复活。属**有意接受的语义选择**。
**置信**：intentional。

### F-w9-checkpoint-pro-15 | intentional | `logic/backfill-baseline-checkpoints.ts:162-182`

**描述**：backfill 只补「**最后一个**有 checkpoint 的消息之后」的空窗，中间缺口（消息 5、6 无点但 10 有点）永不补；
第二段短路判定（`:113-124`）也只看新增段，两端口径一致 → 不会误判，但**确实存在长期不补的中段缺口**。
后果是回滚到中段缺口消息时 targetTree 会落到更早的检查点树（可能偏旧）。这是「baseline 语义」的直接推论，
不是缺陷（`:2-7` 的模块注释就是这个语义），标 `intentional`。
**置信**：intentional。

## 争议与存疑

1. **F-1 的真实触发概率**（不下调置信度，但影响优先级判断）：旧 entry 的目标 revision 行「真缺」需要 revision GC 误删或
   手工删行才会发生。纯删除路径（`deleteWithRevision`）会写墓碑但**保留**历史 revision 行，所以正常用户路径大概率碰不到。
   若 L0 的表生命周期盘点能证明「revision 行永不被单独删除」，本条可降 P3。**留给 reduce 裁决**。
2. **F-2 的越界阈值**：`MULTI_VALUES_MAX_VARS = 900` 的注释（`:40`）说的是「老版 SQLITE_MAX_VARIABLE_NUMBER=999」，
   但 desktop 用的 better-sqlite3 ^11.10 打包的是 SQLite 3.4x（上限 32766）。**老库/老驱动**（quick-sqlite 回退线，RULE 有记载）
   才可能真踩 999。未实测移动端 op-sqlite 的实际上限，**建议 L0 补一条实测**再定 P 级。
3. **F-4 的用户可见面**：`message.service.truncateAfter` 是 desktop/mobile 哪个入口在用，本机位未越界核实
   （属 chat 域）。若它只被测试或无人调用，F-4 可降为 P3「纯冗余重复实现」；若 UI 有「清空重聊」按钮直连它，
   则 composer 域不清空会让回滚后 `<workplace>` 前缀沿用旧 `file_cache` 展示，值得升 P2。
4. **未采信的怀疑**（读码后排除，列出以免 reduce 重复怀疑）：
   - `decideBackfillShortCircuit` 的「游标写在判定 count 上」在事务内读同一快照，不存在跨快照错位（`message-checkpoint.service.ts:86-136` 全程单事务）。
   - `restore-path.ts:147` 的 same_version 短路位置正确（diverged 判定在 `:130` 之前）。
   - `seedCheckpoints` 的 `ref_count += msgCount` 与写入行数严格相等（files 来自一次 live-heads 扫描，entryId 唯一）。
   - `countCheckpointsForMessages` 的 COUNT(*) 等价性由 PK `(session_id, message_id)` 保证（schema `:18`），注释无夸大。
   - `deferred-revision-orphan-gc` 的模块级 in-flight 守卫跨会话丢弃调度：注释 `:17-19` 明写收敛式语义（漏一轮下轮补），且
     守卫只在 promise settle 时复位、无泄漏路径——**唯一理论卡死是连接永久挂起**，不值得报。