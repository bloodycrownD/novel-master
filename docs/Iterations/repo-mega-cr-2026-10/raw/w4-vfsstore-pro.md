---
zone: w4-vfsstore-pro
agent: 检察官（prosecutor，对抗机位）
files_scanned: 56
scope: packages/core/src/domain/vfs/**（content-store / logic / model / ports / repositories）+ 邻接 service/vfs/**、bootstrap/vfs/** DDL
independence: 未读取 raw/ 下任何文件
---

## 摘要

VFS 内容存储层：三张表（`vfs_entry` 逻辑路径 + `head_version`、`vfs_revision` append-only 版本链、
`vfs_content_blob` 内容寻址 blob）。写侧内容寻址 + zlib 压缩落 blob，版本链由
`vfs_content_blob.ref_count`（SQLite 触发器维护）与 `vfs_revision.ref_count`（应用层维护）双计数器
分别保证 blob 回收与版本可达性 GC。含 restore/copy/move/rename、树拷贝替换、ZIP 导入导出、
batch ingest/export、path mapper 五域挂载。本轮猎到 8 条 P1。

## 职责与边界

- **写**：`RevisionAwareVfsService`（service 层，本区消费方）→ `SqliteVfsEntryRepository` +
  `SqliteVfsRevisionRepository` + `SqliteVfsContentStore`，全部包在
  `runInTransactionOrConn` 里。
- **GC**：`deleteUnreferencedUnderScope`（JOIN `vfs_entry` 圈定 scope）+ `deleteGlobalOrphans`
  （全表兜底）收 revision；`SqliteVfsContentStore.gc()` + 3 个 revision 触发器收 blob。
- **不在本区**：checkpoint 指针的增减（`domain/message-checkpoint`）、workplace 视图、
  desktop/mobile 端 batch service（只作为调用方取证）。

## 对外接口

| 符号 | 位置 |
|---|---|
| `VfsContentStore`（put/get/getMany/gc/ensureBlob/findExistingBlobHashes） | `content-store/vfs-content-store.port.ts` |
| `VfsEntryRepository`（30 方法）/ `VfsRevisionRepository`（20 方法） | `repositories/*.port.ts` |
| `VfsScope` / `scopeKey` / `toPhysicalPath` / `toLogicalPath` / `scopePhysicalPrefix` | `logic/vfs-path-mapper.ts` |
| `copyVfsTree` / `replaceVfsSubtree` / `sweepRevisionsUnderScope` / `deleteVfsPrefix` | `logic/vfs-tree-copy.ts` |
| `restoreMutatingPathHeads` / `MutatingPathRestoreCompositeError` | `logic/restore-mutating-path-heads.ts` |
| `computeReplaceResult` / `buildReplaceNotFoundError` | `logic/compute-replace-*.ts` |
| `parseVfsZip` / `validateVfsZipEntries` / `buildVfsZip` | `logic/vfs-zip-*.ts` |

## 数据访问

| 表 | 触点（file:line） |
|---|---|
| `vfs_entry` | `repositories/impl/sqlite-vfs-entry.repository.ts:65-982`（全部 30 方法）；DDL `bootstrap/vfs/vfs-schema.ts:14-25` |
| `vfs_revision` | `repositories/impl/sqlite-vfs-revision.repository.ts:71-648`；DDL `bootstrap/vfs/vfs-revision-schema.ts:17-28` |
| `vfs_content_blob` | `content-store/impl/sqlite-vfs-content-store.ts:47-221`；DDL `bootstrap/vfs/vfs-content-blob-schema.ts:13-19` |
| blob ref_count 触发器 ×3 | `bootstrap/vfs/vfs-revision-schema.ts:36-72`（INSERT+1 / DELETE−1 且归零删行 / UPDATE OF content_hash 转移） |
| KKV | 无（本区不直接触 KKV；`deferred-blob-gc.ts` 只调 content-store） |

## 依赖关系

- **import 谁**：`@/infra/tdbc`（连接/模板）、`@/infra/sql-template`、`@/infra/content-cache`
  （解压产物 LRU）、`@noble/hashes`、`fflate`、`iconv-lite`、`diff`。
- **被谁消费**：`service/vfs/**`（scoped/revision-aware/physical/batch-io/zip-io）、
  `service/skills`、`service/template`、`service/workplace`、`domain/tool/builtin/vfs-tools`、
  `domain/message-checkpoint/**`、`public/vfs.ts`。

## 发现清单

### F-w4-vfsstore-pro-1 | P1 | `repositories/impl/sqlite-vfs-entry.repository.ts:935-945` | 置信 confirmed

```
`UPDATE vfs_entry
 SET path = REPLACE(path, #{oldWithSlash}, #{newWithSlash})
 WHERE scope_key = #{scopeKey} AND path LIKE #{pattern} ESCAPE '\\'`
```

**描述**：目录重命名用 SQL `REPLACE(path, oldBase||'/', newBase||'/', ...)`。SQLite 的
`REPLACE(X,Y,Z)` 替换 X 中 **Y 的所有出现**，不是只替换前缀。`WHERE` 只保证命中行在旧前缀下，
不阻止路径内部再次出现同名段。

**后果链**：`renamePrefix("/草稿", "/定稿")` 时，子路径 `/草稿/草稿/第一章.md` 会被改成
`/定稿/定稿/第一章.md`——内层同名子目录被一并改名。同理 `/a/x/a/y.md` → `/b/x/b/y.md`。
中文小说工程里「卷/卷」「正文/正文」这类同名子目录极常见，命中概率不低。**静默数据损坏**：
无报错、UNIQUE 不冲突（改名后仍是新路径）、revision/entry_id 不变所以 checkpoint 完全无感，
用户直到某次 read 失败或内容错位才发现。现有测试
（`test/vfs/vfs-rename-primitive.test.ts:129/159`）只覆盖空目录与 `%_` 转义，**没有覆盖
「旧目录名在后代路径中重复出现」**，所以回归网是空的。

**建议**：改成只替换前缀的表达式，例如
`SET path = #{newBase} || substr(path, length(#{oldBase}) + 1)`，或
`REPLACE(path, #{oldWithSlash}, #{newWithSlash})` 前加 `substr(path,1,length(#{oldWithSlash})) = #{oldWithSlash}`
的 CASE 门。补一条同名子目录的回归用例。

---

### F-w4-vfsstore-pro-2 | P1 | `logic/vfs-tree-copy.ts:397-411` | 置信 confirmed

```ts
await decrementLiveRefsUnderScope(revisionRepo, repo, scopeKey, pathPrefix, excludePrefixes);
await deleteVfsPrefix(repo, scopeKey, pathPrefix, excludePrefixes);      // ← 先删 vfs_entry
await deleteUnreferencedUnderScope(revisionRepo, scopeKey, pathPrefix, excludePrefixes);
```

**描述**：`deleteUnreferencedUnderScope` 的实现是
`sqlite-vfs-revision.repository.ts:604-614` 的 `DELETE ... WHERE (entry_id, version) IN
(SELECT r.entry_id, r.version FROM vfs_revision r JOIN vfs_entry e ON ...)`——**必须 JOIN
`vfs_entry` 才能圈定范围**。而上一步刚把 `vfs_entry` 行全删了，JOIN 结果恒为空，第三步永远
删 0 行。

**后果链**：每条被释放的 live head（`ref_count` 已从 1 减到 0）对应的 revision 行原地留下，
`entry_id` 已成孤儿。回收孤儿只有 `deleteGlobalOrphans`
（`sqlite-vfs-revision.repository.ts:55-58`，条件 `ref_count <= 0 AND entry_id NOT IN vfs_entry`），
但 `replaceVfsSubtree` / `sweepRevisionsUnderScope` 的调用方
（`service/template/logic/initialize-session-workspace.ts:37`、
`push-session-workspace.ts:32`、`service/skills/impl/skills.service.ts:440`）
**都不调 `deleteGlobalOrphans`**。于是每 pull 一次模板 / push 一次 / 删一个技能，
就永久留下一整代 revision 行；这些行的 `content_hash` 又被
`SqliteVfsContentStore.gc()` 的 `NOT IN`（`sqlite-vfs-content-store.ts:213-217`）视为「仍被引用」，
blob 一并留下。这与 `docs/apm/RULE.md:108` 实测到的「VFS 多版本 delta 占 10.7MB / 82.6%」
高度吻合——**膨胀不是正常历史开销，是这条顺序错的 GC**。

**对照证据**：同仓 `revision-aware-vfs.service.ts:236-237` 的 hardDelete 明确写了注释
「删 entry 前先 sweep ref_count<=0 的 revision（此时 entry 仍在可 JOIN）」——代码库自己知道
这个顺序约束，`sweepRevisionsUnderScope` 违反了它。

**建议**：把 `deleteUnreferencedUnderScope` 挪到 `deleteVfsPrefix` **之前**（与 hardDelete 对齐），
或在末尾补一次 `deleteGlobalOrphans()`。前者更省（限定 scope）。

---

### F-w4-vfsstore-pro-3 | P1 | `logic/vfs-tree-copy.ts:243-260` | 置信 confirmed

```ts
// 已存在的目标用逐条 update（tree-copy 到清空 scope 时不会走到）
const nextVersion = await nextUpdateVersion(repo, options?.revisions, toScope.scopeKey, f.targetPath, null);
await repo.updateWithContentHash(toScope.scopeKey, f.targetPath, f.contentHash!, nextVersion);
```

**描述**：目标 entry 已存在时，`copyVfsTree` 只把 `vfs_entry.head_version` 抬到
`nextVersion` 并换 `content_hash`，**既不 append `vfs_revision` 行，也不做 live ref 转移**。
旧 head revision 仍持 `ref_count = 1`，而新的 head_version 在 `vfs_revision` 里根本没有对应行。

**后果链**（三重）：
1. `seedLiveHeadRevisionsUnderPrefix`（`seed-live-head-revisions.ts:44-49`）只补「缺失」的
   `(entryId, headVersion)`，会给新版本补一行 ref=1；旧版本那行 ref=1 **永远不会被减**，
   于是成为 `deleteUnreferencedUnderScope`（要求 ref<=0）与 `deleteGlobalOrphans`
   （要求 ref<=0）都够不着的悬空行，且经 revision DELETE 触发器把 blob `ref_count` 钉住不放。
2. `decrementLiveRefsUnderScope` / `hardDelete` 对新 head_version 做 `adjustRef(-1)`，
   `batchAdjustRefCountWithDelta`（`sqlite-vfs-revision.repository.ts:406-408`）对 `delta < 0`
   **不做存在性校验**，UPDATE 命不中即静默 no-op。
3. `repairRefCounts` 是「只上调」的地板修复（`revision-ref-count.ts:93`），也修不了偏高。

**当前可达性**：四个生产调用方（`session.service.ts:366`、`message.service.ts:334`、
`project.service.ts:263/271`）目标都是全新 scope，走不到这个分支；`replaceVfsSubtree` 先 sweep
删空目标也走不到。所以是**潜伏地雷**而非在线故障——但它是本区唯一一个「改了 head_version
却不建 revision」的公共 API，一旦有人复用 `copyVfsTree` 做 overlay 就会引爆。

**建议**：在这个分支里补 `revisionRepo.append(...)` + `transferLiveRef(old, new)`，
或在 `nextUpdateVersion` 命中「目标已存在」时直接抛错拒绝 overlay。

---

### F-w4-vfsstore-pro-4 | P1 | `service/vfs/impl/vfs-batch-io.service.ts:100-101` | 置信 confirmed

```ts
// 无 revision 层：不写 vfs_revision 行，head + 1 不会撞唯一键，维持现状语义
await repo.update(sk, logical, content, existing.version + 1);
```

**描述**：`writeOrUpdateFile` 直接操作 `SqliteVfsEntryRepository`，**绕过
`RevisionAwareVfsService.write`**，不 append revision、不动 ref_count。新建分支
`repo.insert`（`sqlite-vfs-entry.repository.ts:294-311`）同样只建 entry。

**后果链**：
1. `vfs_entry.head_version` 指向一个 `vfs_revision` 里不存在的版本。
2. `findMissingRevisionPointers`（`detect-missing-revisions.ts:78-83`）只在 checkpoint
   指针路径上跑，**不会**发现 head 悬空——没有安全网。
3. 一旦有 checkpoint 钉住这个 head，`incrementRefsForCheckpointFiles` →
   `batchAdjustRefCount(+1)` 会先做存在性校验（`sqlite-vfs-revision.repository.ts:408-425`）
   并抛 `VfsError NOT_FOUND: Revision not found`。
4. 后续对同文件做一次正常 `write`：`transferLiveRef(entryId, N, N+1)` 的 `-1` 打在不存在的
   行上（静默 no-op），**真 head 那行 N 的 ref_count 停在 1**，从此该 revision 与其 blob
   永久不可回收。

**可达性**：`apps/desktop/src/main/services/vfs-batch.service.ts:220` 对**所有非 session
scope**（project / global / global-meta / project-meta）走 `applyBatchIngest` 这条路；
只有 session scope 在 `isUserVfsUnifiedToolTurnEnabled()` 时才走 writer 变体。注释里
「无 revision 层」的说法只对 `DefaultVfsService` 成立，对 project/global 域是错的——
那些域的 live head 本来就被 checkpoint / rollback / GC 当作有版本链的对象。

**建议**：`writeOrUpdateFile` 改走 `RevisionAwareVfsService`（或直接调
`insertFileSeedingRevision`），保证 head 与 revision 同步。

---

### F-w4-vfsstore-pro-5 | P1 | `domain/vfs/logic/longest-common-substring.ts:52-54` | 置信 confirmed

```ts
const dp: number[][] = Array.from({ length: rows }, () =>
  Array<number>(cols).fill(0)
);
```

**描述**：`buildReplaceNotFoundError`（`compute-replace-not-found-error.ts:55`）在
**每一次** `REPLACE_NOT_FOUND` 上无条件调用 `longestCommonSubstring(oldString, fileContent)`，
分配 `(len(oldString)+1) × (len(fileContent)+1)` 的稠密二维 `number[][]`。

**后果链**：oldString 500 字符 × 正文 200KB = 1×10⁸ 个 number，加上每行独立 `Array` 对象
开销，约 800MB–1.6GB 瞬时堆；Hermes 上是 OOM 级别。这条路径恰好是 **agent 纠错重试的入口**
——模型 oldString 写歪了就会进来，且往往伴随连续多次 edit 失败，一次会话能触发多回。
`MIN_LCS_LENGTH`（`longest-common-substring.ts:8`）只在文案层用，**没有任何尺寸闸门**。

**建议**：换成滚动数组（O(min(n,m)) 空间），或在 `buildReplaceNotFoundError` 入口对
`oldString.length` / `fileContent.length` 设上限并降级为「不做 LCS、只报码点转储」。

---

### F-w4-vfsstore-pro-6 | P1 | `logic/vfs-zip-central-dir.ts:100-108` | 置信 confirmed

```ts
const inflated = inflateSync(compressed);
if (inflated.length !== uncompressedSize) { throw vfsZipError(...); }
```

**描述**：`parseZipCentralDirectory` 逐条 `inflateSync` **并把全部解压结果收在
`entries[]` 里返回**，全程没有体积/条数闸门。32MB / 5000 条的上限在
`vfs-zip-validate.ts:17-18,196-207`，而校验函数
`validateVfsZipEntries(scope, entries: ReadonlyMap<string, Uint8Array>, ...)`
的入参**已经是解压完的 Map**——`service/vfs/impl/vfs-zip-io.service.ts:189-192` 是
先 `parseVfsZip` 后 `validateVfsZipEntries`。上限完全来不及保护解析。

**后果链**：中央目录里 `uncompressedSize` 由攻击者填（只要不是 `0xffffffff` 就不触发
`assertNoZip64Marker`），一个几百 KB 的 zip 就能让 `inflateSync` 分配 GB 级；
`totalEntries` 是 uint16（最多 65535），每条都留在数组里 → 移动端 OOM 崩溃。
`parseVfsZip` 的 fflate 回退分支（`vfs-zip-parse.ts:23-36`）同样没有闸门。
`domain/skills/logic/preview-skill-zip.ts:35` 是第二个入口。
已 grep 确认 apps 层没有对 zip 字节数做前置限制。

**建议**：在 `parseZipCentralDirectory` 里累加 `uncompressedSize`，超过
`VFS_ZIP_MAX_UNCOMPRESSED_BYTES` 立即抛 `PAYLOAD_TOO_LARGE`；`totalEntries` 超过
`VFS_ZIP_MAX_ENTRY_COUNT` 同样早退。

---

### F-w4-vfsstore-pro-7 | P1 | `service/vfs/impl/vfs-batch-io.service.ts:399-406` | 置信 confirmed

```ts
if (existing != null && existing.entryKind === "file") {
  const fileRel = basenameOf(logical);                      // ← 没有走 exportRelativePath
  if (fileRel.length > 0 && !seenFileRels.has(fileRel)) {
    seenFileRels.add(fileRel);
    files.push({ relativePath: fileRel, content: existing.content });
  }
  continue;
}
```

**描述**：`planBatchExport` 的「选中的是单文件」分支直接用 `basenameOf`，**没有调用
`exportRelativePath`**——而 `exportRelativePath`（同文件 `:164-178`）恰恰是为此设计的：
它带 `selectionCount` 参数，注释明写「多选时带顶层 basename，避免摊平冲突」。

**后果链**：桌面端多选导出 `/卷一/第一章.md` 与 `/卷二/第一章.md`（中文工程里同名卷章极常见），
第一条进 `files`，第二条被 `seenFileRels.has("第一章.md")` 静默丢弃。**导出 ZIP 里少一个文件，
报告里没有 `skipped`、没有 `failed`、UI 无任何提示**。同时选目录时目录分支是有兜底的，
两类选中混在一起时目录被包进 `卷一/` 而文件散在根——行为也不一致。

**建议**：文件分支改用 `exportRelativePath(childLogical, logical, selectionCount)`，
与目录分支统一。

---

### F-w4-vfsstore-pro-8 | P1 | `repositories/impl/sqlite-vfs-revision.repository.ts:604-614` 顺序 / `bootstrap/vfs/vfs-revision-schema.ts:52-59` | 置信 confirmed

见 F-2（同源）。此处单列**触发器侧的第二个悬空链**：

```sql
-- vfs-revision-schema.ts:52-59
UPDATE vfs_content_blob SET ref_count = ref_count - 1 WHERE content_hash = OLD.content_hash;
DELETE FROM vfs_content_blob WHERE content_hash = OLD.content_hash AND ref_count <= 0;
```

**描述**：`vfs_content_blob.ref_count` **只由 revision 触发器维护**，`vfs_entry.content_hash`
这一路引用对 blob 计数**完全不可见**（没有 entry 侧触发器）。于是只要存在一个
「entry 引用了 blob、但没有 revision 引用它」的行（F-4 的 batch ingest、
F-3 的 copyVfsTree overlay 都会造出这种行），该 blob 的 `ref_count` 常年为 0；此时**任何**
一条引用同 hash 的 revision 被删，触发器就会在归零判定里把 blob 行删掉。

**后果链**：内容寻址意味着同 hash 极可能共享（`docs/apm/RULE.md:108` 实测去重后省 61.3%）。
共享方之一被删 revision → blob 行消失 → 另一条 entry 的 `read` 抛
`vfs_content_blob 缺失: <hash>`（`sqlite-vfs-content-store.ts:98`），文件**永久不可读**，
只能重新导入。（`SqliteVfsContentStore.gc()` 的 `NOT IN` 把 entry 也算进引用集，
恰恰说明这个不可见性是已知的；触发器没跟上。）
注：`decoded-content-cache` 的 LRU 会在同进程内掩盖它（模块头 :25-29 明确写了「热态静默成功」），
所以**重启后才暴露**——更难排查。

**建议**：要么在 entry 侧也建引用触发器，要么把 DELETE 触发器的删除条件加上
`AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash)`。

---

### F-w4-vfsstore-pro-9 | P2 | `service/vfs/impl/revision-aware-vfs.service.ts:514-517, 534-552` | 置信 confirmed

```ts
await appendDeletedRevision(revisionRepo, entry.entryId, entry.version); // 内部 adjustRef(+1)
await adjustRef(revisionRepo, entry.entryId, entry.version, -1);
await entryRepo.delete(scopeKey, path, { recursive: false });             // entry 行没了
```

**描述**：软删（`deleteWithRevision`）给墓碑 revision 打 `ref_count = +1`（当作 live head 引用），
随后 entry 行被物理删除，但**这个 live head 引用永远没有释放**。`hardDelete`
（同文件 `:227-249`）有明确的 `adjustRef(-1)` 释放步骤，软删没有。

**后果链**：墓碑行 `ref_count = 1` 且 `entry_id` 已成孤儿。
`deleteUnreferencedUnderScope` JOIN 不到 entry（扫不到）；`deleteGlobalOrphans` 要求
`ref_count <= 0`（也扫不到）；`repairRefCounts` 是「只上调」地板修复（修不了偏高）。
**每一次 `rm` 一个文件就永久留一行**。内容上是 tombstone（`content_hash = NULL`）所以不钉 blob，
但 `vfs_revision` 是本仓占比最大的表（`RULE.md:108` 实测 82.6%），单调增长不可忽视。
`appendDeletedRevisionsForSubtree`（`:448-484`，递归删目录）同样如此，且一次 N 个文件。

**建议**：在 `entryRepo.delete` 之后，对刚写的墓碑版本补 `adjustRef(-1)`，或改为删 entry 前
统一走 `decrementLiveRefsUnderScope`。

---

### F-w4-vfsstore-pro-10 | P2 | `domain/vfs/logic/vfs-copy.ts:46-54` | 置信 confirmed

```ts
const entries = await vfs.list(oldDir, { recursive: true });
const hasDirRow = entries.some((e) => e.kind === "directory" && e.path === oldDir);
if (entries.length === 0 && !hasDirRow) { throw vfsNotFound(from); }
```

**描述**：`hasDirRow` **恒为 false**。`SqliteVfsEntryRepository.list`
（`sqlite-vfs-entry.repository.ts:79-83`）的 WHERE 是 `path LIKE '<dir>/%'`，**永远不含目录
自身**；`DefaultVfsService.list`（`vfs.service.ts:45-60`）原样返回。

**后果链**：`fs cp -r /空目录 /新目录`（`domain/tool/logic/fs-command.ts:208`）→
`vfs.read(from)` 抛 `IS_DIRECTORY` 被吞 → `list` 返回 `[]` → `hasDirRow` false →
抛 **`vfsNotFound`**。空目录复制恒失败。
对照 `moveVfsPath`（`vfs-move.ts:191-197`）专门用 `sawDirectoryRow` 处理了同一场景并有注释
「空目录（有 directory 行、零子项）同样允许 rename」——**cp 与 mv 对空目录行为不一致，
cp 侧是漏修**。

**建议**：`vfs.read` 捕到 `IS_DIRECTORY` 时即视为「目录存在」，删掉 `hasDirRow` 这段死代码。

---

### F-w4-vfsstore-pro-11 | P2 | `content-store/impl/sqlite-vfs-content-store.ts:207-221` | 置信 confirmed

```sql
DELETE FROM vfs_content_blob WHERE content_hash NOT IN (
  SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL
  UNION
  SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL
)
```

**描述**：每次 GC 都对 `vfs_entry` ∪ `vfs_revision` 做全量物化再取补集。`NOT IN (subquery)`
会为子查询建临时 B-tree。`vfs_revision` 是全仓最大表（`RULE.md:108`：82.6% / 10.7MB 量级），
`runDeferredBlobGc` 被挂在 6 条热路径上（`message.service.ts:263`、`project.service.ts:194`、
`session.service.ts:195`、`user-vfs-turn.service.ts:135`、
`service/template/impl/template-pull.service.ts:35/48`），每次删消息 / 删项目 / 删会话 /
模板拉取都全表扫一次。`vfs_entry.content_hash` / `vfs_revision.content_hash` 上**都没有索引**
（`vfs-schema.ts:31-32` 只建了 `(scope_key, path)`）。

**建议**：改成 `DELETE ... WHERE ref_count <= 0 AND NOT EXISTS (SELECT 1 FROM vfs_entry
WHERE content_hash = vfs_content_blob.content_hash)`——`vfs_content_blob` 自身是
WITHOUT ROWID + `content_hash` 主键，驱动是主键 seek 而不是全表物化；entry 侧加一个
`(content_hash)` 索引即可。（注意此改法**不能**省掉 entry 侧判定，否则会踩 F-8。）

---

### F-w4-vfsstore-pro-12 | P2 | `service/vfs/impl/revision-aware-vfs.service.ts:405-412` + `sqlite-vfs-entry.repository.ts:388-410` | 置信 suspected

**描述**：并发写同文件时，`nextVersionFor` 读 `max(head, MAX(version))`，随后
`applyContentHashUpdate` 无版本守卫地 UPDATE，再回查 `head_version`。
两个并发写都取到 `N+1` → 后者覆盖 entry → 双方各自 append `(entryId, N+1)` →
第二次撞 `PRIMARY KEY (entry_id, version)`，抛裸 `TdbcError`（不是 `VfsError`，
不经过 `formatVfsErrorForLlm` 的分类），用户/模型看到的是 SQLite 原文。
这与 `entry-sequence-repair.ts:9-13` 记录的「UNIQUE constraint failed: vfs_revision.entry_id,
vfs_revision.version」症状同源。

**决策感知**：`docs/apm/RULE.md:83` 明确「无锁 last-write-wins，pathTail 是唯一保护层，
两处盲区拍板接受」。**并发语义本身是 intentional，不当问题报**；这里报的是它的**次生效应**：
失败不是「后写覆盖先写」这一被接受的语义，而是**硬失败 + 裸 SQL 错误文案**，
且 `applyContentHashUpdate` 的回查（`:403-410`）在真并发下会返回**别人**写的版本号，
再被 `writeWithRevision` 拿去 `transferLiveRef` → 引用计数打在错误版本上。
这两点不在「拍板接受」的措辞覆盖范围内。

**建议**：把 revision append 的 UNIQUE 冲突翻译成 `VfsError CONFLICT`；
`applyContentHashUpdate` 的回查改成「UPDATE ... RETURNING head_version」或直接用
调用方传入的 `nextVersion`，不要二次读。

---

### F-w4-vfsstore-pro-13 | P2 | `service/vfs/impl/vfs-batch-io.service.ts:296-305` | 置信 confirmed

**描述**：`applyBatchIngest` 把**整批**写入放在**单个事务**里，逐文件
`await writeOrUpdateFile(...)`，每个文件内部还有 `ensureParentDirectories`（逐级
`findByPath`）与 `findByPath`。N 个文件 ⇒ 约 3N 次 SQL 往返全在一个事务里。

**后果链**：批量导入 500 个文件的事务持锁时间与 UI 提交链叠加；这是桌面端「导入文件夹」
的主路径。`writeOrUpdateFile` 也没有复用已有的 `batchInsertFileEntriesWithHash`
（`sqlite-vfs-entry.repository.ts:822-839`）——树拷贝侧已经批量化了，ingest 侧没有，
两套写路径的批量化程度不一致。

**建议**：复用 `batchInsertFileEntriesWithHash` / `findContentHashesByPaths` 做批量预检 +
批量 INSERT，把 3N 降到 O(N/chunk)。

---

### F-w4-vfsstore-pro-14 | P2 | `domain/vfs/logic/user-vfs-save-mapping.ts:136-159` | 置信 confirmed

```ts
const maxRadius = Math.max(baselineLines.length, savedLines.length);
for (let radius = 0; radius <= maxRadius; radius++) { ... countOccurrences(baseline, oldString) ... }
```

**描述**：`expandAnchorHunk` 为了找「在 baseline 中唯一出现」的锚点，半径从 0 扩到
`max(行数)`，**每一轮都对整份 baseline 做一次全串 `indexOf` 扫描**。
无唯一锚点时（改写整章、批量替换、或只是重复段落多）退化为 O(行数 × 正文字符)。
这是**用户每次保存**都会走的路径（`readUserVfsSaveBaseline` → `mapUserSaveToToolUses`）。

**建议**：先用一次哈希索引统计各行/各块出现次数，或对 radius 步进（1,2,4,8…）做指数扩张；
上限封顶后直接落 `anchor-not-unique` → `write` fallback（fallback 分支已经存在，
`:220-227`）。

---

### F-w4-vfsstore-pro-15 | P2 | `service/vfs/impl/vfs.service.ts:179-190` + `service/vfs/impl/scoped-vfs.service.ts:106-124` | 置信 confirmed

**描述**：`grep` 把 `pathPrefix` 下推到了 SQL（`scanContents(scopeKey, pathPrefix)`），
但 `pathGlob` 留在应用层过滤——而且过滤发生在 `scanContents` **已经把整个 scope 的正文
全部解压进内存之后**（`sqlite-vfs-entry.repository.ts:852-898` 的 `resolveScanRows` 走
`contentStore.getMany` 批量解 zlib）。

**后果链**：一次 `grep "**/*.md"` 会把会话工作区几百 KB~几 MB 正文全量 inflate 一遍，
再丢掉 90%。`resolveScanRows` 还在任一 blob 缺失时**直接抛**（`:882`），一个坏文件让整个
scope 的 grep 失败。`matchGlob` 在 `ScopedVfsService` 又做了一遍（`:121-123`），
`DefaultVfsService.grep:185-188` 里还有第三遍——同一个谓词三处。

