---
zone: w4-vfsstore-adv
agent: 辩护人（adversarial advocate）
files_scanned: 34
---

# W4 对抗机位 · VFS 内容存储（辩护人报告）

> 立场：对 `packages/core/src/domain/vfs` 的设计**做辩护**——论证内容寻址、触发器维护
> `ref_count`、双计数器分层、无锁 GC 决策、path mapper 非对称前缀等设计的**合理性与必要性**。
> 同时按纪律输出「确无辩可解」的让步清单，不为包庇设计而隐瞒实证缺陷。
> **独立性声明**：全程未读取 `docs/Iterations/repo-mega-cr-2026-10/raw/` 下任何文件。

---

## 摘要

VFS 内容存储把用户文件正文从 entry/revision 行里剥离，按明文 SHA-256 内容寻址落到
`vfs_content_blob`（zlib + BLOB），`vfs_entry` / `vfs_revision` 只存 `content_hash` 指针。
revision 追加式历史链由 `vfs_revision.ref_count`（应用层，checkpoint 指针 + live head 计数）
判可达性，blob 侧由三个 SQLite 触发器维护独立 `ref_count` 判存储回收。GC 一律走
deferred 入口 + 全库引用集 NOT IN，绝不用会话局部 keepSet。path mapper 把 5 个可见域
映射到 `vfs_entry.path` 物理路径。

## 职责与边界

**职责**

1. **内容存储**（`content-store/`）：明文 → SHA-256 → zlib → BLOB 落 `vfs_content_blob`；
   读侧三形态兼容解码；批量读（`getMany`）；存在性批量探测（`findExistingBlobHashes`）；
   承诺式补写（`ensureBlob`）；全库引用集 GC（`gc`）。
2. **revision 链**（`repositories/impl/sqlite-vfs-revision.repository.ts` + `logic/revision-ref-count.ts`）：
   append-only 历史、`(entry_id, version)` 复合 PK 寻址、可达性计数维护、计数地板修复、
   孤儿清扫。
3. **GC 编排**（`logic/deferred-blob-gc.ts`、`message-checkpoint/logic/revision-gc.ts`）：
   单一 deferred 入口 + scoped/global 两段扫。
4. **结构变换**（`logic/vfs-tree-copy.ts`、`vfs-copy.ts`、`vfs-move.ts`、
   `vfs-rename-primitive.ts`、`restore-mutating-path-heads.ts`）：树拷贝 / 子树替换 /
   文件目录移动 / 前缀重命名 / 失败补偿回滚。
5. **路径映射**（`logic/vfs-path-mapper.ts`）：5 个 VfsScope ↔ `vfs_entry.path` 双向映射 +
   `scope_key` 编码。

**明确不在边界内**：SQLite DDL 本体在 `bootstrap/vfs/`；service 编排（write/delete 事务、
补偿）在 `service/vfs/impl/`；checkpoint 指针的生产/消费在 `domain/message-checkpoint/`；
进程内解压缓存（`infra/content-cache/`）虽被本区读侧强依赖，但归属 infra。

## 对外接口

| 符号 | 位置 | 性质 |
|---|---|---|
| `VfsContentStore`（put/get/getMany/gc/ensureBlob/findExistingBlobHashes） | `content-store/vfs-content-store.port.ts:10-64` | 端口 |
| `SqliteVfsContentStore` | `content-store/impl/sqlite-vfs-content-store.ts:42-222` | 唯一实现 |
| `hashContent` | `content-store/logic/hash-content.ts:15-18` | 纯函数（noble SHA-256） |
| `compressZlib` / `decompressZlib` / `decodeCompressedBytes` / `tightBytes` | `content-store/logic/zlib-codec.ts:27-125` | 三方共用封装 |
| `resolveEntryPlainContent` / `resolveRevisionPlainContent` / `nullableText` | `content-store/logic/resolve-stored-content.ts:22-71` | NULL 读路径 |
| `runDeferredBlobGc` | `logic/deferred-blob-gc.ts:15-18` | **blob GC 唯一入口** |
| `adjustRef` / `transferLiveRef` / `increment/decrementRefsForCheckpointFiles` | `logic/revision-ref-count.ts:29-74` | 计数维护 |
| `repairRefCounts` / `createRevisionRefCountRepairOperation` | `logic/revision-ref-count.ts:98-195` | 地板修复（只增不减） |
| `decrementLiveRefsUnderScope` | `logic/revision-ref-count.ts:200-219` | 会话删除 Step 2 |
| `createVfsEntrySequenceRepairOperation` | `logic/entry-sequence-repair.ts:58-89` | 发号器兜底 |
| `copyVfsTree` / `replaceVfsSubtree` / `sweepRevisionsUnderScope` / `deleteVfsPrefix` | `logic/vfs-tree-copy.ts:139-463` | 树级变换 |
| `copyVfsPath` / `moveVfsPath` / `assertMoveTargetAvailable` / `remapPathUnderDir` | `logic/vfs-copy.ts:26-82`、`logic/vfs-move.ts:18-221` | 路径级变换 |
| `captureMutatingPathHeadSnapshots` / `restoreMutatingPathHeads` | `logic/restore-mutating-path-heads.ts:81-222` | 补偿回滚 |
| `toPhysicalPath` / `toLogicalPath` / `scopeKey` / `scopePhysicalPrefix` | `logic/vfs-path-mapper.ts:87-226` | 路径映射 |
| `seedLiveHeadRevisionsUnderPrefix` / `insertFileSeedingRevision` | `logic/seed-live-head-revisions.ts:24-137` | live head 补种 |

## 数据访问

**表**（DDL 在 `bootstrap/vfs/`）

