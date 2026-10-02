---
zone: core-checkpoint
agent: domain-survey
files_scanned: 17
---

# W2 · core-checkpoint 按域测绘报告

区域：`packages/core/src/domain/message-checkpoint/`（logic 14 + model 1 + repositories 2 = 17 文件，
2167 行）。基线 worktree `D:\Dev\nm-worktree\mcr`（只读测绘，未做任何 git 写）。

## 摘要

消息检查点域是「VFS 版本链 ↔ 对话时间线」的锚点层：每条消息可挂一棵**整树指针快照**
（`entry_id` + `revision_version` + capture 时点 path 快照），回滚时按指针把工作区拨回该
时刻。内容分四块——① 锚点解析（回滚锚点/目标树/reconcile 路径集）；② backfill（补历史消息
缺失的 baseline 快照，含两段式「无空窗」短路判定）；③ 恢复执行（restore / 复活已删 entry /
缺失 revision 回补）；④ 引用计数与 GC（ref_count 增减、scoped/全局孤儿清扫、deferred 调度）。

## 职责与边界

- **`model/message-checkpoint.ts`（1）**：三个行模型（锚点 / 文件指针 / live head 投影）。
  **不依赖任何模块**（唯一零 import 的文件）。
- **`repositories/`（2）**：`MessageCheckpointRepository` 端口（13 个方法）+ SQLite 实现。
  持久化 `message_checkpoint` / `message_checkpoint_file` 两张 `WITHOUT ROWID` 表，并负责
  checkpoint 指针的 **ref_count 增减**（直接调 `domain/vfs/logic/revision-ref-count`，
  领域间横向依赖，非经 vfs 服务层）。
- **`logic/`（14）**：全部为无状态纯函数 + 少量「读多处 SQL」编排，唯一带事务语义的是
  `truncate-tail-in-transaction.ts`（复用调用方事务，不自己开）与
  `deferred-revision-orphan-gc.ts`（fire-and-forget 调度）。
- **不在本域**：checkpoint 的**写入口**（capture / seed）在
  `service/message-checkpoint/impl/message-checkpoint.service.ts`；回滚**编排**（乐观锁重试、
  护栏、plan 解析）在 `service/message-checkpoint/impl/message-rollback.service.ts`；
  表 DDL 在 `bootstrap/message-checkpoint/message-checkpoint-schema.ts`。
  **本域不含任何 UI / IPC / 双端代码。**

## 对外接口