**建议**：`pathGlob` 在有 `pathPrefix` 时可安全下推成更窄的 LIKE 前缀；至少把
`matchGlob` 收敛成一处。另外 `vfs-grep.ts:171-177` 在 `contextLines > 0` 时对同一行的
每个命中列都重算一次 `buildExcerpt`（同样的串），可以提到列循环外。

---

### F-w4-vfsstore-pro-16 | P2 | `domain/vfs/logic/vfs-grep.ts:39-42, 59-64` | 置信 suspected

**描述**：`matchMode: "auto"`（默认）会把**模型给的 pattern 直接 `new RegExp`**
（`:61`），编译失败才退化为字面量。编译成功但灾难性回溯的 pattern（`(a+)+b` 之类）
在长行上会长时间阻塞。另外 `matchColumns`（`:72-83`）对单行无限收集命中列，无上限。

**后果链**：这是 agent 工具的输入面，pattern 由 LLM 决定。在 UI 线程同进程里
（Hermes）表现为界面卡死。`escape` / 长度 / 命中数三重闸门都没有。

**建议**：`auto` 模式加一个「简单性」判定（只允许字面量/简单字符类），
`regex` 模式显式加长度与命中数上限；`matchColumns` 加 `maxColumns`。

---

### F-w4-vfsstore-pro-17 | P2 | `service/vfs/impl/physical-vfs.service.ts:284-293, 508-530` | 置信 confirmed

