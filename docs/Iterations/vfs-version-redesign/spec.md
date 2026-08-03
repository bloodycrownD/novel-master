---
date: 2026-07-30
---

# VFS 版本管理重设计 技术规格（SPEC）

> **PRD**：[prd.md](./prd.md)
> **前置 PRD**：[vfs-revision-storage-optimize](../vfs-revision-storage-optimize/prd.md)（定义 ContentStore/blob 共享存储模型）、[vfs-move-and-frontmatter-bugfix](../vfs-move-and-frontmatter-bugfix/prd.md)（导火索迭代）
> **代码基线**：`packages/core` + 三端 apps（2026-07-30，main 分支 `v1.4.11` 之后）

---

## 设计目标

把 VFS 版本管理从「path 承担身份键/目录层级/scope 前缀三重职责」的耦合模型，重设计为「不可变 `entry_id` 作身份键、path 降级为可变属性列、scope 独立成列」的解耦模型。彻底解决 rename 逐文件搬移卡顿、历史版本与 checkpoint 跟路径死绑、三套写路径语义不一致、blob GC 全表扫四大病灶，同时补齐 GC 链路的已知缺口。

需求来源：`.apm/kb/docs/Iterations/vfs-version-redesign/prd.md`（已确认）。

## 总体方案

诶～先讲清楚整体思路再往下拆。核心是引入 `entry_id` 这根身份轴，让 path、scope、历史版本、checkpoint 指针全部挂在这根轴上，彼此解耦。

### 关键设计决策

1. **revision.ref_count 与 blob.ref_count 是两个不同层级的计数器，并存不矛盾**。
   - `vfs_revision.ref_count`（已有列，应用层维护）：记录该 revision 行被多少个 live head / checkpoint 指针引用，用于 **revision 可达性 GC**（决定 revision 行可删）。本次保留，入参从 path 改 entry_id。
   - `vfs_content_blob.ref_count`（新增列，触发器维护）：记录该 blob 被多少条 revision 行引用，用于 **blob 存储回收**（决定 blob 行可删）。由触发器在 revision 行 INSERT/DELETE 时自动 ±1，归零自动删 blob。
   - 层级关系：应用层决定删某条 revision 行 → 触发器自动递减对应 blob.ref_count → blob.ref_count 归零时触发器自动删 blob。应用层 13 处 revision 写删点 **无需新增 blob 操作**（PRD §3 语义），因为触发器链路自动处理 blob 计数。

2. **迁移采用「单事务内一次性 INSERT...SELECT，必要时按表分批降低单条 SQL 内存峰值」模式，不突破现有 migration 框架的「单事务内 apply」假设**。PRD §9 字面要求「事务内 schema + 事务外分批数据可跨 boot 重入」，但当前 `runPendingSchemaMigrations` 整体跑在 bootstrap 外层事务内，突破框架风险大且与既有 migration 不一致。这里要澄清一个之前的误解：三表 rebuild 的核心是纯引擎内部的 `INSERT INTO _new SELECT ... JOIN _migration_path_map`，**数据并不进 JS 堆**，所以 revision 行数再多也不会触发 RN/Hermes 的 JS OOM——这与 `vfs-content-blob-zlib-v1` 当年用 `LIMIT 32` 分批的原因不同（那次是因为循环里要 `store.put(明文)` 把正文拉进 JS 堆）。本次三表 rebuild 改用**一次性单条 `INSERT...SELECT`**（每张表一条），让 SQLite 内核自己走 `_migration_path_map` 的索引完成 JOIN。只有当单条语句的引擎内存峰值在大库上需要约束时，才按表加 `LIMIT N` 分批（仅降低单条 SQL 的引擎内存峰值，不是防 JS OOM，单事务内也无法 yield）。迁移进度因为单事务同步阻塞，apps 层只能显示「升级中」占位 UI（转圈），无法做百分比（详见「进度提示」节）。

3. **触发器 DDL 同时进 canonical DDL 和 migration**。新库由 canonical DDL 建触发器；旧库由 migration 在表 rebuild 后 `CREATE TRIGGER`。`SCHEMA_BOOT_VERSION` bump 1→2（canonical DDL 形态变更，旧库走慢路径重述 DDL 时不会因列不存在报错，因为慢路径会被新 migration 先行 rebuild——但实际上旧库触发器由 migration 建，canonical DDL 的触发器只对新库生效，两边各建一次，IF NOT EXISTS 守护幂等）。

4. **找不到 entry_id 的 checkpoint 行：丢弃并记 warning 日志**。迁移时旧 `message_checkpoint_file.logical_path` 无法反查到 entry_id（文件已删但 checkpoint 残留的孤儿行），丢弃该行并记日志，不阻断迁移。这是边界数据，保留无意义（指向已删文件）。

5. **顺手清理 `vfs_revision.content` / `storage_kind` 列**。revision 表 rebuild 时一并删 content 明文列和 storage_kind 列——前置迭代 `vfs-revision-storage-optimize` 已把正文迁入 blob，content 列已全部 NULL，storage_kind 恒为 'inline'，这两列是历史遗留，本次 rebuild 顺手清理。

6. **`vfs-tree-copy` 走统一 sweep 路径**。`releaseAndDeleteVfsPrefix` 的裸调 `deleteUnreferencedUnderPrefix` 改为调经过泛化的 `sweepRevisionsUnderScope`（新原语，支持 session/project/global 三种 scope），消除「裸调无 migration 分支」的口子。entry_id 化后 sweep 原语本身按 scope_key 查询，不再需要 path 前缀扫描。

7. **rename 后 workplace 规则迁移：保持现状（apps 层负责），core 只做 VFS 原子 rename**。workplace 规则按 logical path 存，是 apps 层的 UI 状态，不下沉 core。mobile 维持 `migrateWorkplaceDirRename`；desktop 的遗漏（`handleVfsRename` 不调规则迁移）本次不强制修，因为 desktop 的 workplace 模型与 mobile 不同，且本次聚焦版本管理重设计而非 UI 规则对齐。后续可作独立迭代。

### 数据模型终态

```
vfs_entry
  entry_id        INTEGER PRIMARY KEY AUTOINCREMENT   -- 新增：不可变身份键
  scope_key       TEXT NOT NULL                       -- 新增：scope 归属（如 session:{pid}:{sid}）
  path            TEXT NOT NULL                       -- 降级：纯逻辑路径（如 /原著/第01部/(01).md）
  content_hash    TEXT NULL                           -- 保留：指向 blob
  head_version    INTEGER NOT NULL DEFAULT 1          -- 保留：当前 head 版本号
  mtime_ms        INTEGER NOT NULL                    -- 保留
  entry_kind      TEXT NOT NULL DEFAULT 'file'        -- 保留
  UNIQUE(scope_key, path)                             -- 同 scope 内路径唯一
  -- 删除：version（与 head_version 永远同步）、storage_kind（恒 inline）、external_uri（恒 NULL）

vfs_revision
  entry_id        INTEGER NOT NULL                    -- 改：原 path 列删除
  version         INTEGER NOT NULL
  status          TEXT NOT NULL                       -- 保留：active/deleted
  mtime_ms        INTEGER NOT NULL                    -- 保留
  content_hash    TEXT NULL                           -- 保留
  ref_count       INTEGER NOT NULL DEFAULT 0          -- 保留：应用层维护（revision 可达性 GC）
  PRIMARY KEY (entry_id, version)                     -- 改主键
  -- 删除：path、content（明文，已迁 blob）、storage_kind

vfs_content_blob
  content_hash    TEXT PRIMARY KEY                    -- 保留
  encoding        TEXT NOT NULL                       -- 保留
  bytes           BLOB NOT NULL                       -- 保留
  byte_len        INTEGER NOT NULL                    -- 保留
  ref_count       INTEGER NOT NULL DEFAULT 0          -- 新增：触发器维护（blob 存储回收）

message_checkpoint_file
  session_id      TEXT NOT NULL                       -- 保留
  message_id      TEXT NOT NULL                       -- 保留
  entry_id        INTEGER NOT NULL                    -- 新增：替代 logical_path
  revision_version INTEGER NOT NULL                   -- 保留
  PRIMARY KEY (session_id, message_id, entry_id)      -- 改主键
  -- 删除：logical_path
```

### scope_key 编码规则

| scope.kind | scope_key 取值 | 旧 path 物理前缀（迁移反解用） |
|------------|----------------|------------------------------|
| global | `global` | `/template` |
| project | `project:{pid}` | `/projects/{pid}/template` |
| session | `session:{pid}:{sid}` | `/projects/{pid}/sessions/{sid}` |

迁移反解时必须先判 `/projects/` 前缀再判 `/template`（避免 `/projects/{pid}/template` 被误判为 global）。新增辅助函数 `inferScopeFromPhysicalPath(physicalPath) → { scopeKey, logicalPath }`。

### 触发器定义

```sql
-- revision INSERT 时，对非 NULL content_hash 的 blob ref_count + 1
CREATE TRIGGER trg_revision_insert_inc_blob_ref
AFTER INSERT ON vfs_revision
WHEN NEW.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash;
END;

-- revision DELETE 时，对非 NULL content_hash 的 blob ref_count - 1，归零删 blob
CREATE TRIGGER trg_revision_delete_dec_blob_ref
AFTER DELETE ON vfs_revision
WHEN OLD.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob
  SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash;
  DELETE FROM vfs_content_blob WHERE content_hash = OLD.content_hash AND ref_count <= 0;
END;

-- revision UPDATE content_hash 变更时，旧 hash -1 新 hash +1
CREATE TRIGGER trg_revision_update_transfer_blob_ref
AFTER UPDATE OF content_hash ON vfs_revision
WHEN OLD.content_hash IS NOT NEW.content_hash
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash AND OLD.content_hash IS NOT NULL;
  DELETE FROM vfs_content_blob WHERE content_hash = OLD.content_hash AND ref_count <= 0 AND OLD.content_hash IS NOT NULL;
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash AND NEW.content_hash IS NOT NULL;
END;
```