| 文件 | 导出 | 消费方 |
|---|---|---|
| `logic/backfill-baseline-checkpoints.ts` | `backfillBaselineCheckpoints`、`decideBackfillShortCircuit`、`BackfillBaselineResult`、`BackfillShortCircuitDecision`、`createBaselineCheckpointBackfillOperation` | `service/message-checkpoint/*`、`service/vfs/impl/character-card-import.service.ts:174`、`service/vfs/impl/vfs-zip-io.service.ts:236` |
| `logic/resolve-rollback-anchor.ts` | `resolveRollbackAnchorMessage` | `message-rollback.service.ts:352` |
| `logic/resolve-target-tree.ts` | `resolveRollbackTargetTree`、`resolvePriorRollbackTargetTree`、`RollbackTargetTreeResolution` | `message-rollback.service.ts:371,403` |
| `logic/resolve-reconcile-paths.ts` | `resolveReconcilePathSets`、`ReconcilePathSets` | `message-rollback.service.ts:416` |
| `logic/detect-missing-revisions.ts` | `findMissingRevisionPointers` | `message-rollback.service.ts:178` |
| `logic/restore-path.ts` | `restorePathToRevision`、`restorePathToRevisionWithBackfill`（+ 转发 `ensureDirectoryChain` / 两个 model 类型） | `message-rollback.service.ts:20,572` |
| `logic/restore-path-model.ts` | `RestorePathOutcome`、`RestorePathPrefetch` | 同上 + `revive-deleted-entry.ts` |
| `logic/revive-deleted-entry.ts` | `reviveDeletedEntryForRestore`、`ReviveDeletedEntryDeps` | `restore-path.ts:137,190` |
| `logic/backfill-missing-revision.ts` | `backfillMissingRevisionIfNeeded`、`BackfillRevisionDeps` | `restore-path.ts:280` |
| `logic/ensure-directory-chain.ts` | `ensureDirectoryChain` | `restore-path.ts:217`、`revive-deleted-entry.ts:112` |
| `logic/list-session-files.ts` | `listSessionFileHeads` | `backfill-baseline-checkpoints.ts`、`resolve-reconcile-paths.ts`、`service/chat/logic/seed-fork-copy-parity.ts:56`、`message-checkpoint.service.ts:50`、`message-rollback.service.ts:164,435,493` |
| `logic/revision-gc.ts` | `sweepSessionRevisions`、`revisionReachableKey` | `truncate-tail-in-transaction.ts:76`、`message.service.ts:254`、`user-vfs-turn.service.ts:127`、`create-session-fs-service.ts:73` |
| `logic/deferred-revision-orphan-gc.ts` | `scheduleDeferredRevisionOrphanGc` | `message-rollback.service.ts:295` |
| `logic/truncate-tail-in-transaction.ts` | `truncateTailInTransaction`、`TruncateTailParams`、`TruncateTailDeps` | `message-rollback.service.ts:239`（经 `service/message-checkpoint/truncate-tail-wiring`） |
| `repositories/message-checkpoint.port.ts` | `MessageCheckpointRepository`（13 方法）、`MessageCheckpointInsertInput`、`CheckpointFilePointer`、`MessageCheckpointDistinctPointer` | 6 个 service + 2 个 logic 模块 |
| `repositories/impl/sqlite-message-checkpoint.repository.ts` | `SqliteMessageCheckpointRepository` | 两个 import 服务（角色卡 / ZIP）+ 两个 service |

**没有 public barrel 子路径**：全仓检索 `@novel-master/core/message-checkpoint` 无命中，
本域纯 core 内部消费。

## 数据访问

| 表 / 域 | 触碰点（file:line） | 口径 |
|---|---|---|
| `message_checkpoint` | `sqlite-message-checkpoint.repository.ts:92,104,126,172,165,320,428,460` | 锚点行，PK `(session_id, message_id)`，**每 (session,message) 至多一行**是 `countCheckpointsForMessages` 等价性的根据（`:122` 注释） |
| `message_checkpoint_file` | 同上 `:143,158,184,240,291,338,355,379,406,421,439,454` | PK `(session_id, message_id, entry_id)`；`path` 为可空尾列（capture 时点快照），`loadFilePointerTree:291-300` 走 `snapshot_path ?? live_path`，两者皆 NULL 才跳过 |
| `vfs_entry`（只读 JOIN / 探测） | `sqlite-message-checkpoint.repository.ts:294`（LEFT JOIN 取 live path）；`list-session-files.ts:22`（`listFileHeadsUnderPrefix`）；`resolve-reconcile-paths.ts:61`；`backfill-missing-revision.ts:49,53` | checkpoint 域**只读** entry 表，写 entry 走 vfs 域 |
| `vfs_revision`（写） | `backfill-missing-revision.ts:60,72`（`append` 占位行）、`:68,79`（`adjustRef +1`） | **本域唯一会往 vfs_revision 插行的路径**，走 `revisionHeadBackfill` 降级开关 |
| `session_kkv_entry` / 域 `backfill_cursor` | 写：`truncate-tail-in-transaction.ts:90`（`clearDomain`）；读/写游标：`message-checkpoint.service.ts:108,129`（域常量来自 `session-kkv/model/session-kkv-domains.ts:22`） | 删除路径一律清游标（seq 复用防线） |
| 全局孤儿 revision（无 session 归属） | `deferred-revision-orphan-gc.ts:40` → `revisionRepo.deleteGlobalOrphans()` | fire-and-forget，模块级 in-flight 去重 |