**描述**：`hasSessionEntries` 对**每个会话**发一次前缀查询
（`listEntriesUnderPrefix(scopeKey, "/")`）。`listSessionsUnderProject:313-320` 用
`Promise.all` 并发跑，`sessionsTreeRows:508-530` 在 BFS 循环里**串行**逐个跑。

**后果链**：一个有 N 个会话（含子 agent 会话）的项目，打开
`/projects/{pid}/sessions` 或 `listTree("/")`（后者还会为**每个项目**跑一遍
`projectsTreeRows:440-448`）就是 N 次全前缀扫描。子 agent 会话多的项目会明显卡。

**建议**：一条 `SELECT scope_key, COUNT(*) FROM vfs_entry WHERE scope_key IN (...) GROUP BY
scope_key` 批量判定，或用 `computeEntrySignature` 那样的单行聚合。

---

### F-w4-vfsstore-pro-18 | P2 | `logic/restore-mutating-path-heads.ts:178-180` | 置信 suspected

```ts
for (const file of snapshot.files) {
  await vfs.resetHeadToVersion(file.path, file.version);
}
```

**描述**：`restoreDirectorySnapshot` 对快照内每个文件调 `resetHeadToVersion`，而
`RevisionAwareVfsService.resetHeadToVersion:170-177` 在 **entry 行缺失时直接抛 NOT_FOUND**
（注释明写「entry 缺失（已被 hardDelete 且 revision 无 entry 可挂）时直接抛 NOT_FOUND」）。
补偿路径里**没有**「entry 没了就 `reviveEntryAtVersion` 复活」的分支。