| 表 | 主键 / 约束 | 本区访问点（file:line） |
|---|---|---|
| `vfs_content_blob` | `content_hash` PK，`WITHOUT ROWID`，`CHECK (ref_count >= 0)` | `sqlite-vfs-content-store.ts:52`（SELECT）、`:67`（INSERT）、`:94`（get）、`:145`（getMany IN 分块）、`:177`（findExisting）、`:213`（gc DELETE NOT IN） |
| `vfs_revision` | `(entry_id, version)` PK，`WITHOUT ROWID`，`CHECK (NOT (status='active' AND content_hash IS NULL))` | `sqlite-vfs-revision.repository.ts:75`、`:108`（MAX GROUP BY）、`:260`（batch INSERT）、`:285`（append）、`:353`（deleteExceptReachable DELETE）、`:372`（adjustRef UPDATE）、`:439`（batchAdjustRefCount UPDATE）、`:468`（repairRefCountFloor）、`:538`（batchRepair）、`:604`（deleteUnreferencedUnderScope DELETE）、`:55-58`（ORPHAN_REVISION_GC_SQL） |
| `vfs_entry` | `entry_id` AUTOINCREMENT PK，`UNIQUE(scope_key, path)` | `sqlite-vfs-entry.repository.ts:287`（INSERT）、`:391`（UPDATE head）、`:494`/`:506`（DELETE）、`:831`（batch INSERT file）、`:846`（batch INSERT dir）、`:912`（renamePath UPDATE）、`:936`（renamePrefix REPLACE UPDATE） |
| `message_checkpoint_file` | 只读 | 经 `MessageCheckpointRepository.listFilePointersForSession` → `revision-ref-count.ts:113` |

**触发器**（`bootstrap/vfs/vfs-revision-schema.ts:33-68`，全仓仅此 3 个 `CREATE TRIGGER`）

- `trg_revision_insert_inc_blob_ref`（`:35-41`）：AFTER INSERT，content_hash 非 NULL → blob +1
- `trg_revision_delete_dec_blob_ref`（`:45-54`）：AFTER DELETE → blob −1 且 `ref_count <= 0` 即删行
- `trg_revision_update_transfer_blob_ref`（`:58-68`）：**AFTER UPDATE OF content_hash** → 旧 −1 / 新 +1

**KKV 域**：本区不直连 KKV。间接依赖 `nm-blob-binary`（`blob-binary-normalization.ts:60-66`
对 `vfs_content_blob` 做 encoding 归一）。

**文件路径**：本区**不触碰文件系统**，纯 SQLite。

**跨表读**：`sqlite-vfs-entry.repository.ts:241-255`（`findContentSizeByPath` 读 blob.byte_len）、
`sqlite-vfs-revision.repository.ts:588-590` / `:608-610`（JOIN `vfs_entry` 圈定 scope 范围）。

## 依赖关系

**import 谁**

- `@/infra/tdbc/*`（`TdbcConnection` / `SqlTemplateParser` / `template-helper`）、`@/infra/sql-template`
- `@/infra/content-cache/logic/decoded-content-cache`（`sqlite-vfs-content-store.ts:22-25`）
- `@noble/hashes/sha2.js`、`fflate`（`hash-content.ts:7`、`zlib-codec.ts:8`）
- `@/errors/vfs-errors`、`@/service/integrity-repair`（**反向依赖 service 层**，见争议 D-1）

**被谁消费**

- `service/vfs/impl/{vfs,revision-aware-vfs,scoped-vfs}.service.ts` —— write/read/delete 事务编排
- `service/chat/impl/{message,session,project,user-vfs-turn}.service.ts` —— fork/copy/删除后 deferred gc
- `service/template/{impl/template-pull,logic/push-session-workspace,logic/initialize-session-workspace}.ts`
- `service/skills/impl/skills.service.ts:440`（sweep）、`:551`（renamePrefix）
- `domain/chat/logic/seed-fork-copy-parity.ts`（fork 播种，唯一自建 repo 的 helper）
- `domain/message-checkpoint/logic/{revision-gc,restore-path,revive-deleted-entry}.ts`
- `infra/db-maintenance/impl/blob-binary-normalization.ts`（表适配器 `vfsContent`）
- `domain/character-card/logic/character-card-limits.ts`（`findContentSize` 降级闸门）
- `domain/tool/builtin/vfs-tools.ts`、`apps/{cli,desktop,mobile}` runtime 工厂

---

## 发现清单

> 辩护人机位的「发现」= **我承认站不住的部分**。设计辩护见下一节。
> 每条带 file:line 与原文引文。

### F-w4-vfsstore-adv-1 | P2 | `packages/core/src/domain/chat/logic/seed-fork-copy-parity.ts:99-100`

```ts
        contentHash: meta.contentHash,
        status: "active",
```

**描述**：`scanFileEntriesWithMeta` 返回的 `contentHash` 类型是 `string | null`
（`sqlite-vfs-entry.repository.ts:757` `nullableText(r.content_hash)`）。此处只判了
`meta == null`（entry 行缺失）就无条件落 `status: "active"`，`contentHash` 为 null 时
直接撞 `vfs_revision` 的 CHECK 约束
（`bootstrap/vfs/vfs-revision-schema.ts:25` `CHECK (NOT (status = 'active' AND content_hash IS NULL))`），
整个 fork/copy 事务回滚。

**同族对照**：语义完全平行的
`seed-live-head-revisions.ts:78` 对同一场景做了降级保护——
`const status = contentHash != null ? "active" : "deleted";`。
两份并行实现，一份防了一份没防，是实现漂移而非设计取舍。

**建议**：`seedForkCopyParity` 的 `meta != null` 分支补同一行三元判定，与
`seedLiveHeadRevisionsUnderPrefix` 对齐；并在两处共用一个
`deriveRevisionStatus(contentHash)` 纯函数，杜绝再次漂移。

**置信**：confirmed（类型面 + CHECK 约束面双向可证；未跑真机复现，但失败模式是硬约束
abort 而非静默）。

### F-w4-vfsstore-adv-2 | P2 | `packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts:49-76`

```ts
    if (existing.length > 0) {
      return contentHash;
    }
    ...
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len)
```

**描述**：`put` 是裸的 SELECT-then-INSERT，无事务、无 `ON CONFLICT DO NOTHING`。
两个并发的同明文 `put` 都读到 0 行时，第二个 INSERT 撞 `content_hash` PK 抛
`UNIQUE constraint failed: vfs_content_blob.content_hash`。端口契约
（`vfs-content-store.port.ts:13`）写的是「同 hash 已存在则复用行」，实现只在单写者下成立。

**当前可达性**：desktop / mobile / CLI 均单连接单写者，且现有 `put` 调用链
（`copyVfsTree` 慢路径 `ensureBlob` 循环、`insertFileSeedingRevision` 循环）都是
顺序 `await`，窗口很窄。`ensureBlob`（`:191-204`）内部同样是
SELECT-then-`put`，把同一竞态形状复制了一份。

