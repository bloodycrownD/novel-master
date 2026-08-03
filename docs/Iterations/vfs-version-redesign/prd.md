---
date: 2026-07-29
dependency: [Iterations/vfs-revision-storage-optimize/prd.md, Iterations/vfs-move-and-frontmatter-bugfix/prd.md]
---

# VFS 版本管理重设计 PRD

## 背景

当前 VFS 版本管理的核心病灶在于 `path` 同时承担了三重职责：文件身份标识、目录层级表达、scope 归属前缀。这三重职责耦合在一起，牵一发动全身。

具体表现：

- **rename 性能灾难**：目录改名时，因为 path 是 `vfs_entry` 主键，rename 只能走「write 新路径 + delete 旧路径」。`moveVfsDirectory` 对目录下每个文件逐个执行 `read → write → delete`，每个文件两次独立事务（revision-aware 层各包一层事务），70 个文件实测耗时 20 秒。期间 vfs 中同时存在新旧两份，UI 是 async 的不阻塞，用户导航时的 reload 恰好读到中间态，表现为「A 和 B 同时出现」。

- **历史版本与路径死绑**：`vfs_revision` 主键是 `(path, version)`，`message_checkpoint_file` 存 `(logical_path, revision_version)`。文件改名后，旧 path 的历史版本留在 revision 表里，checkpoint 记录的也是旧 path。回滚时 path 对不上，`message-rollback.service.ts` 不得不写大量路径对齐补偿逻辑（`reconcileVfsPaths`、`resolveReconcilePathSets`）。

- **写路径语义不一致**：普通 `write` 走 append 新 revision + bump version（前进）；`resetHeadToVersion` 直接拨回历史，不 append 不 bump（后退）；rollback 的 `restorePathToRevision` 又走 write，会 append 新 revision。结果回滚一次操作版本链反而变长，语义混乱。

- **GC 缺口**：blob GC 每次全表扫 `vfs_entry ∪ vfs_revision` 收集 content_hash 引用集，库一大就慢；`repairRefCounts` 是空挂 API（生产零调用）；`vfs-tree-copy.ts` 裸调 `deleteUnreferencedUnderPrefix` 无 migration 分支保护；`projectTemplatePull` 缺 blob GC 调度。

- **scope 编码耦合在 path 里**：物理路径形如 `/projects/{pid}/sessions/{sid}/原著/第01部/(01).md`，scope 前缀、目录层级、文件名全混在一根字符串里。每次 checkpoint capture/restore 都要 `toPhysicalPath`/`toLogicalPath` 做双向转换。

这些问题的共同根源是 path 承担了过多职责。本次重设计引入不可变的 `entry_id` 作为文件身份键，让 path 降级为可变的属性列，从根本上解开这个耦合。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| rename/move 性能根治 | 70 文件目录改名从 20s 降至 < 100ms，单事务原子完成 |
| 历史版本不随路径丢失 | 文件改名/移动后，所有历史 revision 仍可达，checkpoint 回滚不报路径不匹配 |
| 写路径语义统一 | 回滚走 resetHead 语义（不 append 新 revision），版本链不再因回滚而增长 |
| blob GC 即时回收 | revision 行删除时 blob 引用计数同步递减、归零即删，不再全表扫 |
| scope 与 path 解耦 | path 列只存纯逻辑路径，scope 独立成列，checkpoint 链路零次 path 映射 |
| 补偿逻辑大幅清理 | revision/checkpoint 链路中 `toPhysicalPath`/`toLogicalPath` 调用全部删除（约 15 处） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile / Desktop 文件管理用户 | 在 VFS 文件管理器里对目录进行重命名、移动、删除，期望操作即时完成、不卡顿、不留幽灵目录 |
| 多版本写作用户 | 频繁编辑文件后想回滚到某个消息节点，期望回滚精准、不因路径变更而失败 |
| 会话管理用户 | 创建/复制/删除会话（涉及 session worktree 复制），期望不因 revision 路径映射断裂而异常 |
| 模板拉取用户 | session/project 模板拉取替换工作区子树，期望 revision 和 blob 正确清理不泄漏 |
| 导入导出用户 | ZIP 导入、角色卡导入、批量文件操作，期望 revision 正确种入、不残留旧前缀 |

## 范围

### 包含范围

- `vfs_entry` 引入 `entry_id`（INTEGER AUTOINCREMENT）作为主键，path 降级为普通列
- `vfs_revision` 主键改为 `(entry_id, version)`，删除 path 列
- `message_checkpoint_file` 改存 `entry_id`，删除 `logical_path` 列
- `vfs_content_blob` 增加 `ref_count` 列，通过数据库触发器在 revision 行增删时自动维护
- scope 从 path 编码剥离，`vfs_entry` 增加 `scope_key` 独立列，path 存纯逻辑路径
- `vfs_entry` 删除冗余字段：`version`（与 head_version 永远同步）、`storage_kind`（永远 inline）、`external_uri`（永远 NULL）
- move/rename 重做为 repository 层批量路径更新原语（单事务 UPDATE 前缀）
- 写路径语义统一：回滚走 resetHead 语义，`restorePathToRevision` 不再 append 新 revision
- checkpoint capture 扫描移入事务内
- 补偿逻辑清理：revision/checkpoint 链路删除所有 `toPhysicalPath`/`toLogicalPath` 调用
- `repairRefCounts` 补空闲调度钩子
- `vfs-tree-copy.ts` 裸调 `deleteUnreferencedUnderPrefix` 修复（走统一 sweep 路径或 migration 分支）
- `projectTemplatePull` 补 blob GC 调度
- 一次性离线迁移（表重建模式），app 启动时执行，带进度提示