**后果链**：若一次失败的批量 op 删掉了快照里的某个文件，回滚会抛
`MutatingPathRestoreCompositeError`（`:219-221`），该文件**永久丢失**而不是被恢复。
快照类型本身有 `kind: "present"`（`:18-23`）承载 content，说明设计时就考虑过「内容在手」，
但 restore 侧只用了 version 没用 content。

**建议**：`present` 快照已经存了 content，回滚时 entry 缺失就按 content 走
`reviveEntryAtVersion` + `setHeadContentHash` 复活，与 `domain/message-checkpoint/logic/revive-deleted-entry.ts`
的既有做法对齐。

---

### F-w4-vfsstore-pro-19 | P3 | `repositories/impl/sqlite-vfs-revision.repository.ts:322-359` + `:583-616` | 置信 confirmed

**描述**：两处 GC 的返回值都不是实际删除行数。
`deleteExceptReachable:356` 用 `deleted += chunk.length`（**尝试**条数，不是 changes）；
`deleteUnreferencedUnderScope:594-615` 返回 DELETE **之前**的 `SELECT COUNT(*)`。

**后果链**：并发下（写侧无锁）两个数都会虚高，调用方拿它做「回收了多少」的诊断会误导。
`deleteGlobalOrphans:629` 用的是 `result.changes`，是对的——三个同类 API 三种口径。