**建议**：`INSERT ... ON CONFLICT(content_hash) DO NOTHING` + 无条件返回 hash。
一行改动，语义严格变强（幂等），无副作用。

**置信**：confirmed（代码形状）／suspected（今日生产并发下的实际触发概率）。

### F-w4-vfsstore-adv-3 | P2 | `packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts:213-218`

```sql
      `DELETE FROM vfs_content_blob WHERE content_hash NOT IN (
        SELECT content_hash FROM vfs_entry WHERE content_hash IS NOT NULL
        UNION
        SELECT content_hash FROM vfs_revision WHERE content_hash IS NOT NULL
      )`
```

**描述**：`vfs_entry.content_hash` 与 `vfs_revision.content_hash` **都没有索引**——
`vfs-schema.ts:27-29` 只建 `idx_vfs_entry_scope_path(scope_key, path)`，
`vfs-revision-schema.ts:29-31` 只建 `idx_vfs_revision_entry(entry_id)`。每次
`runDeferredBlobGc` 因此对两张表全表扫描并物化 UNION，且 `NOT IN` 对被驱动物化的
子查询逐行探测。

**可部分辩护但不成立的部分**：deferred 调度确实把**频率**压到删除链上
（`message.service.ts:263`、`session.service.ts:195`、`project.service.ts:194`、
`user-vfs-turn.service.ts:135`），`blob-binary-normalization.ts:336` 也实测百万行
COUNT 为毫秒级。但那约束的是**调用次数**，不是**单次代价**，而建两个索引的写放大
（每条 revision INSERT/DELETE 都要维护）在有触发器的链上同样真实。这不是取舍，
是遗漏。

**建议**：至少给 `vfs_entry(content_hash)` 建索引（entry 侧是 gc 的第一条子查询且
不含 JOIN，收益直接）。revision 侧可与 `idx_vfs_revision_entry` 合并评估。

**置信**：confirmed（逐条核对三份 DDL 常量，确无 content_hash 索引）。

### F-w4-vfsstore-adv-4 | P2 | `packages/core/src/domain/vfs/logic/vfs-move.ts:96-139` + `repositories/impl/sqlite-vfs-entry.repository.ts:912-914`

```ts
      `UPDATE vfs_entry SET path = #{newPath}
       WHERE scope_key = #{scopeKey} AND path = #{oldPath}`,
```

**描述**：`assertMoveTargetAvailable`（先 `read(to)` 再 `list(to)` 证明目标空闲）是
**咨询式**检查，随后 `renamePathInScope` 的 UPDATE 谓词里**没有**目标占用条件。
代码自己在 `vfs-move.ts:173` 写下 WHY「fail before write/delete so a rename conflict
cannot overwrite the target」——意图是真的，机制是尽力而为。

**实际风险等级低于表面**：`vfs_entry` 有 `UNIQUE(scope_key, path)`
（`vfs-schema.ts:23`），并发 rename 撞车时 UPDATE 会因约束失败而 abort，**不会**
静默覆盖目标行。真实损害是**错误类型退化**：调用方拿到的是裸
`SQLITE_CONSTRAINT` 而不是它已正确构造好的 `vfsAlreadyExists(to)` VfsError，
上层无法走既有的「目标被占」友好提示分支。

**建议**：`renamePathInScope` / `renamePrefixInScope` 增加目标存在性前置判定并抛
`VfsError("ALREADY_EXISTS")`；或至少在 `moveVfsPath` 的 catch 里把约束错误翻译回
`ALREADY_EXISTS`。检查前置于写（现有顺序）本身应保留。

**置信**：confirmed（代码形状 + DDL 约束面）。

### F-w4-vfsstore-adv-5 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:583-597`

```ts
    const count = Number(before[0]?.n ?? 0);
    if (count === 0) {
      return 0;
    }
```

**描述**：返回值来自 DELETE **之前**的独立 `SELECT COUNT(*)`，两条语句之间无事务
保证（repo 方法自身不开事务，依赖调用方）。并发下返回值与实际删除行数可偏差。

**加重情节**：本仓已就同一类问题立过规矩——`sqlite-vfs-entry.repository.ts:530-533`
的 `deleteRecursiveIfAny` 明确写道「用真实 changes 避免『探测与删除之间出现并发
写入』这类极端情况下的偏差」，并刻意从探测命中数改用 `delete()` 的真实 changes。
`deleteUnreferencedUnderScope` 是同仓同-pattern 的方法，没有跟随该约定。
返回值目前只用于统计与提前短路（无正确性依赖），故 P3。

**建议**：返回 `executeTemplate` 的 `result.changes`；COUNT 降级为纯短路优化
（保留亦可，但不再作为返回值）。

**置信**：confirmed。

### F-w4-vfsstore-adv-6 | P3 | `packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts:32` vs `:172`

```ts
const CONTENT_GETMANY_CHUNK_SIZE = 500;
...
    const CHUNK_SIZE = 500;
```

**描述**：同一文件内两个 500，一个是模块级常量且注释明写「提至模块级，便于全局调整」，
一个是 `findExistingBlobHashes` 里的局部字面量。调一个不动另一个。
`sqlite-vfs-revision.repository.ts:230`、`:429`、`:40` 同样是第三、第四份局部 500。
调优旋钮散落四处。

**建议**：统一到模块级常量（可放 `scope-prefix-helpers.ts` 或新建 `sql-chunk-sizes.ts`）。

**置信**：confirmed。

### F-w4-vfsstore-adv-7 | P3 | `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts:103` vs `:219-224`

```ts
  readonly contentStore: VfsContentStore;
...
    if (options != null) {
      const existingBlobs = await options.contentStore.findExistingBlobHashes(hashes);
```

**描述**：`CopyVfsTreeOptions.contentStore` 声明为**非可选**，而 `options` 本身可选。
`options != null` 守卫因此在类型层面不可达（`options === undefined` 传不进来），
却是 `allBlobsExist` 保持 `true` 的唯一原因——一旦类型被放宽成可选，这条静默
`if` 会让 `copyVfsTree` 在无 contentStore 时跳过 blob 存在性校验、直接插 entry 行
指向可能不存在的 `content_hash`，无任何告警。死代码掩盖契约违反。

**建议**：把 `options` 改成必填参数（三个调用方都传），删掉 `options != null` 守卫；
或保留可选但让 `options?.contentStore` 缺失时走慢路径强制校验。