### 不包含范围

- TDBC driver 层的真正 array binding（quick-sqlite 的批量写入优化），作为独立后续迭代
- VFS 文件管理器 UI 的 reload 合并优化（scope 级 invalidate → 一次 refresh 的 snapshot 服务），作为独立后续迭代
- 跨库合并、跨设备同步相关的 UUID 需求（当前无此场景）
- path 变更审计日志（如需要后续单独加 `vfs_entry_event` 表）

## 核心需求

### 1. entry_id 身份键改造

`vfs_entry` 新增 `entry_id INTEGER PRIMARY KEY AUTOINCREMENT`。文件一旦创建，entry_id 终身不变，无论后续如何改名、移动。path 变为普通可变列，带 `UNIQUE(scope_key, path)` 约束保证同 scope 内路径唯一。

revision 和 checkpoint 全部改为认 entry_id：`vfs_revision` 主键 `(entry_id, version)`，`message_checkpoint_file` 存 `entry_id`。文件改名后 entry_id 不变，历史版本和 checkpoint 指针天然跟随。

### 2. scope 与 path 解耦

`vfs_entry` 新增 `scope_key TEXT NOT NULL` 列（取值如 `project:{pid}`、`session:{pid}:{sid}`）。path 列只存纯逻辑路径（如 `/原著/第01部/(01).md`），不再编码 scope 前缀。

目录树查询改为 `WHERE scope_key = ? AND (path = ? OR path LIKE ?)`，按 scope 隔离。`vfs-path-mapper.ts` 的 `toPhysicalPath`/`toLogicalPath`/`scopePhysicalPrefix` 在 revision/checkpoint 语境中全部退役（文件本身是否保留取决于 vfs-entry API 层是否仍接受 logical path 输入）。

### 3. blob ref_count 与触发器

`vfs_content_blob` 新增 `ref_count INTEGER NOT NULL DEFAULT 0`。

维护策略采用数据库触发器：revision 行 INSERT 时，对对应 content_hash 的 blob `ref_count + 1`（content_hash 为 NULL 的 deleted revision 不触发）；revision 行 DELETE 时，对对应 content_hash 的 blob `ref_count - 1`，归零则自动 DELETE blob 行。

应用层不再手动维护 blob 引用计数，当前 13 处 revision 写删点（write/delete/resetHead/seed/checkpoint ±ref 等）无需新增 blob 操作。blob GC 从全表扫描退化为 O(0) 的触发器即时回收，`runDeferredBlobGc` 降级为安全网/修复工具。

### 4. move/rename 重做

删除 `moveVfsDirectory` 的逐文件 `read → write → delete` 循环。新增 repository 层「路径重命名原语」：

- 文件 rename：单事务内 `UPDATE vfs_entry SET path = ? WHERE entry_id = ?`
- 目录 rename：单事务内 `UPDATE vfs_entry SET path = REPLACE(path, ? || '/', ? || '/') WHERE scope_key = ? AND (path = ? OR path LIKE ? || '/%')`

revision 和 checkpoint 因认 entry_id，路径变更时零操作。move 从 O(N 文件 × N 事务) 降为 O(1) SQL。

### 5. 写路径语义统一

三套写路径收敛为两种语义：

- **前进（write）**：内容变更时 append 新 active revision + head_version bump。同文短路保留（内容全等不 bump 不 append）。
- **后退（resetHead / restore）**：回滚到历史版本时直接拨回 head，不 append 新 revision。`restorePathToRevision` 从走 write 改为走 resetHead 语义。

版本链走向干净：前进增加版本，后退只是移动 head 指针，回滚不再让版本链增长。

### 6. checkpoint capture 事务化

`DefaultMessageCheckpointService.capture` 的 `listSessionFileHeads` 扫描从事务外移入事务内。改成 entry_id 后扫描更轻量（不涉及 path 映射），消除「单写 desktop 可接受」的并发妥协。

### 7. 补偿逻辑与冗余清理

**可整体删除**：

- `revision-ref-count.ts` 中 `toPhysicalPointers` 及其在 checkpoint 链路的全部调用
- revision/checkpoint 语境中约 15 处 `toPhysicalPath`/`toLogicalPath`/`scopePhysicalPrefix` 调用
- `message-rollback.service.ts` 中 `reconcileVfsPaths` 与 `resolveReconcilePathSets` 重复的 path 拼接块
- `SqliteVfsRevisionRepository` 所有 `path LIKE` 前缀扫描，改为 `WHERE entry_id = ?`
- `revisionPairKey` 从 `path:version` 改为 `entryId:version`