**建议**：统一读 `ExecuteResult.changes`；`deleteUnreferencedUnderScope` 直接返回 DELETE
语句的 changes（前置 COUNT 只在 count===0 时用来早退）。

---

### F-w4-vfsstore-pro-20 | P3 | `repositories/vfs-revision.port.ts:100, 176` | 置信 confirmed

**描述**：`deleteExceptReachable`（38 行 + 分块 DELETE 循环）与逐条版
`repairRefCountFloor` 在**生产代码里零调用方**——`git grep` 只命中 port 声明、impl 实现，
以及测试桩。`deleteExceptReachable` 唯一真实用例是
`test/message-checkpoint/rollback-reach-hash-batch.test.ts:207`，而
`rollback-execution-redesign.test.ts:77-109` 反而**断言它不被调用**
（回滚热路径已改走 ref_count）。`revision-gc.ts:31-33` 也写明「本函数仅保留原签名以兼容调用方」。

**后果链**：两个 port 方法是「测试为了满足 interface 而实现的空壳」，会给读者造成
「回滚还有可达集兜底路径」的错误印象，也是不必要的 interface 面积。

**建议**：从 port 与 impl 移除，或标 `@deprecated` 并注明「仅历史回滚实现参考」。

---

### F-w4-vfsstore-pro-21 | P3 | `logic/strip-known-physical-prefixes.ts:8-12` | 置信 confirmed