**置信**：confirmed。

### F-w4-vfsstore-adv-8 | P3 | `packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:248-250`

```ts
      if (blobRows.length === 0) {
        return null;
      }
```

**描述**：blob 行缺失（数据损坏）与「路径不存在」「目录行」三种情形都返回 `null`
（契约见 `model/vfs-content-size.ts` 末段），消费方 `character-card-limits.ts` 一律
按 null 放行。降级闸门的方向是「探测不到 → 允许读」，而 blob 缺失时随后的
`read` 必然抛「vfs_content_blob 缺失」——即把一个明确的错误转成一次注定失败的
读尝试 + 一个更难定位的报错点。

**建议**：`VfsContentSize` 增一态 `kind: "blobMissing"`（或复用 `VfsError`），
让闸门可以选择 fail-fast；不引入新态也可，但应在消费方注释里写明此歧义。

**置信**：suspected（未逐行核 `character-card-limits.ts` 的实际放行分支，
仅据 `vfs-content-size.ts:14-16` 的契约文本与本处实现推断）。

---

## 辩护理由清单

> 每条 = 我认为检察官**不应**报为问题的设计，附证据与「为什么必要」。

### D-1 内容寻址（SHA-256 明文 → `vfs_content_blob`）——必要，且收益已实测

- 实现：`hash-content.ts:15-18`（`@noble/hashes` sha2 → `bytesToHex`），落库
  `sqlite-vfs-content-store.ts:61-75`（zlib → `tightBytes` → INSERT）。
- **必要性论证**：VFS 的核心负载是「同一份规则文件被几十个 revision 反复引用」。
  不寻址则每次 write 都是一份完整压缩副本，revision 链的存储随版本数线性膨胀。
- **收益已实测**：`docs/apm/RULE.md` 2026-09-28 条目明确记录，按 `content_hash`
  去重后 VFS 多版本 delta 实为 **6.08MB → 3.02MB（省 3.06MB / 61.3%）**，
  且该条目同时把「按 revision 行累加 blob 字节会重复计数」立为全仓通用坑。
  这说明寻址收益不是估算而是本仓自己量过的。
- **选 SHA-256 而非更快哈希的理由已在代码里钉死**：`hash-content.ts:13` 注释
  「noble v2 的 sha256 从 `sha2.js` 导出（与 mobile 对齐）；禁止以 node:crypto
  作唯一实现」。跨端（Node / Hermes / RN）**同一函数同一输出**是硬约束——
  内容寻址的键一旦跨端不一致，同一份文件在两端会分裂成两个 blob，
  `NOT IN` 引用集判定随之失真。选纯 JS 实现牺牲速度换跨端确定性，是正确的取舍。
- **spec 原始决策**：`docs/Iterations/vfs-revision-storage-optimize/spec.md:17`
  「内容寻址 + zlib：明文经 ContentStore → SHA-256 + zlib → SQLite BLOB；
  多 revision 与 live entry 共享同一 blob」。

### D-2 `WITHOUT ROWID` + 复合 PK —— 不是 premature optimization，是 schema 正确性前提

- `vfs-content-blob-schema.ts:19` `WITHOUT ROWID`；`vfs-revision-schema.ts:24-26`
  `PRIMARY KEY (entry_id, version)` + `WITHOUT ROWID`。
- **必要性**：`sqlite-vfs-revision.repository.ts:601-603` 注释直接点出因果——
  「用复合 PK (entry_id, version) 寻址而非 rowid，这样 vfs_revision 可以安全地
  切换到 WITHOUT ROWID（决策 4）。rowid 表和 WITHOUT ROWID 表都支持这种写法，
  所以这条改动本身不改变 rowid 表上的行为」。
  即：GC 的 DELETE 谓词形态（`WHERE (entry_id, version) IN (...)`）是**先于**
  WITHOUT ROWID 决策写好的，切了表形态也不用改 SQL。这是把「未来可能的表形态变更」
  的成本前置到今天的显式选择。
- `vfs-content_blob` 同理：唯一访问模式全是按 `content_hash` 点查或 IN 批查
  （`:52`、`:94`、`:145`、`:177`、`:213`），rowid 纯属纯写放大。

### D-3 双 `ref_count` 分层 —— 语义不同层，**不是重复设计**

这是本区最容易被误报为「冗余」的一处，逐层拆开：

| | `vfs_revision.ref_count` | `vfs_content_blob.ref_count` |
|---|---|---|
| 语义 | 有多少条 checkpoint 指针 + live head 指向这条 revision | 有多少条 revision 行引用这个 blob |
| 回答的问题 | 「这条历史还有人回滚得到吗」 | 「这份明文还有人用吗」 |
| 维护者 | 应用层（`adjustRef` / `batchAdjustRefCount` / `repairRefCounts`） | SQLite 触发器（3 个） |
| 判据来源 | 跨库（`message_checkpoint_file`）+ 跨 scope 推理 | 单表单列计数 |
| GC 出口 | `deleteUnreferencedUnderScope`（`:604`） | 触发器归零删行 + `gc()` NOT IN |

**合并是错的**：blob 侧的引用关系是「revision 行存在且 content_hash 相等」，
纯 SQL 可判；revision 侧的引用关系是「有 checkpoint 行指向它 **或** 它是某个
entry 的 live head」，后者需要 JOIN `vfs_entry` 与 `message_checkpoint_file`
两张跨域表——触发器写不了。硬合并会导致 blob 计数被 checkpoint 引用污染
（checkpoint 引的是 revision，不是 blob），归零判据失效。

**权威出处**：`service/integrity-repair.ts:17-27` 的「双引用计数器裁决（T-SC5）」：
「vfs 里有两套 `ref_count`，用途完全不同，**并存不矛盾，绝不强行合一**」。

### D-4 关键不变量：应用层修复**不会**误触 blob 触发器 —— 这是本区最精巧的一处设计

- `revision-ref-count.ts:145-150`：

```ts
 * 注意：这条路径只动 `vfs_revision.ref_count`，**完全不碰** `vfs_content_blob.ref_count`
 * ——后者由 SQLite 触发器在 revision INSERT/DELETE/UPDATE OF content_hash 时维护。
 * `batchRepairRefCountFloor` 只更新 `ref_count` 列、不改 `content_hash`，触发器不会 fire，
```