**删除路径穷尽清单**（backfill 游标清空面，实测四条，与 `init-busy-yield-2026-09` spec 钉死的一致）：
`truncate-tail-in-transaction.ts:87`（tail 非空）、`message.service.ts:249`（`delete(id)`）、
`message.service.ts:451`（`truncateAfter(null)` 清空）、`message.service.ts:483`
（`truncateAfter(anchor)`）。会话删除走 `session_kkv` 级联。未发现漏网的消息删除路径。

## 依赖关系

**import 了谁**

- `domain/vfs/logic/vfs-path-mapper`（`scopeKey`）、`revision-ref-count`（`adjustRef` /
  `increment|decrementRefsForCheckpointFiles` / `deleteUnreferencedUnderScope`）、
  `revision-pair-key`、`parent-dir`、`vfs-move.mkdirIgnoreExistingDirectory`
- `domain/vfs/repositories/impl/*`（`SqliteVfsRevisionRepository`、`normalizePath`）与
  `content-store/impl/SqliteVfsContentStore`、`ports/vfs-restore.port`
- `domain/chat/repositories/message.port`（`MessageRepository`：`countBySession` /
  `listMessageHeadersBySession` / `listBySessionOffset`）
- `domain/session-kkv/*`（域常量 + 端口）、`infra/tdbc`（连接 / SqlTemplateParser /
  template-helper）、`errors/session-fs-errors` + `errors/vfs-errors`
- `service/integrity-repair.js`（**类型 only**：`IntegrityRepairOperation`）——
  域层反向依赖 service 层的类型，唯一的层向倒挂（`backfill-baseline-checkpoints.ts:20`）

**被谁消费**：`service/message-checkpoint/*`（capture/backfill/release/rollback 编排）、
`service/chat/impl/message.service.ts`（删除路径清游标 + sweep）、
`service/vfs/impl/{character-card-import,vfs-zip-io}.service.ts`（导入末尾补 baseline）、
`service/session-fs/create-session-fs-service.ts`、`service/agent/logic/run-agent-turn.ts`
（经 `messageCheckpoint.backfillMissingBaselines`）、`domain/chat/logic/seed-fork-copy-parity.ts`
（经 `seedCheckpoints`）。

**循环依赖**：本域内部无环。与 `domain/vfs/logic/revision-ref-count.ts` 存在**类型层双向引用**
（vfs 引 checkpoint 端口、checkpoint 实现引 vfs helper），但只在类型/纯函数层，运行期不成环。

## 发现清单

### F-core-checkpoint-1 | P2 | `logic/backfill-baseline-checkpoints.ts:165-177`（重复实现于 `:253-266`）

```ts
  for (let i = messages.length - 1; i >= 0; i--) {
    if (signal?.aborted === true) { return { confirmedNoGap: false }; }
    const has = await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id);
```

「找最后一个有 checkpoint 的消息」被写成**逐条单行读**的倒扫（O(消息数) 次 SQL 往返），
而同仓已有一次性 JOIN 查询干同一件事：
`sqlite-message-checkpoint.repository.ts:313-330` `findCheckpointMessageIdAtOrBefore`
（`JOIN chat_message … ORDER BY cm.seq DESC LIMIT 1`），已被 `resolve-target-tree.ts:60,82` 使用。
语义等价：两处输入都是按 seq 升序的消息数组，取「seq ≤ 末尾的最近一个 checkpoint 消息」。

严重性来自它是**发送热路径**：RULE 主仓条目《checkpoint backfill 的「无空窗」短路第二段事实上恒失败》
已定性「每轮发送前都回退全量扫描」——于是这条 N+1 扫描每发一条消息就跑一次，
大会话（数百条）即数百次单行读。