```ts
const GLOBAL_META_PREFIX = /\/meta(?=\/|$)/g;
const GLOBAL_TEMPLATE_PREFIX = /\/template(?=\/|$)/g;
```

**描述**：entry_id 化之后 `vfs_entry.path` 与 `VfsError.path` 存的已经是**纯逻辑路径**
（`format-vfs-error-for-llm.ts:19-21` 的注释确认），但这两个「脱敏」正则仍按物理前缀语义
全串匹配。逻辑路径里只要有名为 `meta` / `template` 的中间目录就会被啃掉。

**后果链**：`/notes/meta/x.md` → 错误文案变成 `/notes/x.md`；`/书稿/template/正文.md` →
`/书稿/正文.md`。`formatVfsErrorForLlm` 的 `default` 分支（`:105`）与
`extractInvalidPathReason`（`:35`）都走这里，于是**报错指着一个不存在的路径**，
把 agent 带偏。

**建议**：`format-vfs-error-for-llm.ts:23-31` 已经不再做物理→逻辑转换，
`stripKnownPhysicalPrefixes` 在这条链上应退役或改成「只在已知物理上下文里调用」。

---

### F-w4-vfsstore-pro-22 | P3 | `logic/parent-dir.ts:18-33` | 置信 confirmed

**描述**：`isStorageRootParent` 硬编码 `/template`、`/projects/{pid}/template`、
`/projects/{pid}/sessions/{sid}` 三个**物理**前缀，并被
`DefaultVfsService.mkdir:75` / `write` 链路 / `ensureParentDirectories:19-23` 用来
「跳过父目录存在性校验」。entry_id 化后这些前缀在**逻辑路径**空间里不该存在。

**后果链**：在 session scope 里建一个逻辑目录 `/projects/p1/sessions/s2`
（`assertLogicalPathAllowed` 不拦，只有 `/template` 被拦），它的子目录
`mkdir /projects/p1/sessions/s2/x` 会因为「父是虚拟 storage root」而**跳过
`vfsParentNotFound` 校验**，在父目录行不存在时也判成功。`/template` 那条同理
（`toPhysicalPath` 侧拦了输入，但这三个函数是按逻辑路径直接调的）。

**建议**：entry_id 化后 storage root 恒为 `/`，这三个物理前缀判定应删除；
`/template` 逻辑名的保护已在 `assertNormalizedPathAllowed` 里做了。

---

### F-w4-vfsstore-pro-23 | P3 | `logic/vfs-zip-validate.ts:55-60` | 置信 confirmed

```ts
if (entryName.includes("..")) {
  throw vfsZipError("INVALID_PATH", `parent segment in ZIP entry: ${entryName}`);
}
```

**描述**：`..` 用**子串包含**判定，而不是「路径段等于 `..`」。合法文件名
`第1..2章.md`、`v1.2..3.txt`、`a..b` 全部被拒。