- **为什么这是必要的而不是巧合**：SQLite 触发器若写成裸 `AFTER UPDATE ON vfs_revision`，
  `repairRefCounts` 每次跑（`batchRepairRefCountFloor` 内部
  `sqlite-vfs-revision.repository.ts:538` 是 `UPDATE vfs_revision SET ref_count = ?`）
  都会给 blob 侧误加计数，计数单调虚高 → blob 永不回收。
  DDL 精确写成 `AFTER UPDATE **OF content_hash**`（`vfs-revision-schema.ts:59`），
  把触发器的作用面收窄到「只有换正文才动」这一个语义事件上。
- 换言之：**`OF content_hash` 这个限定符是承重的**，删掉它会静默破坏回收。
  检察官若把 UPDATE 触发器报成「防御性冗余、当前无调用方」，是误读——
  它的第一职责正是**划定不作用域**。
- 当前生产确实没有 UPDATEs `vfs_revision.content_hash` 的写口（append 走 INSERT，
  GC 走 DELETE），所以它平时不 fire；保留成本 = 每次 UPDATE 多一次语句头匹配，
  收益 = 未来任何换正文写口自动获得正确的引用转移，不必记得手工配对。
  这是**用 DDL 表达不变量**而非用代码纪律表达不变量，方向正确。

### D-5 blob 侧 `ref_count` 交给触发器而非应用层 —— 因为 revision DELETE 有 5+ 个 SQL 站点

全仓 `DELETE FROM vfs_revision` 的站点：

1. `sqlite-vfs-revision.repository.ts:353`（`deleteExceptReachable`）
2. `:604`（`deleteUnreferencedUnderScope`）
3. `:55-58` `ORPHAN_REVISION_GC_SQL`（`deleteGlobalOrphans`）
4. `message-checkpoint/logic/deferred-revision-orphan-gc.ts:40`（经 3）
5. `revision-gc.ts:81`（经 3）
6. 兜底 `integrity-repair` / 未来 migration 路径

若 blob 计数由应用层维护，上述**每一个**站点都要配对一次 `UPDATE vfs_content_blob
SET ref_count = ref_count - 1`，且必须记得紧跟「归零删行」。漏一处 → blob 永久泄漏；
多一处 → 提前删掉仍被 entry 引用的明文（用户数据丢失）。
把这条不变量交给 `AFTER DELETE` 触发器后，**它在结构上不可能被漏**——
新增任何 DELETE 站点都自动正确。GC 是本仓里最容易扩散的代码路径
（每个删除功能都要扫一遍 session），让正确性随代码量线性增长的写法是错的选择。

### D-6 blob GC 走 deferred + 全库引用集，绝不内联进删除事务 —— 三条独立理由

- **入口唯一性**：`logic/deferred-blob-gc.ts:10-12` 注释「延期 blob GC **唯一入口**
  （ContentStore.gc 内部用 NOT IN 子查询算全库引用集）」，函数体只有 4 行——
  看似无价值的薄包装，实为**策略执行点**。`revision-gc.ts:50-51` 明确
  「blob GC 须经 `runDeferredBlobGc` 另行调度，本函数不再同步 collect/gc」。
  若允许调用方手拼 `ContentStore.gc`，每一次新增删除功能都是一次「keepSet 作用域
  写错」的赌博。spec 对此有硬约束（`spec.md:342` T-GC2「session A sweep 后 gc：
  **不得**删除仍被 session B 的 entry/revision 引用的 blob」，`:358` 把
  「session 局部 keepSet 误删他 session blob」列为已识别风险）。
- **不内联的事务理由**：`spec.md` 记录的现行设计——触发 revision 删除的调用点
  包括回滚事务（`rollback-large-jank` 刚修过卡顿，`revision-gc.ts:42-48`
  专门为此加了 `includeGlobalOrphans: false` 选项把全表 DELETE 挪出事务）。
  在回滚热路径里再叠一条全库 `NOT IN` 扫描，正是被明确修掉的那类卡顿。
- **引用集必须全库**：`vfs_content_blob` 是**全库共享**表（跨 session / project /
  global），不是 session 私有表。`sqlite-vfs-content-store.ts:208-209` 的
  `NOT IN` 子查询在两个分支都显式带 `WHERE content_hash IS NOT NULL`——
  这不是洁癖，是 `NOT IN` 遇 NULL 返回空集的地雷，注释已点名
  「避免 NOT IN 遇 NULL 的语义陷阱」。这类「知道 SQLite 坑并显式规避」的写法
  应记为优点而非可疑点。

### D-7 `repairRefCounts` 只上调不下降 —— 刻意的非对称，方向正确

- `revision-ref-count.ts:93` 「空闲校验：重算 checkpoint 行数 + live head，
  **只上调 ref_count（禁止因偏低误删）**」；
  `sqlite-vfs-revision.repository.ts:517` 「只挑 current < expected 的项
  （保持『只增不减』语义）」。
- **必要性**：`repairRefCounts` 的入参只有一个 `sessionId`
  （`revision-ref-count.ts:104`），而它被设计成可对**任意 scope** 调用——
  `revision-ref-count.ts:94-97` 说明 bootstrap W3 拿 `(global, /)` 当全局 template
  兜底。对 global scope 而言，这个 sessionId 的 checkpoint 集合**不是全部**引用者，
  算出的 `expected` 是**下界**而非真值。
  若允许下调，就会拿一个下界去删「其实还有人钉着」的 revision → 回滚时目标丢失，
  **不可逆**。而算高了的后果只是多留一份孤儿数据，下次别的 session 删除时会被
  `deleteGlobalOrphans` 顺手带走。**可回收 vs 不可逆**，非对称是唯一正确答案。
- `createRevisionRefCountRepairOperation` 的 `detect` 策略同样体现这点
  （`:172-183`）：有行就保守报 `needsRepair=true`，具体偏差交给幂等 repair，
  「重复跑安全」。宁可多跑一次全表扫描，不可漏修。

### D-8 `deleteGlobalOrphans` 必须独立于 path-scoped 扫 —— entry_id 设计的结构性代价

- `revision-gc.ts:36-40`：「path-scoped `deleteUnreferencedUnderScope`——靠 JOIN
  vfs_entry 圈定当前 session scope 下 ref_count<=0 的 revision；全局
  `deleteGlobalOrphans`——清掉『entry 已删、ref_count<=0』的 JOIN 孤儿
  （findings 发现 14：删文件后旧版 active revision 的 entry 已删，path-scoped
  扫描 JOIN 不到，靠这步兜底）」。