注意：实际 revision 的 content_hash 在 append 后不变（revision 不可变），UPDATE 触发器主要为防御性。三端 driver（better-sqlite3 / op-sqlite）均 SQLite 内核，触发器引擎级支持，无需 driver 特殊适配，但需在两端实测验证 `WHEN` 条件子句与 FOR EACH ROW 行为。

#### 不变量：revision INSERT 前对应 blob 行必须已存在

`trg_revision_insert_inc_blob_ref` 在 revision INSERT 时执行 `UPDATE vfs_content_blob SET ref_count = ref_count + 1 WHERE content_hash = NEW.content_hash`——这是个**带前提条件**的触发器。如果对应 `content_hash` 的 blob 行还没被 put 进表，这条 UPDATE 就会命中 0 行，ref_count 永久偏低，后续 blob GC 会过早删掉仍在被引用的 blob。

写路径天然满足这个前提：`sqlite-vfs-revision.repository.ts` 的 `append` 在 INSERT revision 行之前先 `contentStore.put(content)` 拿到 content_hash（或者调用方传入已存在的 contentHash 时跳过 put）。但有三条**共享 blob 路径**走的是 `insertWithContentHash`（不 put blob，只写 hash 列）：

- `vfs-tree-copy.ts` 的 `copyVfsTree` / `replaceVfsSubtree`
- `seed-live-head-revisions.ts` / `seed-fork-copy-parity.ts` 的 seed
- backfill missing revision 的回补路径

这些路径上的 content_hash 来自源侧已存在的 blob，正常情况下目标 scope 走的是同一个 `vfs_content_blob` 表（全库共享），所以 blob 行其实已经存在。但跨库导入或异常时序下存在丢 blob 的可能。规范要求：**所有共享 blob 路径在写 revision 之前必须 `ensureBlob(contentHash)`（若 blob 不存在则先 put 一份占位/从源拷贝）**。本次 Step 6/Step 15 需核对 seed / tree-copy 链路是否补 `ensureBlob`。

## scopeKey 通道设计（P0-A 闭合）

诶～这一节是上一轮审查漏掉的最大坑。`vfs_entry` 改 `UNIQUE(scope_key, path)` 之后，path 列降级成纯逻辑路径，所有 entry repo 的点查询（`findByPath` / `findContentHash` / `insert` / `update` / `setHeadContentHash` …）如果还按裸 path 寻址，跨 scope 就会撞歧义——session A 的 `/原著/第01.md` 和 session B 的同名文件，裸 path 完全一样，单 WHERE path=? 会随机命中其中一条。所以 scopeKey 必须从顶层一路传到 entry repo 的每一条点查询 SQL，不能在中间某一层丢掉。

现在这套调用链是：`ScopedVfsService(scope, inner) → RevisionAwareVfsService(conn, inner2) → DefaultVfsService(repo)`。`ScopedVfsService` 知道 `scope.scopeKey`，但它在透传给 `inner` 时只传物理 path（经 `toPhysicalPath(scope, logical)`），把 scopeKey 自己消化掉了；下游 `RevisionAwareVfsService` 拿到的是裸 path，根本不知道 scopeKey 是什么。entry_id 化后物理 path 概念消失，这条「物理 path 透传」的通道必须重做。

### 推荐方案：core-internal `InternalVfsService` 接口

诶～这里有意不直接改对外 `VfsService` port。原因说清楚：`VfsService` 是 apps 层 / builtin tools 的对外契约，apps 层约束是零改动，所以对外的 logical-path-only 签名不能动。scopeKey 是 core 内部接线细节，不该污染到 apps。于是新增一个**只在 core 内部 export** 的接口 `InternalVfsService`，和 `VfsService` 同构但每个 path 入参前面都加一个 `scopeKey: string`，所有 path 全是**纯逻辑路径**（不再有物理前缀拼接）。

```ts
// packages/core/src/service/vfs/internal-vfs.port.ts（core-internal，不进 domain/ports）
export interface InternalVfsService {
  list(scopeKey: string, dir: string, options?): Promise<VfsListEntry[]>;
  mkdir(scopeKey: string, path: string): Promise<void>;
  read(scopeKey: string, path: string): Promise<VfsReadResult>;
  write(scopeKey: string, path: string, content: string, options?): Promise<{ version: number }>;
  replace(scopeKey: string, path: string, old: string, neu: string, options?): Promise<{ version: number; replacements: number }>;
  glob(scopeKey: string, pattern: string, options?): Promise<string[]>;
  grep(scopeKey: string, pattern: string, options?): Promise<VfsGrepMatch[]>;
  delete(scopeKey: string, path: string, options?): Promise<void>;
  resetHeadToVersion(scopeKey: string, path: string, version: number): Promise<void>;
  hardDelete(scopeKey: string, path: string, options?): Promise<void>;
  renamePath(scopeKey: string, fromLogical: string, toLogical: string, options?): Promise<void>;
  renamePrefix(scopeKey: string, oldDirLogical: string, newDirLogical: string): Promise<void>;
}
```

三个实现类的处置：

- **`ScopedVfsService`**：对外继续实现 `VfsService`（apps 层契约不变），内部 `inner` 的类型从 `VfsService` 改成 `InternalVfsService`。每个方法体里的 `toPhysicalPath(scope, logical)` 调用退役，改成 `inner.<method>(scope.scopeKey, logical, ...)`。因为 `vfs_entry.path` 直接存纯逻辑路径，inner 返回的 path 本身就是 logical，`list/glob/grep` 不再需要 `toLogicalPath(scope, ...)` 反向转换——直接透传。`resolveLogicalPath` / `assertLogicalPathAllowed` 这两个校验保留（apps 入参还是 user-facing 字符串，需要规范化 + scope 边界校验）。
- **`RevisionAwareVfsService`**：从实现 `VfsService` 改成实现 `InternalVfsService`。`write/delete/resetHeadToVersion/hardDelete/replace/renamePath/renamePrefix` 每个方法都收到 scopeKey，内部 `new SqliteVfsEntryRepository(tx)` 后调 `entryRepo.findByPath(scopeKey, path)` / `entryRepo.insert(scopeKey, path, ...)`，所有点查询都带 scopeKey 消歧。`runInTransactionOrConn` 的事务模型不变。
- **`DefaultVfsService`**：同样改成实现 `InternalVfsService`，所有方法入参加 scopeKey 透传给 `repo.findByPath(scopeKey, ...)` 等。`resetHeadToVersion` 维持现有 unsupported 抛错（无 revision 层）；`hardDelete` 维持走 `delete`；`renamePath/renamePrefix` 处置见 §D（同样抛 unsupported + 明确不可用场景，避免 silent no-op）。

### entry repo port 点查询方法签名变更

`vfs-entry.port.ts` 所有点查询/变更方法签名加 scopeKey（与 §C 列出的 7 个前缀扫描方法一起改）：

| 方法 | 新签名 |
|------|--------|
| `findByPath` | `(scopeKey, path)` |
| `findContentHash` | `(scopeKey, path)` |
| `findContentHashesByPaths` | `(scopeKey, paths)` |
| `insert` | `(scopeKey, path, content)` |
| `insertWithContentHash` | `(scopeKey, path, contentHash)` |
| `insertAtVersion` | `(scopeKey, path, content, version)` |
| `insertDirectory` | `(scopeKey, path)` |
| `update` | `(scopeKey, path, content, options)` |
| `updateWithContentHash` | `(scopeKey, path, contentHash, options)` |
| `setHeadContentHash` | `(scopeKey, path, input)` |
| `delete` | `(scopeKey, path, options)` |
| `renamePathInScope` | `(tx, scopeKey, oldPath, newPath)`（§B 新增） |
| `renamePrefixInScope` | `(tx, scopeKey, oldPrefix, newPrefix)`（§B 新增） |

所有点查询 SQL 统一 `WHERE scope_key = ? AND path = ?`。不引入单独的 `findByScopeAndPath` 解析原语——直接让每个方法带 scopeKey 入参更扁平、更不容易漏改（13 个点查询同时改，不增加抽象层）。

### vfs-tree-copy 内部点查询的 scopeKey 来源

`copyVfsTree` / `replaceVfsSubtree` 入参从 `(repo, fromPrefix, toPrefix)` 重构成 `(repo, fromScope, fromPathPrefix, toScope, toPathPrefix)`（§C 已列）。fromScope / toScope 是 `{ scopeKey: string }` 形式的轻量结构（直接传 scopeKey 字符串也可，看实现偏好）。内部所有 entry repo 调用的 scopeKey 取法：

- 源侧扫描（`scanContents` / `listDirectoryPathsUnderPrefix` / `findContentHash`）：用 `fromScope.scopeKey`；
- 目标侧变更（`insertDirectory` / `insertWithContentHash` / `updateWithContentHash` / `insert` / `update` / `findByPath` 探测）：用 `toScope.scopeKey`。

注意是「源侧源 scope，目标侧目标 scope」——不能全用一个 scopeKey，否则跨 scope 拷贝（template pull / session fork）会找不到源文件。

### 落点小结