**后果链**：用户导入一个含这类文件名的 ZIP 直接失败，报错文案说「parent segment」，
与真实原因（文件名里有连续点）完全对不上，排查成本高。

**建议**：改成按段判定 `entryName.split("/").some((s) => s === "..")`。

---

### F-w4-vfsstore-pro-24 | P3 | `logic/user-vfs-save-mapping.ts:188-201, 270-276` | 置信 confirmed

**描述**：两个签名有**哑参数**：
`mapUserSaveToToolUses(baseline, _saved, path, fileContentAtSave, ...)` 同时收
`saved` 与 `fileContentAtSave` 两个内容参数，实际只用后者（`:195` `const content = fileContentAtSave`）；
`buildUserVfsSaveWriteActionXml(path, _reason, content = "")` 的 `_reason` 完全未用，
且 `content` 默认为空串。

**后果链**：调用方传不同的 `saved` / `fileContentAtSave` 会静默按后者算，行为不可预期；
漏传第三个参数的调用会生成 `content: ""` 的 write action XML——回放时**清空文件**且无提示。

**建议**：删掉 `_saved`（或反过来统一用 `saved` 并去掉 `fileContentAtSave`）；
`content` 去掉默认值改成必填。

---

### F-w4-vfsstore-pro-25 | P3 | `logic/longest-common-substring.ts:19-34` vs `logic/user-vfs-save-mapping.ts:55-70` | 置信 confirmed

**描述**：两个同名 `countOccurrences`，语义**相反**：
前者 `start = index + 1`（统计**重叠**出现），后者 `pos = idx + needle.length`（统计**非重叠**）。
两处都在各自模块内 private/export，未共享。

**后果链**：`buildReplaceNotFoundError:57` 用重叠版（对，诊断要的是「出现几次」），
`expandAnchorHunk:152` 用非重叠版判「是否唯一」。同一种「出现次数」概念两种口径，
后续谁复用谁踩坑；`vfs-grep` 里还有第三份（按列收集）。

**建议**：抽到 `logic/` 下的单一工具，参数化重叠语义，或至少改名区分
（`countOverlappingOccurrences` / `countNonOverlappingOccurrences`）。

---

### F-w4-vfsstore-pro-26 | P3 | `repositories/impl/sqlite-vfs-entry.repository.ts:632-647` | 置信 confirmed

```sql
SELECT count(*) AS entry_count, group_concat(s, char(31)) AS sig
FROM (SELECT path || ':' || head_version || ':' || mtime_ms AS s FROM vfs_entry WHERE scope_key = ? ORDER BY path)
```

**描述**：`computeEntrySignature` 对整个 scope 做 `group_concat`，**无长度上限**，
在 `workplace.service` 的 live view 里每次组装都调（`test/workplace/workplace-view-cache.test.ts:8`
的注释说它是「单行聚合 SQL」）。scope 文件多时（项目模板几百文件、session 几千）会构造
几百 KB 的字符串。

**后果链**：签名唯一可由前端的 `count` 部分短路（`${count}|${sig}`，count 不同则 sig 必不同），
但 SQL 仍把 sig 全量算出来。另外 SQLite 不保证子查询 `ORDER BY` 一定被 `group_concat`
按序消费——测试（`sqlite-vfs-entry.repository.test.ts:315-356`）断言了稳定性，
但那是当前 SQLite 版本的实现行为，不是 SQL 语义保证。

**建议**：改成分段哈希（如 `sum(unicode(substr(s,1,4)))` 之类不可碰撞聚合）或
`group_concat` 加长度截断 + count 兜底；把「排序保证」写成注释并加一条跨版本说明。

---

### F-w4-vfsstore-pro-27 | P3 | `repositories/impl/sqlite-vfs-entry.repository.ts:210-266` vs `:88-101` | 置信 confirmed

**描述**：同一处损坏（`content_hash` 有值但 blob 行不在）在两条读路径上语义相反：
`read`（`resolveScanRows:882` / `content-store:98`）**抛错**，
`findContentSizeByPath:248-250` 却 **返回 `null`**。

**后果链**：`findContentSize` 的 null 在 workplace live view 里被渲染成「大小未知」占位块，
把一次数据损坏伪装成正常的空态；而同一文件 `read` 会崩。排查时两个症状对不上号。

**建议**：`findContentSizeByPath` 对「有 hash 但 blob 缺失」抛与 read 同源的错，
只对「目录 / entry 不存在」返回 null。

---

### F-w4-vfsstore-pro-28 | P3 | `content-store/impl/sqlite-vfs-content-store.ts:47-77` | 置信 suspected

**描述**：`put()` 是 SELECT-then-INSERT（`:49-59` 查、`:64-75` 插），中间没有
`ON CONFLICT DO NOTHING`，也没有重试。

**后果链**：同一 hash 被两个并发事务 put 时，两边都走「不存在」分支，第二次 INSERT 撞
`vfs_content_blob` 的 `content_hash` 主键 → 裸 SQLite 错误。写侧无锁是 intentional
（`RULE.md:83`），但**同内容去重的 INSERT 冲突**不在「last-write-wins」语义覆盖范围内——
它不是「后写覆盖」，是失败。`copyVfsTree` 的 `findExistingBlobHashes` + 后续
`ensureBlob`（`vfs-tree-copy.ts:220-224, 270-274`）也是同样的 check-then-act。

**建议**：`INSERT ... ON CONFLICT(content_hash) DO NOTHING`（保持 `put` 恒返回 hash 的语义），
消除竞态窗口。

---

### F-w4-vfsstore-pro-29 | P3 | `service/vfs/impl/revision-aware-vfs.service.ts:302-315` | 置信 suspected

```ts
try { return await conn.transaction(fn); }
catch (error) {
  if (error instanceof TdbcError && error.code === "NESTED_TRANSACTION") { return fn(conn); }
  throw error;
}
```

**描述**：catch 无法区分「`conn.transaction` 在 BEGIN 处就抛 NESTED」（正常嵌套，
重跑正确）与「`fn` 执行到一半，某次深层 `conn.transaction` 抛 NESTED 冒泡上来」
（此时外层已回滚，重跑会在**无事务**下把整个 `fn` 再执行一遍）。
`skills.service.ts:470-472` 的注释说明这种深层嵌套在本仓是真实拓扑（事务内建 scoped vfs）。