- **必要性**：scope 圈定靠 `JOIN vfs_entry e ON e.entry_id = r.entry_id`
  （`sqlite-vfs-revision.repository.ts:588`）。孤儿 revision 的 entry 已物理删除，
  JOIN 结果为空——**不是查询写得不好，是数据模型决定的**：entry_id 寻址换来了
  rename 零成本（path 可变、entry_id 不变，`sqlite-vfs-entry.repository.ts:912`）
  和 revision 历史的天然跟随，代价就是 entry 消失后 scope 归属信息随之消失。
  `ORPHAN_REVISION_GC_SQL`（`:55-58`）因此**刻意不 JOIN**，直接
  `entry_id NOT IN (SELECT entry_id FROM vfs_entry)`。
- 回归证据存在：`test/vfs/orphan-revision-gc.test.ts:99` 注释
  「跑 revision GC：path-scoped 扫不到（entry 已删），靠 deleteGlobalOrphans 兜底」。

### D-9 `entry-sequence-repair` 推号器而非删孤儿 —— 在真约束下的保守正解

- `entry-sequence-repair.ts:6-17` 病灶与修法都写清了：历史 migration 让
  `sqlite_sequence` 低于 `vfs_revision` 里的最大 `entry_id`，
  「此后任何新建文件都会复用被孤儿占用的 entry_id，`vfs_revision` 的
  `(entry_id, version)` 唯一键直接撞车——表现为『新建技能 / 写文件报
  UNIQUE constraint failed: vfs_revision.entry_id, vfs_revision.version'」。
- **为什么不直接删孤儿 revision**：`:15-17`「孤儿 revision 本身不删——可能仍被
  checkpoint 指针引用，删除会破坏回滚；推号后永不复用，它们只占号段不再有害」。
  这与 D-7 是同一条原则的两次应用：**用一点存储/号段换不可逆风险为零**。
  孤儿只占号段（一个 INTEGER），成本可忽略。
- 幂等性也处理了：`:72-75` seq 已达标直接 return；无行时补 INSERT
  （全新库 `sqlite_sequence` 未物化，`:35-38` 已说明）。

### D-10 `normalizePath` 对 `..` 越界 fail-closed —— VFS 是 LLM 可触达的沙箱

- `repositories/impl/normalize-path.ts:31-34`：

```ts
    if (segment === "..") {
      if (stack.length === 0) {
        throw vfsInvalidPath(path, "path escapes above root");
      }
```

- **必要性**：VFS 的写入方包含 LLM 工具调用
  （`domain/tool/builtin/vfs-tools.ts`）。若 `..` 越界被静默 clamp 到 `/`，
  一次 `../../` 构造就会写到意外位置；若被静默允许，则整个 scope 隔离
  （`vfs-path-mapper.ts` 辛苦建立的 5 域物理前缀）形同虚设。
  两个「宽容」选项都是安全漏洞，**只有 fail-closed 一条路**。
- 同族：`validate-entry-name.ts:33-51` 拒绝控制字符 / 纯空白 / 首尾空格 / `.` `..`，
  且 `:28-31` 明确划定「只拦用户/agent 显式创建与重命名入口；导入链路
  （zip/角色卡）不走本校验」——**边界画得比「一律校验」更清楚**，
  因为存量条目改内容不该被历史命名卡死。这是经过权衡的规则，不是漏网。

### D-11 path mapper 的 global-meta 空前缀「非对称」——是对称的，且必须非对称

- `vfs-path-mapper.ts:18-23`：

```ts
/**
 * global-meta 域的物理挂载前缀为**空串**：域内逻辑路径自带 `/meta` 段
 * （SkillsService 约定写 `/meta/skills/...`），物理路径 = 逻辑路径原样，
 * 再叠前缀会拼出 `/meta/meta/...` 双前缀废路径。
 */
const GLOBAL_META_PHYSICAL_PREFIX = "";
```

- 表面不整齐：4 个域有挂载前缀，第 5 个是空串，且 `toPhysicalPath` 的
  `case "global-meta"`（`:110-112`）直接 `return normalized` 不做 `/` 特判，
  与相邻 `case "project-meta"`（`:113-120`）形态不同。
- **但映射本身是严格双射且对称的**：`toPhysicalPath` `:110-112` 与
  `toLogicalPath` `:164-166` 镜像；`scopePhysicalPrefix` `:214-216` 与
  `toPhysicalPath` 同源取值；`scopeKey` `:199` 产出 `global:meta`。
  不对称只在「与其它域的横向对比」里存在，在「本域的往返一致性」里不存在。
- **必要性**：若给 global-meta 也加挂载前缀，会撞上 `/meta/meta/skills/...`。
  真正的代价是**寻址空间重叠**——global-meta 的物理路径（`/meta/...`）与
  session 域的 `/projects/{pid}/sessions/{sid}/...`、global 域的
  `/template/...` 靠 `scope_key` 列区分而非路径前缀区分。这是**显式承认的
  设计取舍**（注释把理由写在常量旁边，不是藏在别处），且 `scope_key` 列的存在
  正是为此（`vfs-schema.ts:16`）。

### D-12 `/template` 旧前缀**拒绝**而非双读 —— 数据不可判定，别无选择

- `vfs-path-mapper.ts:28-32`：`LEGACY_TEMPLATE_LOGICAL` + 注释
  「Legacy logical prefix — rejected on input; **no dual-read**」；
  `:31-32` 错误文案「逻辑路径以 `/` 为根，请勿使用 `/template/` 前缀」。
- **为什么不能双读**：物理路径 `/template/x` 在当前模型下有两种不可区分的解释——
  「global 域的逻辑路径 `/x`」（`toPhysicalPath` `:95` 就是这么拼的）
  或「某个域里一个真名为 `template` 的目录下的文件」。仅凭路径字符串无法判定，
  双读必须靠「先查 global 域、查不到再当普通路径」的启发式，而这会在
  「global 域真有 `/template/x`」时给出错误答案，且**错误答案随数据变化**——
  用户删掉一个文件就会让另一个文件突然读不出来。
- 拒绝 + 明确文案是唯一不产生歧义的处置。这与 D-10 同源：
  **VFS 在路径歧义上一律选择 fail-closed**。