**建议**：`backfillBaselineCheckpoints` 与 `createBaselineCheckpointBackfillOperation.detect`
都改调 `findCheckpointMessageIdAtOrBefore(sessionId, 末尾消息 seq)`，再用 id 反查下标，
倒扫循环整体删除（连带 `signal` 弃权点少一处——注意 signal 检查要保留在扫描前后）。
**置信 confirmed。**

### F-core-checkpoint-2 | P2 | `logic/backfill-baseline-checkpoints.ts:253-266`

```ts
      let firstGapIndex = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        const has = await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id);
```

`createBaselineCheckpointBackfillOperation` 的 `detect()` 把 `backfillBaselineCheckpoints`
的倒扫+判空窗逻辑**逐字复制**了一份，且比原版**少了 `signal` 弃权点**（r3-run-4 引入的
中断语义在 detect 路径上不存在）。两处逻辑将来必然漂移——事实上已经漂移（signal 差异）。

**建议**：抽 `findFirstGapIndex(messages, checkpointRepo, sessionId, signal?)` 私有函数，
两处共用。**置信 confirmed。**

### F-core-checkpoint-3 | P2 | `repositories/impl/sqlite-message-checkpoint.repository.ts:126-130`（同类 `:382-384`、`:401-431`）

```ts
      `SELECT COUNT(*) AS n FROM message_checkpoint
       WHERE session_id = #{sessionId}
         AND message_id IN (${messageIds.map((_, i) => `#{id${i}}`).join(", ")})`,
```

三个方法（`countCheckpointsForMessages` / `listFilePointersForMessages` /
`deleteCheckpointsForMessages`）都按入参长度**无上限**展开 `IN (…)` 占位符，无分块。
`deleteCheckpointsForMessages` 的现实入参规模不小：
`message.service.ts:455` 的 `truncateAfter(null)` 传**全会话消息 id**
（`message.service.ts:444` 先 `listBySession` 全量拉回），`truncate-tail-in-transaction.ts:67`
传整个 tail。

而同文件 `:40-41` 自己就写明了上限意识：

```ts
/** 多值 INSERT 每块变量数上限（≤ 老版 SQLITE_MAX_VARIABLE_NUMBER=999，留余量）。 */
const MULTI_VALUES_MAX_VARS = 900;
```

`SQLITE_MAX_VARIABLE_NUMBER` 在 SQLite < 3.32 默认 999、之后 32766。minSdk 26
（`apps/mobile/android/build.gradle:4`）对应的 Android 8/9/10/11 自带 SQLite 均 < 3.32。
若 op-sqlite 走系统 SQLite 而非自带 amalgamation，千条消息的会话在低版本 Android 上
回滚/清空会直接 `SQLITE_RANGE` 报错。

**建议**：三处统一按 900 分块（复用 `insertMultiValues` 同款常量口径）。
**置信 suspected**——未能在本轮实测 op-sqlite 的实际 `SQLITE_MAX_VARIABLE_NUMBER`，
需 W6 验证或在 op-sqlite 侧钉一条断言。

### F-core-checkpoint-4 | P3 | `logic/revision-gc.ts:55-63`

```ts
export async function sweepSessionRevisions(
  revisionRepo: VfsRevisionRepository,
  _entryRepo: VfsEntryRepository,
  _checkpoints: MessageCheckpointRepository,
  ...
  _conn: TdbcConnection,
```

函数体只用 `revisionRepo` + scope 串，四个参数全部下划线弃用（注释 `:31-33` 说明是
「保留原签名以兼容调用方」）。但**四个调用方全都在传**（`truncate-tail-in-transaction.ts:78-81`、
`message.service.ts:255-260`、`user-vfs-turn.service.ts:127`、`create-session-fs-service.ts:73`），
即每个调用点都在构造并传递死参数，其中 `deps.entries` / `deps.checkpoints` 还挂在
`TruncateTailDeps` 契约上（`truncate-tail-in-transaction.ts:42-46`）——契约本身因此
强制所有调用方持有这两个仓库。