**后果链**：重跑本身在数据上是安全的（外层已回滚），但那次执行**没有事务**——
`writeWithRevision` 的「put blob → UPDATE entry → append revision → transferLiveRef」
变成非原子，中途失败会留下 head_version 与 revision 不一致的状态（同 F-4 的形态）。
另外 `error instanceof TdbcError` 依赖驱动不包装异常；`skills.service.ts:475-476`
自己写了「事务内抛的业务错误会被 driver 包装成 TdbcError(SQLITE_ERROR)」，
说明包装行为存在，两种判定并存。

**建议**：把「是否已开事务」的判断提到调用前（暴露一个 `inTransaction` 标记或
显式传 tx），不要靠捕获异常码；或至少在重跑分支加日志以便观测。

---

### F-w4-vfsstore-pro-30 | P3 | `logic/vfs-zip-parse.ts:41-56` + `vfs-zip-filename-decode.ts:21` | 置信 confirmed

**描述**：`decodeZipEntryName` 在 EFS 位为真时用
`new TextDecoder("utf-8", { fatal: true })`，非法 UTF-8 会抛裸 `TypeError`。
`parseVfsZip` 的 catch（`:44`）把它当 `centralDirError` 吞掉，**静默切到 fflate 回退**。

**后果链**：一个「EFS 位标了但文件名不是合法 UTF-8」的 ZIP 会走完全不同的解码路径
（fflate 内部策略不同），最终条目名可能与预期不一致，且用户看不到任何「格式异常」信号——
错误被降级成了「换个 parser 试试」。

**建议**：`parseZipCentralDirectory` 内把解码异常转成 `vfsZipError("INVALID_ZIP", ...)`，
让回退只对「结构不识别」生效。

---

### F-w4-vfsstore-pro-31 | P3 | `repositories/impl/sqlite-vfs-entry.repository.ts:127` | 置信 intentional

**描述**：`findByPath` 仍然 SELECT `content` 内联列，而
`insert`/`insertAtVersion`/`insertWithContentHash`/`setHeadContentHash`/`batchInsert*`
**全部写 `content = NULL`**（`:288, 307, 320, 338, 457, 831, 846`）——
`vfs_entry.content` 在当前代码里是**只读不写**的僵尸列。

**决策感知**：`bootstrap/vfs/vfs-schema.ts:7-8` 明写「`content TEXT NULL` 保留
（§A：暂不删该列，数据模型终态图保留它）」，`resolve-stored-content.ts:52-55`
与 `findContentSizeByPath:215-216` 也明确把遗留明文当迁移窗口支持。
**这是 intentional，不当缺陷报**。此处只留一条气味记录：这条 SELECT 让每次
`findByPath` 多带一列（迁移后恒为 NULL，代价可忽略），但它同时是
`resolveEntryPlainContent` 遗留分支的唯一数据来源——**删列前必须先确认最低支持库版本
已无迁移窗口行**。

---

### F-w4-vfsstore-pro-32 | P3 | `logic/vfs-move.ts:122-129` | 置信 confirmed

**描述**：`assertMoveTargetAvailable` 第二段
`entries.some((e) => e.kind === "directory" && normalizeDirPath(e.path) === normalizedTo)`
与 F-10 同源——`vfs.list(to)` 只返回 `to` 的子项，**永远不会包含 `to` 自身**，
`hasDirRow` 恒 false。

**后果链**：无害（`entries.length > 0 ||` 已覆盖隐式目录；`read(to)` 的
`IS_DIRECTORY` 分支 `:114-116` 已覆盖显式空目录），但它让读者以为「list 会返回目录行」，
与 `vfs.service.ts:53-57` 里那句「list 只返回子项、不含目录自身行」的注释矛盾。
死条件 + 误导性注释。

**建议**：删掉 `hasDirRow`，保留 `entries.length > 0`。

---

## 争议与存疑

1. **F-1（renamePrefixInScope 的 REPLACE）我给 confirmed，但没跑真机/SQLite 复现**——
   worktree 是只读 CR 环境。推理依据是 SQLite `REPLACE()` 的定义（替换全部出现），
   加上 `WHERE` 只约束行集合不约束替换位置。若裁决代理能起一个 better-sqlite3 复现，
   建议优先验证这条（它是本轮唯一会**静默损坏用户数据**的发现）。

2. **F-8（blob 触发器不看 vfs_entry）我标 confirmed 而非 P0**：触发器删除逻辑本身
   写得没错，缺的是「entry 侧也有引用」这一前提；而这个前提在健康库上成立
   （每个 entry 的 head 都有对应 revision 且 ref>=1）。它之所以成为现实风险，
   依赖 F-3 / F-4 先造出「entry 有 hash 但无 revision」的行。所以**修 F-3 / F-4
   能消掉大部分触发条件**，但触发器侧的防御缺失本身仍应单独修（未来任何新写口都可能重犯）。

3. **F-2 与 F-9 是否重复计数**：F-2 是「顺序错导致 scoped sweep 恒删 0 行」，
   F-9 是「软删墓碑的 live ref 从不释放」。两条路径都会留孤儿行，但**留的行不同**：
   F-2 留的是 ref=0 的历史版本（理论可被 `deleteGlobalOrphans` 收），
   F-9 留的是 ref=1 的墓碑（连兜底都够不着）。修 F-2 不能修 F-9，反之亦然。

4. **F-12 与 `RULE.md:83` 的边界**：我承认并发语义本身是拍板接受的。报它是因为
   「并发 → 裸 SQLite 错误 + 回查读到别人的版本号导致 ref 打在错行」这两条
   **不是**「后写覆盖先写」这个被接受的语义的一部分。如果裁决代理认为这属于
   同一盲区的自然外延，可降为 intentional——但我倾向于保留，理由是
   `applyContentHashUpdate` 的回查是**新引入的第三种行为**（覆盖写回 + 二次读），
   RULE 的措辞没有覆盖它。

5. **`vfs_entry.content` 僵尸列（F-31）我没报 P2**：DDL 注释已明确保留，
   读侧遗留分支也有注释。列在这里主要是提醒 W6 验证代理：任何「删 content 列」的
   优化必须先确认 `assertMinimumBaseline` 之后没有迁移窗口行。

6. **未覆盖**：`vfs-zip-central-dir.ts` 的 `readLocalEntryData` 越界读我判断是安全的
   （`readUInt32LE` 对越界索引返回 `undefined`，`| undefined` 归零，随后 LOCAL_FILE_HEADER_SIG
   校验必然失败并抛错），故未单列。`vfs-grep` 的 `invert` 模式固定 `column: 1`
   属于设计选择，未报。