### D-13 `toLogicalPath` 的 scope 校验是真的（不是摆设）

- `:129-182` 五个 case **每个都做前缀校验并抛 `vfsInvalidPath`**：
  `:133-138`（global）、`:149-151`（project）、`:159-161`（session）、
  `:172-176`（project-meta，且额外校验 `/meta` 段以区分同项目下的 template 子域）。
  只有 global-meta 因前缀为空串而无从校验（见 D-11），返回 `normalized` 是恒等映射，
  逻辑上正确。
- 唯一可议的是 `assertLogicalPathAllowed`（`:76-82`）的 `_scope` 形参带下划线
  前缀且未使用——签名保留了 scope 维度但当前只做 `/template` 前缀校验。
  这是**为将来预留的签名**（新域接入时不必改所有调用点），不是遗漏；
  全部调用点（`scoped-vfs.service.ts:48/55/62/69/76/84/99/114`）都老实传了 scope。
  报为「未使用参数」是过度解读。

### D-14 树拷贝共享 blob + 快慢双路径 —— 双路径都有存在理由

- 快路径（`vfs-tree-copy.ts:216-260`）：`findExistingBlobHashes` 一次 IN 查询确认
  全部 blob 在位 → 批量 `findExistingPaths` → 批量 INSERT / 逐条 update。
- 慢路径（`:261-298`）：任一 blob 缺失 → `scanContents` 取明文 → 逐条
  `ensureBlob` 补写。
- **必要性**：同库复制（fork / session.copy / project.copy）必然全部命中；
  慢路径服务的是「entry 行的 content_hash 存在但 blob 行不在」的不一致态
  （导入中断、跨设备同步、历史损坏）。端口契约
  `vfs-content-store.port.ts:44-46` 明写「共享 blob 路径（tree-copy / seed /
  backfill）在写 revision 之前必须调此方法，**确保触发器
  `trg_revision_insert_inc_blob_ref` 的 UPDATE 不命中 0 行**」——慢路径存在的
  直接原因就是 D-5 那个触发器：blob 行不在时 INSERT 触发器的 UPDATE 会静默
  命中 0 行，引用计数丢失。契约把这条隐含依赖显式化了，是优点。
- 共享而非重 put 的收益直接对应 D-1：10MB 模板树重 put 要重新压缩全部文件。

### D-15 版本号统一用 `max(head, MAX(version)) + 1` —— 复合 PK 下的正确性必需

- `vfs-tree-copy.ts:66-79`（`nextUpdateVersion`）、
  `revision-aware-vfs.service.ts:398-412`（`nextVersionFor`）、`:461-478`
  （批量版 `Math.max(h.headVersion, maxVersionMap.get(h.entryId) ?? 0) + 1`）。
- 注释给了完整因果（`:399-403`）：「head 回拨（resetHead 后高版本被 checkpoint
  钉住）时 `head_version < MAX(version)` 是合法状态，新号必须越过 MAX 才能避开
  历史占号段」。而 `head_version < MAX(version)` 之所以合法，是因为
  `resetHeadToVersion` 是**补偿原语**（`vfs-service.port.ts:78-84`：
  「失败补偿：将 live head 拨回指定 revision，不 append、不 bump」）——
  它刻意不 bump，所以回拨后 head 必然可能低于 MAX。
- 换言之 `+1` 不是偷懒，是**在「补偿原语不改版本」与「复合 PK 不许撞号」两个
  约束下唯一可行的分配器**。用 `head + 1` 会在「回滚后立刻写文件」这一
  极常见路径上撞 `UNIQUE` 约束。
- `insertAtVersion`（`sqlite-vfs-entry.repository.ts:294-311`）与
  `reviveEntryAtVersion`（`:325-348`）的存在也是同一约束的产物：entry 已被物理
  删除但 revision 历史还在时，重建必须落在历史占号段之外。

### D-16 zlib 三形态读兼容 —— 迁移窗口内必需，且已排定退役

- `zlib-codec.ts:106-125`（`decodeCompressedBytes`）三形态：
  `zlib`+Uint8Array / `zlib`+string（存量 quick-sqlite 误存 base64）/
  `zlib-b64`。写侧统一落 `zlib`（`:20`）。
- **必要性**：写侧已统一（`blob-binary-normalization` 后台任务在归一存量），
  但存量行的归一是**渐进**的，冷启动只跑同步预算
  （`blob-binary-normalization.ts:704-717`，`DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS`
  = 60s），未归一的行必须能读。
- **已排定退役，不是无底洞**：`docs/apm/RULE.md`「同轮退役的还有后台迁移类任务
  （2026-09-28 拍板）：……blob 二进制归一（binary-blob-and-vfs-pack spec Part A
  的迁移生命周期）均约定约 10 个 tag 后删除迁移任务与旧形态读兼容分支」。
  退役条件写在 RULE 里，标注 `intentional`，**不应作为问题上报**。
- `blob-binary-normalization.ts:105` 的谓词用
  `TYPEOF(bytes) = 'text'` 而非只看 encoding，注释说明了原因
  （`encoding='zlib'` 但列里存 base64 文本的脏形态，只看 encoding 会漏）
  ——这是对本区历史债的精确清偿，不是新增复杂度。

### D-17 `resolve-stored-content` 的解正文顺序被钉死 —— 防的是静默数据损坏

- `resolve-stored-content.ts:19`「顺序钉死：deleted → directory → content_hash
  → 遗留明文 → 双 NULL 抛错。**禁止 `String(null)` / `String(row.content)` 产出伪串
  `"null"`**」。
- **必要性**：`nullableText`（`:66-71`）的存在就是为了封死 `String(null) === "null"`。
  在一条「读用户文件正文」的链上，`"null"` 这个伪串会被原样写回用户的文件、
  塞进提示词、计入 token 统计，且**没有任何报错**。这是典型的「一次转换错误
  污染全链路下游」类别，成本不对称到极点。
- 双 NULL 时抛错（`:58-60`）而非返回空串，同样是把静默损坏转成可诊断失败。
- `nullableText(row.content_hash)` 在 `sqlite-vfs-entry.repository.ts:159/199/239/643/678/784`
  等处的一致使用，说明这不是单点自觉而是全仓纪律。

### D-18 两条 CHECK 约束把计数漂移转成响亮失败 —— 纵深防御的最后一道