**建议**：删三个参数 + 收窄 `TruncateTailDeps`（`entries` 若别处无用途一并删）。
**置信 confirmed。**

### F-core-checkpoint-5 | P3 | `logic/revision-gc.ts:22-26`

```ts
/** Builds a stable `entryId:version` key for revision GC fallback。 */
export function revisionReachableKey(entryId: number, version: number): string {
  // 保留供 seed-fork / 测试代码复用，不再在本模块内部使用。
  return revisionPairKey(entryId, version);
```

零生产调用方（`seed-fork-copy-parity.ts` 用的是 `revisionPairKey` 本身）。唯一消费者是
`test/message-checkpoint/revision-gc.test.ts:66`，而那条断言是**恒真**的：

```ts
assert.equal(revisionReachableKey(entry.entryId, v1).includes(String(entry.entryId)), true);
```

被测函数就是 `` `${entryId}:${version}` ``，`.includes(String(entryId))` 对任何输入都为真
——正是 RULE《验收断言的「牙齿」》点名的「把实现改成错的这条也不会红」的无牙断言。

**建议**：删导出 + 删该断言（该用例其余部分已覆盖 GC 语义）。**置信 confirmed。**

### F-core-checkpoint-6 | P3 | `logic/backfill-missing-revision.ts:52-69`

```ts
  if (entry != null && entry.entryKind === "file") {
    const contentHash = await deps.entryRepo.findContentHash(scopeKeyStr, logicalPath);
    ...
    await deps.revisionRepo.append({ entryId, version: targetVersion, content: null,
      contentHash, status: "active", mtimeMs });
```

目标 revision 行缺失时，回补的是「**live 当前的 content_hash**」挂在**历史 version** 上——
造出一条 `(entryId, 历史version) ↔ 当前正文` 的假历史。随后 `restore-path.ts:172-182`
拿到该 meta，比出 `liveHash === meta.contentHash` → 返回 `skipped_same_content_hash`，
该路径**静默不写盘**。即：目标版本内容已不可得时，回滚对该文件「成功但什么也没还原」，
用户看到的是工作区停在 tail 态而非目标态，且假行永久留在 `vfs_revision` 里
（`findMetasByEntryVersions` 之后再也报不出 missing）。

这是 `revisionHeadBackfill` 降级开关的既定语义（注释 `:24`「使 restore 可继续」，
`rollback-revision-backfill.test.ts` 有用例），但**「静默无操作」与「数据不可恢复」在
UI 上不可区分**这一点，注释与测试都没有钉。

**建议**：至少在 `RestorePathOutcome` 增一个 `skipped_missing_history` 之类的结局并向上
暴露（可接 toast/日志），让降级可见；假历史行加注释说明其为占位。
**置信 suspected**（语义后果已从代码推导，未跑真机回滚验证）。**RULE 无对应条目，不判 intentional。**

### F-core-checkpoint-7 | P3 | `logic/resolve-reconcile-paths.ts:58-63`

```ts
    let entryId = entryIdByPath.get(logicalPath) ?? null;
    if (entryId == null) {
      // 非-live 路径（可能已删）：退化为 entryRepo.findByPath。
      const entry = await entryRepo.findByPath(scopeKeyStr, logicalPath);
      entryId = entry?.entryId ?? null;
    }
```

`entryIdByPath` 来自 `listSessionFileHeads`（`:42-49`），而 `listSessionFileHeads` 已经
`listFileHeadsUnderPrefix(scopeKey, "/")` 覆盖了该 scope 下**全部 file 类型 entry**
（`sqlite-vfs-entry.repository.ts:670-674`：`entry_kind = 'file'` 且 `path = '/' OR path LIKE '/%'`）。
所以这里的 `findByPath` 退化分支**只可能返回目录行**（或 null）——对已删文件是必跑一趟
注定返回 null 的查询（N 次），对「路径上现在是目录」则会把目录的 entryId 塞进
`reconcilePairs`，进而 `findMetasByEntryVersions` 查不到 → 标 needWrite → restore 阶段
`resolveRevisionMeta` 返回 null → 抛 `sessionFsRestoreRevisionMissing`（硬失败而非降级）。