**需重写但保留核心算法**：

- ref_count 维护逻辑（`adjustRef`/`transferLiveRef` 等）：改入参从 path 到 entry_id
- reconcile set-diff 逻辑（`pathsNeedWrite`/`pathsNeedDelete` 计算）：路径对齐删除，set-diff 保留
- `restorePathToRevision` 的内容回放逻辑：改走 resetHead 语义
- `sweepSessionRevisions` 的可达集计算：按 scope_key + entry_id 查询

### 8. GC 与一致性补全

- `repairRefCounts`：补空闲调度钩子，在 bootstrap 完成后或 session 切换时跑一次（core 内调度，不推给 apps）
- `vfs-tree-copy.ts` 的 `releaseAndDeleteVfsPrefix`：裸调 `deleteUnreferencedUnderPrefix` 改走统一 sweep 路径，或让 `deleteUnreferencedUnderPrefix` 内部包含 migration 分支判断
- `projectTemplatePull`：补 `runDeferredBlobGc` 调度（对齐 `sessionTemplatePull`）
- 保持已闭合缺陷（B-1 hardDelete recursive adjustRef、B-2 adjustRefCount 缺失行抛 NOT_FOUND）的修复

### 9. 一次性离线迁移

新建一条 schema migration，走表重建模式（SQLite 不支持 DROP COLUMN）：

1. 建 `_new` 表（新 schema 形态）
2. `INSERT...SELECT` 拷贝数据：从旧 `vfs_entry.path` 解析 scope_key + 纯逻辑路径，生成 entry_id
3. 从旧 `vfs_revision.path` 反查 entry_id，拷贝到新表 `(entry_id, version)`
4. 从旧 `message_checkpoint_file.logical_path` 反查 entry_id，拷贝到新表
5. 拷贝 `vfs_content_blob` 并初始化 ref_count（全表扫统计）
6. DROP 旧表 + RENAME 新表 + 重建索引与触发器

由于数据回填可能较重（三张表 path 关联），采用「事务内 schema 改造 + 事务外分批数据回填」的拆分模式（参考 `vfs-content-blob-zlib-v1`）。app 启动时检测旧 schema，显示迁移进度，完成后进入主界面。mobile/desktop 共用同一 bootstrap 路径，零改动。

canonical DDL（`NOVEL_MASTER_SCHEMA_STATEMENTS`）同步更新为新形态，保证新库直接建出最终结构。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| V1 | 旧库有含 70 文件的目录 `/原著2` | 升级后对该目录执行 rename 为 `/原著` | 完成耗时 < 100ms；vfs_entry 路径全部更新；新旧两份不共存 |
| V2 | 文件 `/a.md` 有 5 个历史版本 | 升级后将其 rename 为 `/b.md` | 5 个历史 revision 仍可达（按 entry_id 查询）；checkpoint 指针不失效 |
| V3 | session 有 3 个消息 checkpoint | 升级后回滚到第 1 个 checkpoint | 文件内容精准恢复；revision 表不新增 append 行（对比回滚前后行数） |
| V4 | 旧库有 100 个文件、500 条 revision | 执行离线迁移 | 所有数据正确迁移；entry_id 唯一；ref_count 统计正确；迁移可重入（失败重启能续跑） |
| V5 | revision 行被 GC 删除（ref_count 归零） | sweepSessionRevisions 执行后 | 对应 blob 的 ref_count 递减；归零的 blob 行被触发器删除；不残留 orphan blob |
| V6 | 旧库 `vfs_entry` 有 version/storage_kind/external_uri 列 | 执行迁移 | 新表无这三列；所有文件功能正常 |
| V7 | revision/checkpoint 链路代码 | grep `toPhysicalPath\|toLogicalPath` | 在 revision-repo、checkpoint-repo、rollback-service、revision-ref-count、revision-gc、resolve-reconcile-paths、restore-path、detect-missing-revisions、list-session-files 中零命中（`vfs-path-mapper.ts` 本体与 VFS API 层 `scoped-vfs` 的合法调用不在禁令范围） |
| V8 | checkpoint capture 并发执行 | 两个 capture 同时跑 | 扫描在事务内，不捕获陈旧 head |
| V9 | path 变更（rename/move）后 | 查询该文件历史 | 历史完整；无 revision 行因路径变更而失效 |
| V10 | `projectTemplatePull` 执行后 | 检查 blob | 无 orphan blob 残留（runDeferredBlobGc 已调用） |
| V11 | mobile/desktop 启动 | 数据库为旧 schema | 显示迁移进度；完成后正常进入主界面；重启后不重复迁移 |
| V12 | 同内容文件多次写入 | 检查 revision 表 | 同文短路仍生效，不产生冗余版本行 |