- `vfs-content-blob-schema.ts:18` `CHECK (ref_count >= 0)`；
  `vfs-revision-schema.ts:23` `CHECK (ref_count >= 0)`。
- **必要性**：GC 的删除谓词是 `ref_count <= 0`（`sqlite-vfs-revision.repository.ts:57/591/611`）。
  计数一旦漂移到负数，`<= 0` 会**提前命中**，删掉仍被引用的 revision / blob。
  CHECK 让「减过头」这一最危险的方向在**写的那一刻**就 abort 事务，
  而不是等到 GC 静默删数据。
- 具体地，D-5 里提到的「blob 行不存在导致 INSERT 触发器 UPDATE 命中 0 行、
  引用计数丢失」这一失败模式：计数丢失后若 blob 被重建（`put` 以 DEFAULT 0 落行），
  随后的 revision DELETE 会把它减到 −1 → CHECK abort → **revision 行与 blob 行
  一起留下**，而不是明文消失。把「引用计数丢失」的最坏后果从
  「用户文件读不出来」降级为「空间泄漏 + 一次显式报错」。这是正确的失效方向。

### D-19 补偿回滚禁用 `write` 注水 —— 语义纯度优先

- `restore-mutating-path-heads.ts:125`「directory 补偿：快照外 hardDelete +
  快照内 **resetHead（禁 write 注水）**」；`:186` 重申「走
  resetHeadToVersion / hardDelete 补偿原语，**禁止 write 注水**」。
- **必要性**：补偿的目标是**恢复现场**，不是**产生新历史**。用 `write` 回填会
  追加一条 active revision、bump head 版本，让「这次操作失败了」变成
  「文件多了一个版本」——回滚执行日志、checkpoint 语义、后续 diff 全部被污染，
  且用户会看到本不该存在的版本记录。
- 快照只记 `version` 不记正文（`:56-61` 注释：「回滚只依赖 version，
  故 list 返回的 head_version 已足够，不必再 read 正文」）——把补偿的
  信息需求压到最小，既省 I/O 又消除了「快照本身可能失败」的风险面。
- 目录补偿里「快照外文件 hardDelete」的逻辑（`:150-175`）处理了
  「执行到一半失败、留下了快照外的新文件」这一真实场景，
  且对每个操作都吞 NOT_FOUND（幂等补偿的正确形态）。

### D-20 `deferred-blob-gc.ts` 的薄包装不是冗余

18 行、只做 `new SqliteVfsContentStore(conn).gc()` 的文件，形态上与
`sql-counting-connection` 之类的测试脚手架相似，容易被判为「无意义间接」。
实际它是 D-6 的策略执行点：把「谁能触发全库 blob GC」收敛到单一导出符号，
使静态检查与 code review 有一个确定的 grep 目标。函数体注释
（`:1-2`「延期 blob GC **唯一入口**」）与 `revision-gc.ts:50-51` 的
「须经 runDeferredBlobGc 另行调度」形成契约闭环。

---

## 争议与存疑

**争点 1（我不让步，但检察官应知情）**：`service/integrity-repair.ts` 被
`domain/vfs/logic/revision-ref-count.ts:13` 反向 import。分层上 domain 依赖
service 是方向倒置。`integrity-repair.ts:13-15` 自己也承认抽象动机是
「让上层（bootstrap、importer、migration）能用同一种方式注册和触发」——
即它是**应用层编排抽象**，不是 domain 概念。
`IntegrityRepairOperation` 形状极简（`detect()` / `repair()` 两个 async 方法），
搬到 `domain/` 或 `core/contracts/` 无行为改动。**我辩护现状可用**（不产生运行时
问题、抽象本身合理），但**不辩护这个位置**。置信 suspected（未核是否已有分层
lint 规则覆盖）。

**争点 2（我不让步其设计，但要求记录）**：`deleteUnreferencedUnderScope` 的
COUNT-then-DELETE 两段式在**无事务**下返回值可能不准（见 F-5）。
当前所有消费方只把它当统计数（`revision-gc.ts:82` `return scoped + globalOrphans`
最终只用于日志/测试断言），无正确性依赖，故不升级severity。
但如果将来有人拿它的返回值做「删干净了吗」的判定，会踩坑。
`ORPHAN_REVISION_GC_SQL`（`:55-58`）返回的是 `result.changes`（真实值），
两个方法在同一文件里口径不同，这个不一致本身就是需要收敛的信号。

**争点 3（证据不足，明说）**：F-8 关于 `character-card-limits.ts` 消费
`findContentSize` 返回 null 后「放行」的推断，我只读了
`model/vfs-content-size.ts` 的契约文本与 repository 实现，**没有逐行核实**
`character-card-limits.ts` 的实际分支。如果它对 null 有别的处理（比如直接跳过
该文件、或记 warn），F-8 应降为 P3 且描述需改写。建议 W6 验证代理单独核实。

**争点 4（有意保留的分歧）**：F-3（content_hash 缺索引）我判 P2。
反方观点可辩：`vfs_entry` 行数量级是「用户工作区文件数」（数百到数千），
`vfs_revision` 是其若干倍，全表扫描在这个量级是毫秒级，
`blob-binary-normalization.ts:336` 的注释提供了同族实测支撑
（「百万行量级库毫秒级」）。若反方能给出 vfs_revision 实际行数上界，
P2 → P3 是合理降级。但**我不同意的不是优先级，是「这是取舍」的定性**——
三份 DDL 常量里确无 content_hash 索引，而 `gc()` 是本区唯一按 content_hash
做集合运算的语句，这个遗漏没有任何注释解释（对比 `vfs-schema.ts:31-36`
对「为什么不再建具名索引」有一段完整说明）。**未写理由的遗漏是遗漏，
不是取舍。**

**争点 5（辩护范围的自我限定）**：本报告只覆盖 `packages/core/src/domain/vfs`。
`bootstrap/vfs/*.ts` 的 DDL 我读了（作为数据访问证据必需），但其
「触发器 DDL 并入 canonical DDL 而非 migration」这一决策
（`vfs-revision-schema.ts:70-77`）属 bootstrap 机位领地，我只记录不裁决。
同理 `infra/content-cache/logic/decoded-content-cache.ts` 的池预算标定
（8M 字符 / 1024 条）我引用为 D-1 的延伸论据（内容寻址 ⇒ 缓存无需失效机制），
但其容量是否够用属 infra 机位。