同样的 per-path `findByPath` 循环也出现在 `detect-missing-revisions.ts:43`（每个待 reconcile
路径一次查询），两处都没走批量。

**建议**：把退化分支删掉（`entryId == null` 即 `cpEntryId ?? -1`，与 `:72-77` 已有分支合并）；
`detect-missing-revisions` 的 entryId 解析改用一次 `listFileHeadsUnderPrefix`。
**置信 confirmed。**

### F-core-checkpoint-8 | P3 | `repositories/message-checkpoint.port.ts:97` / `:136`

`loadFileTree`（`:97-100`）与 `listDistinctCheckpointPointersForSession`（`:136-139`）
在**生产代码里零调用**——`grep -rn --include=*.ts` 全仓命中只有：端口声明、SQLite 实现、
以及测试（`capture.test.ts:26,58`、`fork-copy-parity.test.ts:77`、
`checkpoint-capture-transactional.test.ts:80-125`、`rollback-reach-hash-batch.test.ts:48`、
`rollback-execution-redesign.test.ts:105`）。生产侧全走 `loadFilePointerTree`。
`loadFileTree` 的实现（`sqlite-...repository.ts:256-269`）也只是 `loadFilePointerTree`
剥掉 entryId 的投影。

**建议**：`loadFileTree` 删端口 + 实现 + 改测试用 `loadFilePointerTree`；
`listDistinctCheckpointPointersForSession` 若确认是 `deleteExceptReachable` 退役后的残留
（`revision-gc.ts:5-9` 注释说 ref_count 回填完成后可达集路径已删），一并删。
**置信 confirmed**（调用面已穷举）。

### F-core-checkpoint-9 | P3 | `logic/restore-path.ts:32-36`

```ts
export { ensureDirectoryChain } from "./ensure-directory-chain.js";
export type { RestorePathOutcome, RestorePathPrefetch } from "./restore-path-model.js";
```

`ensureDirectoryChain` 的转发导出零消费方——`revive-deleted-entry.ts:20` 与
`restore-path.ts:26` 都直接从 `./ensure-directory-chain.js` 引入，
`message-rollback.service.ts:18-21` 也只取 `restorePathToRevision*`。
两个类型的转发则是**活的**（测试 `rollback-reach-hash-batch.test.ts:4-7` 从
`restore-path.js` 取 `RestorePathPrefetch`），属合理的 barrel，保留。

**建议**：删 `:32` 一行转发导出。**置信 confirmed。**

### F-core-checkpoint-10 | P3 | `logic/deferred-revision-orphan-gc.ts:28`

```ts
/** 模块级 in-flight 守卫：清扫进行中不重入。 */
let orphanGcInFlight = false;
```

守卫是**进程级**而非连接级：模块单例被所有连接共享。若 A 连接上有清扫在飞，
B 连接（本仓存在多连接场景：主仓 desktop main + 测试多 context；生产侧目前单连接）
的调度会被**静默丢弃**，且因收敛式语义「下一轮补上」，B 的孤儿行在窗口内持续残留。
`runDeferredFileCacheGc` 用的是连接级 in-flight（对照 `session-kkv` 域的同类实现），
此处不一致。

**建议**：守卫改为按 `conn` 维度（`WeakSet<TdbcConnection>` 或 conn 挂 symbol 属性）。
**置信 suspected**——当前生产单连接，尚未造成实害。

### F-core-checkpoint-11 | P3 | `logic/detect-missing-revisions.ts:84-88`

```ts
  for (const pair of pairs) {
    if (pair.entryId < 0) { missing.push(pair.logicalPath); }
  }
```