| 调用链节点 | 知道 scopeKey 吗 | 改造动作 |
|-----------|----------------|--------|
| apps 层调用方 | 否（只懂 logical path） | 零改动 |
| `ScopedVfsService`（VfsService 契约） | 是（`scope.scopeKey`） | 翻译点：apps-logical → (scopeKey, logical)；`inner` 类型改 `InternalVfsService` |
| `RevisionAwareVfsService`（InternalVfsService） | 是（入参带） | 实现 `InternalVfsService`，所有 entry repo 点查询带 scopeKey |
| `DefaultVfsService`（InternalVfsService） | 是（入参带） | 同上，`renamePath/renamePrefix` 抛 unsupported |
| `vfs-tree-copy`（不是 service，是 logic 层） | 是（fromScope/toScope 入参） | 源侧用 fromScope.scopeKey，目标侧用 toScope.scopeKey |

## 最终项目结构

本次为「现有文件大改 + 少量新增」，无新增顶层目录。

### 新增文件

| 文件 | 用途 |
|------|------|
| `packages/core/src/bootstrap/schema-migrations/vfs-entry-id-redesign-v1.ts` | 表重建 migration |
| `packages/core/src/domain/vfs/logic/vfs-rename-primitive.ts` | repository 层路径重命名原语（单事务批量 UPDATE） |
| `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | 迁移用辅助：物理 path 反解 scope_key + 纯逻辑路径 |
| `packages/core/src/service/vfs/internal-vfs.port.ts` | core-internal `InternalVfsService` 接口（P0-A scopeKey 通道） |
| `packages/core/test/vfs/vfs-entry-id-migration.test.ts` | 迁移可重入测试（V4、V11） |
| `packages/core/test/vfs/vfs-rename-primitive.test.ts` | rename 性能测试（V1） |
| `packages/core/test/message-checkpoint/restore-path-reset-head.test.ts` | 回滚不 append 测试（V3） |
| `packages/core/test/message-checkpoint/checkpoint-capture-transactional.test.ts` | capture 事务化并发测试（V8） |

### 主要修改文件

详见下方「变更点清单」。core 内部大改，三端 apps 层零改动（API 契约不变）。

## 变更点清单

诶～这块按模块归类，每个改动都标了来源（对应 PRD 哪条 + 探索报告哪条证据）。

### A. Schema 与迁移（PRD §1/§2/§3/§6/§9）

| 文件 | 改动 |
|------|------|
| `bootstrap/vfs/vfs-schema.ts` | `VFS_ENTRY_TABLE_DDL` 改 `entry_id` 主键 + `scope_key` + `path` 带 UNIQUE，删 `version`/`storage_kind`/`external_uri` |
| `bootstrap/vfs/vfs-revision-schema.ts` | `PRIMARY KEY (entry_id, version)`，删 `path`/`content`/`storage_kind` 列；追加 3 个触发器 DDL 到 `VFS_REVISION_SCHEMA_STATEMENTS` |
| `bootstrap/vfs/vfs-content-blob-schema.ts` | 加 `ref_count INTEGER NOT NULL DEFAULT 0` |
| `bootstrap/message-checkpoint/message-checkpoint-schema.ts` | `message_checkpoint_file` 删 `logical_path`，加 `entry_id`，主键 `(session_id, message_id, entry_id)` |
| `bootstrap/novel-master-bootstrap.ts` | `NOVEL_MASTER_SCHEMA_STATEMENTS` 重组（触发器 DDL 入列）；`SCHEMA_BOOT_VERSION` 1→2 |
| `bootstrap/schema-align/schema-column-alignments.ts` | 评估 `vfs_entry.head_version`/`entry_kind` 条目是否仍需（新库已自带，保留条目无害，对齐逻辑对新库 no-op）；**新增** `vfs_content_blob.ref_count` 条目（`ALTER TABLE vfs_content_blob ADD COLUMN ref_count INTEGER NOT NULL DEFAULT 0`）作为双保险——迁移 Step 5b 已先补列，此条目防未来旧库跳过 migration 直进 align 的边角场景 |
| `bootstrap/schema-migrations/index.ts` | 注册 `vfsEntryIdRedesignV1Migration` 到 `SCHEMA_MIGRATIONS` 队尾，export id 常量 |
| **新增** `bootstrap/schema-migrations/vfs-entry-id-redesign-v1.ts` | 表重建：三表一次性 INSERT...SELECT 反查 entry_id + blob ref_count 初始化 + 触发器创建（超大库可选按表 LIMIT 分批降低引擎峰值内存；不防 JS OOM，纯引擎内部 JOIN 不进 JS 堆） |
| **新增** `domain/vfs/logic/infer-scope-from-path.ts` | `inferScopeFromPhysicalPath`：先判 `/projects/{pid}/sessions/{sid}` 再判 `/projects/{pid}/template` 再判 `/template` |

### B. Model 与 Port 契约（PRD §1/§2/§7）

| 文件 | 改动 |
|------|------|
| `domain/vfs/model/vfs-entry.ts` | 加 `entryId: number`、`scopeKey: string`；删 `storageKind`/`externalUri`/凗余 `version`；`VfsStorageKind` 类型删除 |
| `domain/vfs/model/vfs-revision.ts` | 加 `entryId: number`；`VfsRevisionAppendInput` 继承时带 entryId；删 `storageKind` |
| `domain/vfs/repositories/vfs-revision.port.ts` | 全部方法签名 path → entry_id：`findByEntryAndVersion`/`findMetaByEntryAndVersion`/`findMetasByEntryVersions`/`findMaxVersionForEntry`/`adjustRefCount(entryId,...)`/`repairRefCountFloor(entryId,...)`；前缀扫描类入参改 `(scopeKey, pathPrefix)`：`listKeysUnderScope`/`deleteExceptReachable`/`deleteUnreferencedUnderScope` |
| `domain/vfs/repositories/vfs-entry.port.ts` | 加 `entryId` 字段查询；新增 `renamePathInScope(tx, scopeKey, oldPath, newPath)` 与 `renamePrefixInScope(tx, scopeKey, oldPrefix, newPrefix)` 原语声明 |
| **`domain/vfs/ports/vfs-service.port.ts`** | **新增 `renamePath(from, to, options?): Promise<void>` 与 `renamePrefix(oldDir, newDir): Promise<void>` 两个方法**。这是 rename 原语的服务层入口，让 `vfs-move.ts` 的 `moveVfsPath(vfs: VfsService, ...)` 能拿到 rename 能力（原本 `VfsService` 只有 mkdir/read/write/delete，拿不到 tx+repo+scopeKey 通道）。语义：`renamePath` 重命名单个文件 entry，`renamePrefix` 批量重命名目录下所有子 entry |
| **`domain/vfs/ports/vfs-restore.port.ts`** | **新增 `resetHeadToVersion(path, version): Promise<void>`**。`restore-path.ts` 的 vfs 入参类型是 `VfsRestorePort`（只有 mkdir/read/write/delete），但本次语义要求回滚改走 `resetHeadToVersion`。需补 port 声明。`ScopedVfsService` / `RevisionAwareVfsService` 两个实现类已实现该方法，只需补 port 声明，影响面小 |
| **新增** `service/vfs/internal-vfs.port.ts`（P0-A） | core-internal `InternalVfsService` 接口（不进 `domain/ports`，**只在本仓 core 内部 export**）。所有 path 入参前面加 `scopeKey: string`，path 为纯逻辑路径。这是 `ScopedVfsService` 与其 inner 之间的契约，让 scopeKey 能一路透传到 entry repo 点查询。详见「scopeKey 通道设计」一节 |
| `service/vfs/impl/scoped-vfs.service.ts`（P0-A） | 对外继续实现 `VfsService`（apps 层零改动）；`inner` 类型改 `InternalVfsService`。每个方法体里的 `toPhysicalPath(scope, logical)` 调用退役，改为 `inner.<method>(scope.scopeKey, logical, ...)`；`list/glob/grep` 返回的 path 本身就是 logical（inner 直接返 logical），不需要 `toLogicalPath` 反向转换；`resolveLogicalPath`/`assertLogicalPathAllowed` 保留（apps 入参规范化 + scope 边界校验） |
| `service/vfs/impl/revision-aware-vfs.service.ts`（P0-A） | 从实现 `VfsService` 改为实现 `InternalVfsService`。`write/delete/resetHeadToVersion/hardDelete/replace/renamePath/renamePrefix` 每个方法都收到 scopeKey，内部 `entryRepo.findByPath(scopeKey, path)` 等所有点查询都带 scopeKey 消歧 |
| `domain/message-checkpoint/model/message-checkpoint.ts` | `MessageCheckpointFile.logicalPath` → `entryId: number` |

### C. Repository 实现（PRD §1/§4/§7）

| 文件 | 改动 |
|------|------|
| `domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts` | 全部 SQL `WHERE path = ?` → `WHERE entry_id = ?`；`path LIKE` 前缀扫描改 `JOIN vfs_entry ON ... WHERE scope_key = ? AND (path = ? OR path LIKE ?)`；`rowToRevision` 返 entryId；port 当前 11 个方法（实测 `vfs-revision.port.ts`，不是以前误说的 13），全部重写 |
| `domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts` | INSERT/UPDATE 带 `scope_key`/`entry_id`；新增 `renamePathInScope`/`renamePrefixInScope` 实现（单事务 `UPDATE vfs_entry SET path = ? WHERE entry_id = ?` 与 `UPDATE vfs_entry SET path = REPLACE(path, ?||'/', ?||'/') WHERE scope_key = ? AND (path = ? OR path LIKE ?||'/%')`）；7 个前缀扫描方法（见下表）全部改 `(scopeKey, pathPrefix)` 入参；**11 个点查询/变更方法（P0-A）**`findByPath`/`findContentHash`/`findContentHashesByPaths`/`insert`/`insertWithContentHash`/`insertAtVersion`/`insertDirectory`/`update`/`updateWithContentHash`/`setHeadContentHash`/`delete` 全部加 `scopeKey` 首参，SQL 统一 `WHERE scope_key = ? AND path = ?`（详见「scopeKey 通道设计」表格） |
| `domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts` | 全部 SQL `logical_path` → `entry_id`；`insertCheckpoint` 入参改 entry_id |

#### entry repository 前缀方法批量改造清单（全部从 path LIKE 物理前缀改为 scope_key + 逻辑 path 前缀）

诶～这块是 P0 级别的系统性坑。`vfs_entry.path` 改存纯逻辑路径后，所有 `path LIKE '/projects/{pid}/.../%'` 这种**物理前缀**扫描都会命中 0 行，导致 `copyVfsTree` / `replaceVfsSubtree` / `deleteVfsPrefix` 静默坏掉，template pull 和 session fork 会丢内容。下面这 7 个方法全部要改：

| # | 方法 | 当前签名（坏） | 新签名 |
|---|------|---------------|--------|
| 1 | `list` | `(dir: string)`（内部拼物理 like） | `(scopeKey, dir)`，SQL `WHERE scope_key=? AND (path=? OR path LIKE ?||'/%')` |
| 2 | `listDirectoryPathsUnderPrefix` | `(physicalPrefix: string)` | `(scopeKey, pathPrefix)` 同上 |
| 3 | `listEntriesUnderPrefix` | `(prefix: string)` | `(scopeKey, pathPrefix)` 同上 |
| 4 | `listFileMetaUnderPrefix` | `(physicalPrefix: string)` | `(scopeKey, pathPrefix)` 同上 |
| 5 | `listFileHeadsUnderPrefix` | `(physicalPrefix: string)` | `(scopeKey, pathPrefix)` 同上 |
| 6 | `scanContents` | `(pathPrefix?: string)` | `(scopeKey, pathPrefix?: string)` 同上 |
| 7 | `delete` | 保留单 entry 删除，但内部 SQL 不再拼物理前缀 | 入参增加 `scopeKey`，逻辑路径命中 |

统一 SQL 范式：

```sql
WHERE scope_key = ?
  AND (path = ? OR path LIKE ? || '/%')