`pairs` 在 `:71-83` 已经整轮遍历过（`queryable` 子集查 meta），这里为了挑 `entryId < 0`
的哨兵项**再整轮走一次全数组**。哨兵项在构造时（`:56-61`）就是 `cpEntryId ?? -1`，
完全可以在第一次循环里一并判定。

**建议**：把 `-1` 判定并入 `:78-83` 的循环（或构造 `pairs` 时直接分两组）。
**置信 confirmed。**

### F-core-checkpoint-12 | P3 | `logic/resolve-reconcile-paths.ts:85-87`

```ts
    const liveHashByPath = await entryRepo.findContentHashesByPaths(scopeKeyStr, [
      ...new Set(reconcilePairs.map((pair) => pair.logicalPath)),
    ]);
```

`reconcilePairs` 里 `entryId === -1` 的项在 `:94-97` 直接 `pathsNeedWrite.add` 后
`continue`，**永远用不到 liveHash**。也就是说这批路径的 content_hash 是白查的
（`findContentHashesByPaths` 内部还按 200 分块，多一次分块就是多 2 次往返）。

**建议**：查询入参过滤掉 `entryId < 0` 的路径。**置信 confirmed。**

### F-core-checkpoint-13 | P3 | `model/message-checkpoint.ts:8-12`

```ts
export interface MessageCheckpoint {
  readonly sessionId: string;
  readonly messageId: string;
  readonly createdAtMs: number;
}
```

全仓零引用（`MessageCheckpointRepository` / `MessageCheckpointFile` / `MessageCheckpointInsertInput`
都不引用它；`message_checkpoint` 表的读侧一律走 `Row`→`rowToFilePointer` 投影）。
锚点行的字段口径已经由 `MessageCheckpointInsertInput`（`port:16-26`）承载。

**建议**：删接口。**置信 confirmed。**

### F-core-checkpoint-14 | P3 | `logic/backfill-missing-revision.ts:72-79`

```ts
  await deps.revisionRepo.append({
    entryId, version: targetVersion, content: null, status: "deleted", mtimeMs,
  });
  await adjustRef(deps.revisionRepo, entryId, targetVersion, +1);
```

entry 已被 hardDelete（`entryId != null` 但 `findByPath` 返回 null）时，这里给一个
**已不存在的 entry** 插入墓碑行并 `adjustRef(+1)`。`deleteGlobalOrphans` 的口径是
「ref_count ≤ 0 且 entry 不在 `vfs_entry`」，这条行 ref_count = 1，**孤儿清扫永远收不掉它**，
只能等引用它的 checkpoint 被删（走 `deleteCheckpointsForMessages` 的 −1）才降到 0。
即：一次回滚降级会在 `vfs_revision` 里留一条只能靠 checkpoint 生命周期回收的孤儿。

**建议**：确认是否可让该分支 `adjustRef(+0)` / 不写（`status='deleted'` 的行本身无内容价值），
或在 `deleteGlobalOrphans` 的判定里排除「有 checkpoint 引用」的行。
**置信 suspected**——需确认是否存在「checkpoint 已删但墓碑行 ref_count 仍 > 0」的窗口。

### F-core-checkpoint-15 | P3 | `repositories/message-checkpoint.port.ts:20-25` / `:81-88` / `:34-38`

同一个「checkpoint 文件指针」形状在三个地方各写一遍：
`MessageCheckpointInsertInput.files`（内联，含 path）、`seedCheckpoints` 的 `files`（内联，含 path）、
`CheckpointFilePointer`（含 path）、`MessageCheckpointDistinctPointer`（**不含** path）、
`domain/vfs/logic/revision-ref-count.ts:17-20` 又有一个同名 `CheckpointFilePointer`
（**不含** path，与 port 的同名类型**形状不同**）。同名不同形是最容易踩的一种重复。

**建议**：抽一个 `CheckpointPointer`（带 path，可选）+ 一个 `CheckpointRef`（entryId+version），
四处引用；或至少把 `revision-ref-count.ts` 的同名类型改名（如 `RevisionRef`）消除歧义。
**置信 confirmed。**

## 争议与存疑

1. **`loadFilePointerTree` 开头的 `hasCheckpoint` 前置查询（`sqlite-...repository.ts:275-278`）
   看似冗余，实际承载 null/empty 契约**——它区分「无 checkpoint → `null`」与
   「有 checkpoint 但零文件行 → 空 Map」。`resolve-target-tree.ts:56` 的
   `if (direct != null)` 与 `message-rollback.service.ts:411` 的
   `hasDirectTargetTree = directTargetPointers != null` 都依赖这个区分。
   现状下确实没有调用方会造出「零文件行的 checkpoint」（capture/seed/backfill 三处入口
   都在 `files.length === 0` 时提前返回），所以它当前是**防御性**而非必需。
   **不作为发现上报**；若未来有人为了省一次往返删掉它，`hasDirectTargetTree` 会静默变 true，
   建议改前先补一条「零文件 checkpoint」的构造用例把契约钉住。

2. **backfill 两段式短路的存废**（`backfill-baseline-checkpoints.ts:69-125`）：RULE 主仓已定性
   「第二段事实上恒失败、回退全量是常态」，按执行协议第 3 条应标 intentional 不当问题报。
   但由此推出的**推论尚未被任何文档记录**：既然回退全量是常态，
   `decideBackfillShortCircuit` 每轮发送固定多付 5 次查询
   （kkv `get` → `countBySession` → `hasAnyCheckpointForSession` → `listBySessionOffset`
   → `countCheckpointsForMessages`），其中 `listBySessionOffset`（`sqlite-message.repository.ts:282-298`）
   还会 `SELECT` 全列并 `mapRows` **解压正文**——而它要的只是 `m.id`。
   也就是说：RULE 判定的「恒失败」，在本域的代价是**每轮发送多一次带解压的消息读 + 4 次其他查询**，
   换来的短路在正常对话里一次都不会命中。**本报告按 intentional 处理（不列为缺陷），
   但建议主代理在 L3 记账时把这条推论单列一条待拍板项**：
   要么给 `listBySessionOffset` 加一个 header 投影变体，要么评估直接删掉两段式、
   只保留全量扫描（`backfill_cursor` 域随之退休）。取证：RULE 主仓
   `docs/apm/RULE.md` 《checkpoint backfill 的「无空窗」短路第二段事实上恒失败》条目 +
   本文件 `:52-68` 的注释已自陈「不等（典型：上一轮纯文本对话尾部 assistant / tool_result
   user 尚无 checkpoint，属真实空窗、本就该补）」。

3. **`createBaselineCheckpointBackfillOperation` 的 detect 与 repair 不对称**（`:216-284`）：
   detect 走「两段式短路 → 找空窗」只读路径，repair 直接调 `backfillBaselineCheckpoints`
   且**不写游标**（注释 `:218` 说明「残留旧游标只导致下次判定保守回退，无正确性影响」）。
   这个不对称是**有意**的，但它意味着 integrity-repair 跑完之后，下一次发送仍会因
   「游标缺失」走全量——与争议 2 同源，不另计缺陷。

4. **本域未发现任何 P0/P1**：无未捕获异常路径、无事务越界（`truncateTailInTransaction`
   显式复用调用方 tx）、无 SQL 注入面（全参数化，`IN` 用具名绑定拼接）。
   F-3（`IN` 无上限）是本域唯一的「可能直接报错」项，故置信度压在 suspected 而非 confirmed。

## 残留与自清

- 本代理未做任何 git 写、未创建/修改 `docs/apm/` 下任何文件。
- 扫描期间在 `tmp/` 下临时写了 13 个 `cr-scan*.sh` 定位脚本，**已全部删除**；
  `tmp/` 内其余文件（`l0-census.mjs`、`mui-*.sh` 等）为其他代理/主代理的既有产物，本代理未触碰。