```

同步改造上游的 `vfs-tree-copy.ts` 三个函数，入参从 `fromPrefix/toPrefix: string`（物理路径）重构成 `(fromScope, fromPathPrefix) → (toScope, toPathPrefix)`：

| 函数 | 新签名 |
|------|--------|
| `copyVfsTree` | `(repo, fromScope, fromPathPrefix, toScope, toPathPrefix, options?)` |
| `replaceVfsSubtree` | `(repo, fromScope, fromPathPrefix, toScope, toPathPrefix, options?)` |
| `releaseAndDeleteVfsPrefix` | `(repo, revisionRepo, scopeKey, pathPrefix)`——**保留 revisionRepo**，内部要调 `decrementLiveRefsUnderPrefix` + `sweepRevisionsUnderScope`（泛化后的 sweep） |
| `deleteVfsPrefix` | `(repo, scopeKey, pathPrefix)`——无 revision 操作，只需 repo |

调用点同步改：
- `service/template/impl/template-pull.service.ts` 的 `projectTemplatePull` 原本调 `replaceVfsSubtree(vfs, "/template", \`/projects/${projectId}/template\`, { revisions })`，改为 `replaceVfsSubtree(vfs, "global", "/template", \`project:${projectId}\`, "/template", { revisions })`
- `sessionTemplatePull` 中的 `initializeSessionWorkspace` 内部走 fork copy 路径同步改
- 其他 seed / fork copy 调用点（见 Step 15）

这些改造并入 Step 5（entry repo 改造）与新增 Step 5b（tree-copy + template-pull 调用点同步）。

### D. 操作语义与写路径（PRD §4/§5/§7）

| 文件 | 改动 |
|------|------|
| `service/vfs/impl/revision-aware-vfs.service.ts` | 改为实现 `InternalVfsService`（§B，P0-A）；write/resetHead/delete/hardDelete/replace/renamePath/renamePrefix 全部入参带 scopeKey，先 `findByPath(scopeKey, path)` 取 entryId 再调 revision repo；`restorePathToRevision` 调用点（经 restore-path.ts）改走 resetHead 语义 |
| `domain/vfs/logic/vfs-move.ts` | `moveVfsFile`/`moveVfsDirectory` 逐文件循环删除，改调 `vfs.renamePath(from, to)` / `vfs.renamePrefix(oldDir, newDir)`（由 VfsService 在事务内调 `vfs-rename-primitive.ts`）；`assertMoveTargetAvailable` 保留前置校验；revision/checkpoint 零操作（认 entry_id）。**接入路径**：`moveVfsPath(vfs: VfsService, from, to)` 原本拿不到 tx/repo/scopeKey 通道，本次在 §B 给 `VfsService` 加了 `renamePath`/`renamePrefix` 两个方法（对外 logical path），`InternalVfsService` 同名方法带 scopeKey 首参（P0-A），`moveVfsPath` 优先走 `vfs.renamePath` / `vfs.renamePrefix`；`ScopedVfsService` 作为翻译点把 `scope.scopeKey` 补上后调 `inner.renamePath(scopeKey, ...)`；`RevisionAwareVfsService` 在 `runInTransactionOrConn` 内部调 `renameVfsEntry`/`renameVfsDirectory` 原语 |
| **新增** `domain/vfs/logic/vfs-rename-primitive.ts` | `renameVfsEntry(tx, repo, scopeKey, oldPath, newPath)` + `renameVfsDirectory(tx, repo, scopeKey, oldDir, newDir)` 单事务原语 |
| `domain/message-checkpoint/logic/restore-path.ts` | `restorePathToRevision` L154 `vfs.write(...)` 改 `vfs.resetHeadToVersion(logicalPath, version)`（V3）；删 L102/L177 `toPhysicalPath`；meta 解析切 entryId |
| `service/vfs/impl/vfs.service.ts`（`DefaultVfsService`） | **renamePath/renamePrefix 处置（P2-F）**：与现有 `resetHeadToVersion`（L201 抛 unsupported）对齐，`DefaultVfsService` 的 `renamePath` / `renamePrefix` 直接抛 `renamePath is unsupported without revision history`。理由：rename 原语依赖事务 + repo + scopeKey，而 `DefaultVfsService` 本就只拿 `repo`（无 `conn`），不在事务里跑，且 rename 在无 revision 的场景下语义不完整（历史指针元法跟随）。不可用场景：任何走 `DefaultVfsService` 而非 `RevisionAwareVfsService` 的接线；生产 wiring 是 `ScopedVfsService(RevisionAwareVfsService(...))`，不会真的命中此分支，但为类型安全必须实现。 |

### E. ref_count 与补偿清理（PRD §3/§7/§8）

| 文件 | 改动 |
|------|------|
| `domain/vfs/logic/revision-ref-count.ts` | 删 `toPhysicalPointers`（PRD §7）；`adjustRef`/`transferLiveRef` 入参 path → entryId；`incrementRefsForCheckpointFiles`/`decrementRefsForCheckpointFiles` 直接吃 entryId（checkpoint 存 entryId）；`repairRefCounts` 删内部 `toPhysicalPath`/`scopePhysicalPrefix`（L101/L113），改 scope_key+entryId 查询 |
| `domain/vfs/logic/vfs-path-mapper.ts` | revision/checkpoint 链路（约 13 处源码调用）的 `toPhysicalPath`/`toLogicalPath`/`scopePhysicalPrefix` 全部退役；**文件本身保留**（VFS API 层 scoped-vfs.service.ts 仍吃 logical path 做入参转换，vfs_entry.path 改存纯逻辑路径后这些函数退化为 scope 内直接返回 logical） |
| `domain/vfs/logic/revision-pair-key.ts` | `revisionPairKey(entryId, version)` → `${entryId}:${version}` |
| `domain/message-checkpoint/logic/resolve-reconcile-paths.ts` | 删 L40-51 `reconcilePairs` 的 `toPhysicalPath` 拼接（PRD §7）；保留 L63-92 set-diff 核心算法（pathsNeedWrite/pathsNeedDelete），入参 `Map<logicalPath, version>` → `Map<entryId, version>` |
| `service/message-checkpoint/impl/message-rollback.service.ts` | `reconcileVfsPaths`（L302-405）的 `toPhysicalPath` 拼接块删除；plan 类型 `pathsNeedWrite/pathsNeedDelete` 改 entry_id 集 |
| `domain/message-checkpoint/logic/list-session-files.ts` | `listSessionFileHeads` 删 `scopePhysicalPrefix`/`toLogicalPath`，按 `scope_key` 查返回 `{entryId, path, headVersion}` |
| `domain/message-checkpoint/logic/detect-missing-revisions.ts` | 删 `toPhysicalPath`；`findMissingRevisionPointers` 用 entryId pair |
| `domain/message-checkpoint/logic/revision-gc.ts` | `sweepSessionRevisions` 可达集按 `scope_key + entry_id`；`revisionReachableKey` 改 entryId；迁移分支判断（L49-52 `isSchemaMigrationApplied`）在 entry_id migration 后默认 true |

### F. GC 补全（PRD §8）

| 文件 | 改动 |
|------|------|
| `domain/vfs/logic/vfs-tree-copy.ts` | `releaseAndDeleteVfsPrefix` 裸调改走新增的 `sweepRevisionsUnderScope(tx, scopeKey, pathPrefix)`（泛化 sweep，支持 session/project/global 三 scope） |
| `domain/vfs/logic/deferred-blob-gc.ts` | `runDeferredBlobGc` 语义降级为安全网（触发器即时回收后，全表扫仅作一致性修复）；文件逻辑不变 |
| `service/template/impl/template-pull.service.ts` | `projectTemplatePull` L41 事务 await 后补 `await runDeferredBlobGc(this.conn)`（对齐 sessionTemplatePull L55） |
| `revision-ref-count.ts` `repairRefCounts` | 补空闲调度钩子：在新 migration `runPendingSchemaMigrations` 之后、`writeSchemaBootVersion` 之前条件触发（仅当本次跑了 entry-id migration） |

### G. 消费方联动（PRD §7）

| 文件 | 改动 |
|------|------|
| `domain/chat/logic/seed-fork-copy-parity.ts` | `adjustRef` 入参改 entryId；append input 带 entryId；删 `storageKind` 传参 |
| `domain/message-checkpoint/logic/backfill-missing-revision.ts` | 入参改 entryId |
| `domain/vfs/logic/seed-live-head-revisions.ts` | `adjustRef` 改 entryId；删 `storageKind` |
| `domain/chat/logic/resolve-current-workspace-snapshot.ts` | 删 `scopePhysicalPrefix`/`toLogicalPath` |
| `domain/vfs/logic/format-vfs-error-for-llm.ts` | 评估 `toLogicalPath` 是否在清理范围（若仅错误格式化用，可保留或改 scope_key 查询） |
| `bootstrap/schema-migrations/vfs-revision-ref-count-v1.ts` | 一次性脚本，迁移完成后保留 id 占位避免重复跑，但内部 `toPhysicalPath` 逻辑不再被新库触发（新库已过 entry-id migration）。**兼容策略**：`vfs-revision-ref-count-v1.ts` L11/L35 直接 import 了 `revisionPairKey(path, version)`，本次把 `revisionPairKey` 改成 `(entryId, version)` 签名会让该 migration TS 编译炸掉。因该 migration 在新库上已 applied（早于 entry-id migration 跑过），不会重新执行，属历史遗留代码冻结。规范要求**让 migration 内部不再 import `revisionPairKey`，改用本地 `\`${path}:${version}\`` 字面拼接**（保持原语义、不动数据），避免跨 migration 的耦合编译错。`toPhysicalPath` import 同理保留（只在该冻结 migration 内部用，不动其语义） |

### H. 测试改写（伴随各 phase）

| 文件 | 改动类型 |
|------|----------|
| `test/vfs/vfs-move.test.ts`、`vfs-copy.test.ts`、`scoped-vfs.service.test.ts`、`sqlite-vfs-entry.repository.test.ts`、`revision-aware-vfs.service.test.ts`、`restore-mutating-path-heads.test.ts`、`fail-restore-compensation.test.ts`、`default-vfs.service.test.ts` | 依赖 path 主键的断言改 entry_id/scope_key |
| `test/vfs/vfs-path-mapper.test.ts` | 取决于 path-mapper 保留范围（VFS API 层仍用则保留测试） |
| `test/vfs/vfs-content-blob-migration.test.ts` | 既有迁移测试范本，新迁移测试模仿其结构 |
| `test/message-checkpoint/rollback-reach-hash-batch.test.ts`、`rollback-version-short-circuit.test.ts`、`restore-path.test.ts` | `revisionPairKey(physical, ver)` 构造的 mock map key 全改 `entryId:version` |
| `test/message-checkpoint/{rollback-ref-count,rollback-revision-backfill,rollback-execution-redesign,rollback-degraded,truncate-tail-in-transaction,revision-gc,blob-gc,message-delete-gc,capture,resolve-rollback-anchor}.test.ts` | 凡用 `toPhysicalPath` 构造 fixture 的改 entry_id 注入 |
| `test/message-checkpoint/performance.test.ts` | capture 事务化后阈值复测（V8） |
| `test/workplace/{template-pull,workplace-materialize,workplace-materialize-engine}.test.ts` | 触及 `replaceVfsSubtree`/seed 的，验证触发器链路（V5、V10） |

### I. 三端 apps 层（零改动，仅核实）

| 端 | 文件 | 核实点 |
|----|------|--------|
| mobile | `apps/mobile/src/services/*` | rename/delete/rollback 全经 core service，API 不变 |
| mobile | `apps/mobile/__tests__/vfs-file-manager.session.integration.test.tsx` | 已 mock `migrateWorkplaceDirRename`，rename 重做后规则迁移逻辑不变 |
| desktop | `apps/desktop/src/main/ipc/handlers/vfs.ts:239` | `handleVfsRename` 漏 `migrateWorkplaceDirRename`（已知不对称，本次不修） |
| cli | `apps/cli/test/helpers.ts:302` | `countSessionCheckpointPointers` SQL 不引 `logical_path`，表重建后需 e2e 核实不静默坏 |

## 兼容性或迁移说明

诶～迁移这块是本次最重的部分，单独说明。

### 迁移策略

一次性离线迁移，app 启动时检测旧 schema 执行。采用表重建模式（SQLite 不支持 DROP COLUMN）。由于三张表（vfs_entry/vfs_revision/message_checkpoint_file）都要 rebuild + 数据回填，回填 SQL 采用**一次性单条 `INSERT INTO _new ... SELECT ... JOIN _migration_path_map`**，纯引擎内部执行不进 JS 堆（与 `vfs-content-blob-zlib-v1` 当年防 JS OOM 的场景不同，那次是循环里调 `store.put(明文)` 把正文拉进 JS 堆才需要 `LIMIT 32`）。只有当单条 SQL 的引擎内存峰值在大库上需要约束时，才按表加 `LIMIT N` 分批（仅降低引擎峰值内存，不防 JS OOM，单事务内也无法 yield）。

### 迁移步骤（migration `up(tx)` 内）

1. **探测**：`PRAGMA table_info(vfs_entry)` 检测是否有 `path` PRIMARY KEY（旧形态）vs `entry_id`（新形态），决定是否 rebuild。
2. **建 _new 表**：`vfs_entry_new`/`vfs_revision_new`/`message_checkpoint_file_new`（新 schema 形态，无触发器，触发器最后建）。
3. **回填 vfs_entry**（优先一次性 INSERT...SELECT，超大库可选 LIMIT 分批）：`INSERT INTO vfs_entry_new(entry_id, scope_key, path, content_hash, head_version, mtime_ms, entry_kind) SELECT <entry_id 生成>, <inferScopeFromPhysicalPath(path)>, <logicalPath>, content_hash, head_version, mtime_ms, entry_kind FROM vfs_entry`。entry_id 用 `AUTOINCREMENT` 自动生成（INSERT 不带 entry_id 列）。同时把 `path → entry_id` 映射存入临时 `_migration_path_map(path TEXT, entry_id INTEGER)` 表（供 revision/checkpoint 回填反查）。纯引擎内部 JOIN，不进 JS 堆。
4. **回填 vfs_revision**（一次性 INSERT...SELECT）：`INSERT INTO vfs_revision_new(entry_id, version, status, mtime_ms, content_hash, ref_count) SELECT m.entry_id, r.version, r.status, r.mtime_ms, r.content_hash, r.ref_count FROM vfs_revision r JOIN _migration_path_map m ON r.path = m.path`。引擎内 JOIN _migration_path_map 的索引，无 JS 堆参与。
5. **回填 message_checkpoint_file**（一次性 INSERT...SELECT）：`INSERT INTO message_checkpoint_file_new(session_id, message_id, entry_id, revision_version) SELECT c.session_id, c.message_id, m.entry_id, c.revision_version FROM message_checkpoint_file c JOIN chat_session s ON c.session_id = s.id JOIN _migration_path_map m ON m.path = ('/projects/' || s.project_id || '/sessions/' || s.id || c.logical_path) WHERE m.entry_id IS NOT NULL`。注意 `chat_session` 主键列名是 `id`（不是 `session_id`），项目 id 列名是 `project_id`，路径拼接必须用 SQL 字符串拼接 `||`，不要用 JS 占位符。找不到的行（`m.entry_id IS NULL`）丢弃并记 warning。
5b. **探测式补 `vfs_content_blob.ref_count` 列**（P0）：`PRAGMA table_info(vfs_content_blob)` 探测是否已有 `ref_count` 列，无则 `ALTER TABLE vfs_content_blob ADD COLUMN ref_count INTEGER NOT NULL DEFAULT 0`。**这一步必须在 Step 6 之前**——`vfs_content_blob` 不在 rebuild 名单里（它没有 path 列），旧库本身没有 `ref_count` 列；canonical DDL 的 `CREATE TABLE IF NOT EXISTS` 对旧库 no-op，`alignSchemaColumns` 又跑在 migration 之后（见 `novel-master-bootstrap.ts` L86-92 顺序：DDL → migration → align），如果不在这里显式补列，Step 6 的 `UPDATE ... ref_count` 会撞 `no such column: ref_count`。Step 9 的触发器创建同样依赖这一列存在（触发器引用 `vfs_content_blob.ref_count`），顺序不能乱。
6. **回填 vfs_content_blob.ref_count**：`UPDATE vfs_content_blob SET ref_count = (SELECT COUNT(*) FROM vfs_revision_new WHERE content_hash = vfs_content_blob.content_hash)`。初始化为当前 revision 引用数。
7. **DROP 旧表 + RENAME _new → 正名**：`DROP TABLE vfs_revision; DROP TABLE vfs_entry; ...`（注意外键依赖顺序：先 revision/checkpoint_file 后 entry），`ALTER TABLE vfs_entry_new RENAME TO vfs_entry` 等。`DROP TABLE _migration_path_map`。
8. **重建索引**：`idx_vfs_entry_scope_path ON vfs_entry(scope_key, path)`、`idx_vfs_revision_entry ON vfs_revision(entry_id)` 等。
9. **创建触发器**：3 个 blob ref_count 触发器（见「触发器定义」）。
10. **幂等保护**：步骤 1 的探测决定是否执行；若 `vfs_entry` 已是 `entry_id` 主键形态，整个 `up` 直接 return（靠 `PRAGMA table_info` + 列存在性判断）。

### 进度提示

因 `bootstrapNovelMaster` 是**单事务同步 await**（外层事务包住整个 bootstrap），apps 层拿不到中途进度回调，无法做百分比进度。本次决策**不突破单事务框架**（避免重写迁移执行框架）。因此 apps 层 UI 退化为「升级中」占位提示（转圈 spinner），移动端桌面端在 bootstrap 调用前后包一层 loading UI（apps 层实现，core 提供 `isMigrationPending(conn, id)` 探测 API）。迁移完成后进入主界面。重启后 migration 已 applied，走快路径。**不做百分比进度**（单事务同步无法 yield 报告进度），后续如需百分比需另开迭代重构 migration runner 加 `onProgress` 回调。

### canonical DDL 同步

`NOVEL_MASTER_SCHEMA_STATEMENTS` 改为新形态（含触发器 DDL），保证新装库直接建出最终结构。`SCHEMA_BOOT_VERSION` 1→2。旧库（user_version=1）走慢路径：先跑 DDL（此时表还是旧 schema，DDL 用 IF NOT EXISTS 幂等，不会重建）→ 跑 pending migration（rebuild）→ alignSchemaColumns（对新 schema no-op）→ seed → 写 user_version=2。

## 详细实现步骤

诶～步骤按依赖关系排序，每个标了 phase/blocking/qa。

- **Step 1 — phase-schema-migration — blocking: yes — qa: auto**：新增 `infer-scope-from-path.ts`（物理 path 反解 scope_key + 纯逻辑路径）；新增 `vfs-entry-id-redesign-v1.ts` migration（三表 rebuild + 数据回填 + **Step 5b 探测式 `ALTER TABLE vfs_content_blob ADD COLUMN ref_count`（必须在 Step 6 UPDATE 之前，旧库无此列会撞 `no such column`；触发器创建也依赖此列）** + 触发器创建，**一次性 INSERT...SELECT，超大库可选按表 LIMIT 分批**）；注册到 `SCHEMA_MIGRATIONS`；canonical DDL（vfs-schema/vfs-revision-schema/vfs-content-blob-schema/message-checkpoint-schema）改新形态含触发器；`SCHEMA_BOOT_VERSION` 1→2。`SCHEMA_COLUMN_ALIGNMENTS` 同步登记 `vfs_content_blob.ref_count` 条目（双保险）。

- **Step 2 — phase-schema-migration — blocking: yes — qa: auto**：新增 `test/vfs/vfs-entry-id-migration.test.ts`：旧 schema（path 主键 + 冗余列）→ 新 schema 可重入迁移；100 文件/500 revision 样本数据正确迁移；entry_id 唯一；ref_count 统计正确；失败重启续跑（靠 PRAGMA 探测 + migration id 幂等）；找不到 entry_id 的 checkpoint 行丢弃。对应 V4、V6、V11。

- **Step 3 — phase-entry-model — blocking: yes — qa: auto**：`model/vfs-entry.ts` 加 `entryId`/`scopeKey`，删 `storageKind`/`externalUri`/冗余 `version`，删 `VfsStorageKind` 类型；`model/vfs-revision.ts` 加 `entryId`，删 `storageKind`；`model/message-checkpoint.ts` `logicalPath` → `entryId`。

- **Step 4 — phase-revision-repo — blocking: yes — qa: auto**：`vfs-revision.port.ts` 全部方法签名 path → entry_id（含前缀扫描类改 scopeKey+pathPrefix）；`sqlite-vfs-revision.repository.ts` port 现有 **11 个方法**（不是 13）全部重写 SQL（WHERE entry_id / JOIN vfs_entry ON scope_key）；`revision-pair-key.ts` 改 `${entryId}:${version}`。**兼容旧 migration**：`bootstrap/schema-migrations/vfs-revision-ref-count-v1.ts` L11/L35 直接 import 了 `revisionPairKey(path, version)`，签名改变会让该 migration TS 编译炸掉。处理方式：在该 migration 内部删除 `revisionPairKey` import，改用本地 `\`${path}:${version}\`` 字面拼接（语义等价、不动数据）；该 migration 在新库上已 applied（早于 entry-id migration），属冻结代码，不再实际跑。

- **Step 5 — phase-revision-repo — blocking: yes — qa: auto**：`vfs-entry.port.ts` 加 `entryId` 查询 + `renamePathInScope`/`renamePrefixInScope` 原语声明；**11 个点查询/变更方法（P0-A）**`findByPath`/`findContentHash`/`findContentHashesByPaths`/`insert`/`insertWithContentHash`/`insertAtVersion`/`insertDirectory`/`update`/`updateWithContentHash`/`setHeadContentHash`/`delete` 全部加 `scopeKey` 首参；`sqlite-vfs-entry.repository.ts` INSERT/UPDATE 带 scope_key/entry_id，新增两个 rename 原语实现（单事务批量 UPDATE），**7 个前缀扫描方法**（`list`/`listDirectoryPathsUnderPrefix`/`listEntriesUnderPrefix`/`listFileMetaUnderPrefix`/`listFileHeadsUnderPrefix`/`scanContents`/`delete`）全部从 path LIKE 物理前缀改为 `(scopeKey, pathPrefix)` 入参，统一 SQL `WHERE scope_key=? AND (path=? OR path LIKE ?||'/%')`。
- **Step 5a — phase-scope-key-channel — blocking: yes — qa: auto**（**P0 级别**）：闭合 scopeKey 通道。新增 `service/vfs/internal-vfs.port.ts`（core-internal `InternalVfsService` 接口，每个 path 入参前加 `scopeKey`）；`ScopedVfsService` 的 `inner` 类型改 `InternalVfsService`，每个方法体里 `toPhysicalPath(scope, logical)` 退役改为 `inner.<method>(scope.scopeKey, logical, ...)`，`list/glob/grep` 返回 path 不再走 `toLogicalPath` 反向转换（inner 直接返 logical）；`RevisionAwareVfsService` 从实现 `VfsService` 改为实现 `InternalVfsService`，`write/delete/resetHeadToVersion/hardDelete/replace` 每个方法都收到 scopeKey 透传给 entry repo 点查询；`DefaultVfsService` 同样改实现 `InternalVfsService`，`renamePath`/`renamePrefix` 抛 unsupported（见 §D）。**如不动这块，vfs_entry 改 `UNIQUE(scope_key, path)` 后跨 scope 同名 path 会随机命中，silent 数据错乱**。
- **Step 5b — phase-revision-repo — blocking: yes — qa: auto**（**P0 级别**）：同步改造上游 `vfs-tree-copy.ts` 与调用点。`copyVfsTree`/`replaceVfsSubtree`/`releaseAndDeleteVfsPrefix`/`deleteVfsPrefix` 入参从 `fromPrefix/toPrefix: string`（物理）重构成 `(fromScope, fromPathPrefix) → (toScope, toPathPrefix)`；同步改 `service/template/impl/template-pull.service.ts` 的 `projectTemplatePull`（现调 `replaceVfsSubtree(vfs, "/template", \`/projects/${projectId}/template\`, {revisions})`，改为传 scopeKey 形式）与 `sessionTemplatePull` 中的 `initializeSessionWorkspace` fork copy 路径。**如不动这块，vfs_entry.path 改纯逻辑路径后所有物理前缀扫描命中 0 行，template pull / session fork 会静默丢内容**。

- **Step 6 — phase-ref-count-entry-id — blocking: yes — qa: auto**：`revision-ref-count.ts` 删 `toPhysicalPointers`；`adjustRef`/`transferLiveRef` 入参 path → entryId；`incrementRefsForCheckpointFiles`/`decrementRefsForCheckpointFiles` 直接吃 entryId；`repairRefCounts` 删内部 path 映射改 scope_key+entryId 查询。保持 B-1（hardDelete recursive adjustRef）、B-2（adjustRefCount 缺失行抛 NOT_FOUND）修复。**承诺式 `ensureBlob(contentHash)`（P1-C）**：seed / backfill / tree-copy 共享 blob 路径在写 revision 前**必须** `ensureBlob(contentHash)`——若 blob 不存在则先 `contentStore.put(明文)` 或从源 scope 拷贝一份，不能依赖「正常时序下 blob 已存在」。具体落点：`vfs-tree-copy.ts` 的 `insertWithContentHash` 调用前、`seed-live-head-revisions.ts` / `seed-fork-copy-parity.ts` 的 append 前、`backfill-missing-revision.ts` 的回补前。理由见「不变量：revision INSERT 前对应 blob 行必须已存在」一节——触发器 `trg_revision_insert_inc_blob_ref` 的 UPDATE 是带前提的，blob 行不在会命中 0 行，ref_count 永久偏低。

- **Step 7 — phase-move-rename — blocking: yes — qa: auto**：新增 `vfs-rename-primitive.ts`（`renameVfsEntry` + `renameVfsDirectory` 单事务原语）；**接入路径**：在 `InternalVfsService` 接口加 `renamePath(scopeKey, from, to, options?)` / `renamePrefix(scopeKey, oldDir, newDir)` 两个方法（§B；对外 `VfsService` port 同样加 `renamePath(from, to, options?)` / `renamePrefix(oldDir, newDir)` 供 apps 调用，`ScopedVfsService` 翻译点补 scopeKey）；`RevisionAwareVfsService` 实现 `InternalVfsService` 版本，在 `runInTransactionOrConn` 内调 `renameVfsEntry`/`renameVfsDirectory` 原语；`DefaultVfsService` 的 `renamePath`/`renamePrefix` 抛 unsupported（§D）；`vfs-move.ts` 的 `moveVfsPath(vfs: VfsService, from, to)` 改为优先走 `vfs.renamePath` / `vfs.renamePrefix`（原本拿不到 tx/repo/scopeKey 通道，现在走 VfsService 抽象拿到）；`assertMoveTargetAvailable` 保留。revision/checkpoint 路径变更零操作。

- **Step 8 — phase-move-rename — blocking: yes — qa: auto**：新增 `test/vfs/vfs-rename-primitive.test.ts`：70 文件目录 rename < 100ms（V1）；rename 后新旧 path 不共存；rename 后历史 revision 仍可达（V2、V9）。

- **Step 9 — phase-write-semantics — blocking: yes — qa: auto**：**port 落点**：`VfsRestorePort` 加 `resetHeadToVersion(path, version): Promise<void>`（§B，`ScopedVfsService`/`RevisionAwareVfsService` 已实现，只需 port 声明）；`restore-path.ts` 的 `vfs` 入参类型同时依赖该新方法。`restorePathToRevision` L154 `vfs.write(...)` 改 `vfs.resetHeadToVersion(logicalPath, version)`（deleted 分支 L138-147 保留 delete 调用）；删 L102/L177 `toPhysicalPath`；meta 解析切 entryId。`revision-aware-vfs.service.ts` write/resetHead/delete/hardDelete 全部先取 entryId 再调 revision repo。

- **Step 10 — phase-write-semantics — blocking: yes — qa: auto**：新增 `test/message-checkpoint/restore-path-reset-head.test.ts`：回滚到 checkpoint 后 revision 表行数不变（对比回滚前后 COUNT），文件内容精准恢复。对应 V3、V12（同文短路仍生效）。

- **Step 11 — phase-checkpoint-entry-id — blocking: yes — qa: auto**：`sqlite-message-checkpoint.repository.ts` 全部 SQL `logical_path` → `entry_id`；`insertCheckpoint` 入参改 entry_id；`list-session-files.ts` 删 path 映射按 scope_key 查返 entryId；`message-checkpoint.service.ts` capture 的 `listSessionFileHeads` 移入事务内（L42 `conn.transaction` 起始上移）。

- **Step 12 — phase-checkpoint-entry-id — blocking: yes — qa: auto**：新增 `test/message-checkpoint/checkpoint-capture-transactional.test.ts`：两 capture 并发不捕获陈旧 head（V8）；capture 扫描移入事务后持锁时长在 1000 文件规模下 ≤ 性能基线。

- **Step 13 — phase-rollback-cleanup — blocking: yes — qa: auto**：`resolve-reconcile-paths.ts` 删 `reconcilePairs` 的 `toPhysicalPath` 拼接，保留 set-diff 核心算法，入参改 entryId；`message-rollback.service.ts` `reconcileVfsPaths` 删 path 拼接块，plan 类型改 entry_id 集；`detect-missing-revisions.ts` 删 `toPhysicalPath`；`revision-gc.ts` 可达集按 scope_key+entry_id，`revisionReachableKey` 改 entryId。

- **Step 14 — phase-path-mapper-retire — blocking: no — qa: auto**：revision/checkpoint 链路（`revision-gc.ts`、`resolve-reconcile-paths.ts`、`restore-path.ts`、`detect-missing-revisions.ts`、`list-session-files.ts`、`revision-ref-count.ts`、`resolve-current-workspace-snapshot.ts`、`seed-fork-copy-parity.ts`、`backfill-missing-revision.ts`、`seed-live-head-revisions.ts`、migration `vfs-revision-ref-count-v1.ts`）剩余 `toPhysicalPath`/`toLogicalPath`/`scopePhysicalPrefix` 调用清理。grep 验证以下**全链路 9 个文件**零命中（V7）：`revision-gc.ts`、`resolve-reconcile-paths.ts`、`restore-path.ts`、`detect-missing-revisions.ts`、`list-session-files.ts`、`revision-ref-count.ts`、`message-rollback.service.ts`、`sqlite-vfs-revision.repository.ts`、`sqlite-message-checkpoint.repository.ts`。**保留合法调用**：`vfs-path-mapper.ts` 本体（VFS API 层 `scoped-vfs.service.ts` 仍需它做 logical path 转换）与冻结的 `vfs-revision-ref-count-v1.ts` migration 内部（该 migration 在新库不再跑，属冻结代码）。

- **Step 15 — phase-gc-hardening — blocking: no — qa: auto**：`vfs-tree-copy.ts` `releaseAndDeleteVfsPrefix` 改走新增 `sweepRevisionsUnderScope`（泛化 sweep，支持三 scope）；**承诺式 `ensureBlob(contentHash)`（P1-C）**：`copyVfsTree`/`replaceVfsSubtree`/seed 链路在调 `insertWithContentHash` 之前**必须** `ensureBlob(contentHash)`（不存在则 `contentStore.put` 一份 / 从源 scope 拷贝），不能默认源 blob 一定存在——跨库导入、异常时序、跨 scope 场景下都可能丢 blob，触发器 UPDATE 会命中 0 行导致 ref_count 永久偏低。`template-pull.service.ts` `projectTemplatePull` L41 后补 `runDeferredBlobGc`；`repairRefCounts` 补空闲调度钩子（新 migration 跑完后条件触发）。

- **Step 16 — phase-gc-hardening — blocking: no — qa: auto**：触发器链路验证测试（V5）：revision 行被 sweep 删除 → 对应 blob ref_count 递减 → 归零 blob 行被触发器删除 → 无 orphan blob；`projectTemplatePull` 执行后无 orphan blob（V10）。

- **Step 17 — phase-tests-sync — blocking: yes — qa: auto**：改写受影响测试（H 节清单）：`vfs-move.test.ts`、`vfs-copy.test.ts`、`rollback-reach-hash-batch.test.ts`、`rollback-version-short-circuit.test.ts`、`restore-path.test.ts`、`rollback-ref-count.test.ts`、`revision-gc.test.ts`、`blob-gc.test.ts`、`template-pull.test.ts` 等，凡依赖 path 主键/`revisionPairKey(physical,ver)`/`toPhysicalPath` 构造的断言全改。

- **Step 18 — phase-regression — blocking: yes — qa: auto**：跑 core 全量测试（`npm run test:fast -w @novel-master/core`、`test:vfs`、`test:msg`、`test:perf`）；跑 mobile 受影响测试（`vfs-move-path`、`vfs-file-manager.session.integration`）；核实 cli `countSessionCheckpointPointers` e2e 不坏。

- **Step 19 — phase-manual-qa — blocking: no — qa: manual_user**：mobile 真机验收：旧库升级显示**「升级中」占位 UI（转圈）** → 完成进主界面（V11，不做百分比进度，因 bootstrap 单事务同步无法报回调）；70 文件目录 rename 不卡顿无双目录（V1）；回滚到历史 checkpoint 精准（V3）；desktop 同步验收。

## 测试策略

诶～测试策略分三层。

### 单元/集成测试（core，node:test + 真实 SQLite）

core 测试经 `novelMasterTestFixture()`（in-memory SQLite + 真实 bootstrap），端到端覆盖 DDL + SQL 写路径，不 mock repo。本次 schema 变更会让依赖 path 主键的断言批量变红，需系统性改写。

### 迁移测试（重点）

新增 `vfs-entry-id-migration.test.ts`，参考既有 `vfs-content-blob-migration.test.ts` 结构：
- 旧 schema（path 主键 + version/storage_kind/external_uri 冗余列 + revision 含 path/content/storage_kind）→ 新 schema 可重入
- 100 文件/500 revision/1000 checkpoint 样本数据正确迁移
- entry_id 唯一且自增
- ref_count 初始化正确（= 该 blob 被多少 revision 引用）
- 失败重启续跑（migration id 幂等 + PRAGMA 探测）
- 找不到 entry_id 的 checkpoint 行丢弃并记日志
- 迁移后触发器存在且生效

### 性能测试

新增 `vfs-rename-primitive.test.ts`：70 文件目录 rename < 100ms（V1 硬指标）。参考 `performance.test.ts` 的 P95 × CI slack 模式。

### 三端边界测试

- mobile `vfs-file-manager.session.integration.test.tsx`：已 mock `migrateWorkplaceDirRename`，rename 重做后规则迁移逻辑不变
- cli `countSessionCheckpointPointers` e2e：表重建后 helper 不静默坏

### 测试用例

每条 T 映射到至少一个 Step：

- **T-M1** — blocking: yes — 迁移：旧 schema 100 文件/500 revision 正确迁移到新 schema，entry_id 唯一，ref_count 正确（→ Step 2）
- **T-M2** — blocking: yes — 迁移：失败重启续跑（migration id 幂等）（→ Step 2）
- **T-M3** — blocking: yes — 迁移：找不到 entry_id 的 checkpoint 行丢弃并记 warning（→ Step 2）
- **T-M4** — blocking: yes — 迁移：迁移后 3 个 blob ref_count 触发器存在且 INSERT/DELETE revision 时 blob ref_count ±1（→ Step 2）
- **T-M5** — blocking: yes — 迁移：vfs_entry 无 version/storage_kind/external_uri 列（V6）（→ Step 2）
- **T-R1** — blocking: yes — revision repo：findByEntryAndVersion 等 **11 个方法**按 entry_id 寻址正确（→ Step 4）
- **T-R2** — blocking: yes — revision repo：前缀扫描按 scope_key+pathPrefix，不再 path LIKE（→ Step 4）
- **T-R3** — blocking: yes — revisionPairKey(entryId, version) = `${entryId}:${version}`，消费方 map key 一致（→ Step 4）
- **T-E1** — blocking: yes — entry repo：renamePathInScope 单事务 UPDATE，文件 rename 后 entry_id 不变（→ Step 5）
- **T-E2** — blocking: yes — entry repo：renamePrefixInScope 单事务批量 REPLACE，目录 rename 后所有子文件 entry_id 不变（→ Step 5）
- **T-V1** — blocking: yes — rename 性能：70 文件目录 rename < 100ms（V1）（→ Step 8）
- **T-V2** — blocking: yes — rename 正确性：rename 后新旧 path 不共存于 vfs_entry（V1）（→ Step 8）
- **T-V3** — blocking: yes — rename 历史保留：文件 rename 后所有历史 revision 仍可达（V2、V9）（→ Step 8）
- **T-W1** — blocking: yes — 写语义：回滚到 checkpoint 后 revision 表行数不变（V3）（→ Step 10）
- **T-W2** — blocking: yes — 写语义：同文短路仍生效，不产生冗余 version 行（V12）（→ Step 10）
- **T-C1** — blocking: yes — checkpoint：message_checkpoint_file 存 entry_id，capture/restore 链路正确（→ Step 11）
- **T-C2** — blocking: yes — checkpoint 事务化：两 capture 并发不捕获陈旧 head（V8）（→ Step 12）
- **T-RB1** — blocking: yes — rollback：reconcile set-diff 保留，path 拼接删除，pathsNeedWrite/pathsNeedDelete 按 entry_id（→ Step 13）
- **T-G1** — blocking: no — GC：revision 行被 sweep 删除 → blob ref_count 递减 → 归零 blob 删除（V5）（→ Step 16）
- **T-G2** — blocking: no — GC：projectTemplatePull 后无 orphan blob（V10）（→ Step 16）
- **T-G3** — blocking: no — GC：repairRefCounts 在新 migration 后条件触发跑通（→ Step 15）
- **T-P1** — blocking: yes — path 映射退役：grep `toPhysicalPath|toLogicalPath|scopePhysicalPrefix` 在 `revision-gc.ts`、`resolve-reconcile-paths.ts`、`restore-path.ts`、`detect-missing-revisions.ts`、`list-session-files.ts`、`revision-ref-count.ts`、`message-rollback.service.ts`、`sqlite-vfs-revision.repository.ts`、`sqlite-message-checkpoint.repository.ts` 9 个文件零命中（V7 全链路）；保留 `vfs-path-mapper.ts` 本体与冻结的 `vfs-revision-ref-count-v1.ts` migration 内部调用（→ Step 14）
- **T-T1** — blocking: yes — 回归：core 全量测试通过（→ Step 18）
- **T-U1** — blocking: no — manual_user：mobile 旧库升级**显示「升级中」占位 UI（转圈）** → 完成进主界面（V11）。**不做百分比进度**：`bootstrapNovelMaster` 是单事务同步 await，apps 层拿不到中途进度回调（→ Step 19）
- **T-U2** — blocking: no — manual_user：mobile/desktop 70 文件 rename 不卡顿无双目录（V1）（→ Step 19）

## 风险与回滚方案

### 风险

1. **迁移大库单事务持锁时长**（低风险，**原 OOM 风险降级**）：三表 rebuild + path 关联回填是纯引擎内部 `INSERT...SELECT ... JOIN _migration_path_map`，**数据不进 JS 堆**，所以 revision 行数再多也不会触发 RN/Hermes 的 JS OOM（这跟 `vfs-content-blob-zlib-v1` 当年防 JS OOM 的场景不同）。真正要关注的是：（a）单事务持锁时长——大库迁移会长时间持写锁，需在桌面端 + 移动端实测启动耗时；（b）`_migration_path_map` JOIN 走索引可控（path 列加索引后无需全表扫）。**缓解**：一次性单条 `INSERT...SELECT`，超大库可按表加 `LIMIT N` 分批降低引擎峰值内存（仅峰值优化，不防 JS OOM）；迁移前 apps 层显示「升级中」占位 UI；若实测持锁过长再考虑下一迭代重构 migration runner 突破单事务框架（作为 fallback，本次不做）。

2. **触发器三端行为差异**（中风险）：首次引入触发器，better-sqlite3（desktop）与 op-sqlite/quick-sqlite（mobile）的 `WHEN` 条件子句、FOR EACH ROW、触发器内 UPDATE/DELETE 链式行为需实测。**缓解**：迁移测试 T-M4 覆盖触发器存在性；两端各跑一次 revision INSERT/DELETE 验证 blob ref_count 变化。

3. **测试改写量巨大**（中风险）：core 测试经真实 SQLite+bootstrap，schema 变更让依赖 path 主键/`revisionPairKey(physical,ver)`/`toPhysicalPath` 的断言批量变红。**缓解**：Step 17 专项测试同步，phase 推进时每步跑该 phase 相关测试。

4. **revision.ref_count 与 blob.ref_count 混淆**（低风险）：两者不同层级（revision 可达性 GC vs blob 存储回收），代码评审可能混淆。**缓解**：SPEC 设计决策 §1 已明确；代码注释标注层级。

5. **rename 后 workplace 规则迁移不对称**（低风险）：desktop `handleVfsRename` 漏 `migrateWorkplaceDirRename`，本次不修。**缓解**：文档标记为已知问题；rename 重做后 core 只管 VFS 原子 rename，workplace 规则是 apps 层 UI 状态。

6. **checkpoint capture 移入事务后持锁时长**（低风险）：1000 文件规模下扫描可能增加锁时长。**缓解**：T-C2 覆盖并发；扫描改 scope_key 索引后比 path LIKE 更快。

### 回滚方案

- **迁移不可逆**：SQLite 表重建 migration 无 down。回滚靠 **git revert + 旧库备份**。迁移前 apps 层提示用户（或自动）备份库文件。
- **代码回滚**：若实现阶段发现根本性问题，git revert 所有 phase 提交，回到 `v1.4.11` 状态。旧库未迁移的不受影响（migration id 未 applied）。
- **灰度**：建议先在 desktop（better-sqlite3，触发器行为更可控）验证迁移 + 触发器，再推 mobile（op-sqlite）。

---

## 附录：Context Bundle

```yaml
iteration_name: vfs-version-redesign
requirement_path: .apm/kb/docs/Iterations/vfs-version-redesign/prd.md
spec_path: .apm/kb/docs/Iterations/vfs-version-redesign/spec.md
explore_summary: |
  4 路并行探索覆盖 schema 迁移/数据模型、revision repo/操作语义、checkpoint/rollback/GC、测试约束/三端边界。
  关键发现：四表 DDL 现状摸清；迁移框架 id-based 单事务内 apply；触发器全仓零先例；
  revision repo 11 方法（不是 13）全部按 path 寻址；revisionPairKey = path:version（6 src + 2 测试）；
  move 逐文件非原子 70 文件 140+ 事务；checkpoint capture 事务外扫描；
  vfs-tree-copy 裸调无 migration 分支；projectTemplatePull 缺 GC；repairRefCounts 生产零调用；
  三端零 raw SQL（cli test helper 例外不引 logical_path）；desktop rename 漏规则迁移（已知不对称）。
impact_files:
  - packages/core/src/bootstrap/vfs/{vfs-schema,vfs-revision-schema,vfs-content-blob-schema}.ts
  - packages/core/src/bootstrap/message-checkpoint/message-checkpoint-schema.ts
  - packages/core/src/bootstrap/novel-master-bootstrap.ts
  - packages/core/src/bootstrap/schema-migrations/index.ts
  - packages/core/src/bootstrap/schema-migrations/vfs-entry-id-redesign-v1.ts (新增)
  - packages/core/src/domain/vfs/model/{vfs-entry,vfs-revision}.ts
  - packages/core/src/domain/vfs/repositories/{vfs-entry,vfs-revision}.port.ts
  - packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-{entry,revision}.repository.ts
  - packages/core/src/domain/vfs/logic/{vfs-move,revision-pair-key,revision-ref-count,vfs-path-mapper,vfs-tree-copy}.ts
  - packages/core/src/domain/vfs/logic/{vfs-rename-primitive,infer-scope-from-path}.ts (新增)
  - packages/core/src/domain/message-checkpoint/{model,repositories,logic}/**
  - packages/core/src/service/{message-checkpoint,template}/**
  - packages/core/src/service/vfs/impl/{scoped-vfs,revision-aware-vfs,default-vfs}.service.ts
  - packages/core/src/service/vfs/internal-vfs.port.ts (新增, P0-A scopeKey 通道)
  - packages/core/test/{vfs,message-checkpoint,workplace}/**
constraints:
  - migration 单事务内 apply（不突破框架）
  - 触发器同时进 canonical DDL + migration
  - revision.ref_count（应用层，revision GC）与 blob.ref_count（触发器，blob GC）并存不同层级
  - canonical DDL 与 migration 两边同步是开发者责任
  - core 测试经真实 SQLite+bootstrap 不 mock，schema 变更批量变红
  - 三端 apps 层零改动（API 契约不变）
  - P0-A：scopeKey 必须经 `InternalVfsService` 从 `ScopedVfsService` 一路透传到 entry repo 所有点查询，不能在中间层丢掉；`vfs-tree-copy` 源/目标侧分别用 fromScope/toScope
  - P0-B：迁移必须先 ALTER `vfs_content_blob.ref_count`（Step 5b）才能跑 Step 6 UPDATE；触发器创建同样依赖此列
blocking_steps: [1,2,3,4,5,5a,5b,6,7,8,9,10,11,12,13,17,18]
```
