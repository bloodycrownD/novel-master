/**
 * VFS SQLite DDL statements (idempotent).
 *
 * entry_id 化后 `vfs_entry` 以不可变 `entry_id` 作主键，`scope_key` + `path` 共同
 * 唯一约束；旧 schema 的 `version`（与 head_version 永远同步）、`storage_kind`
 * （恒 inline）、`external_uri`（恒 NULL）三列退役。`content TEXT NULL` 保留
 * （§A：暂不删该列，数据模型终态图保留它）。
 *
 * @module bootstrap/vfs/vfs-schema
 */

/** 若不存在则创建 vfs_entry 表（entry_id 主键形态，entry_kind CHECK）. */
export const VFS_ENTRY_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_entry (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NULL,
  head_version INTEGER NOT NULL DEFAULT 1,
  mtime_ms INTEGER NOT NULL,
  entry_kind TEXT NOT NULL DEFAULT 'file' CHECK (entry_kind IN ('file', 'directory')),
  content TEXT NULL,
  UNIQUE(scope_key, path)
)`.trim();

/** scope_key + path 复合索引，用于 scope 内前缀扫描。 */
export const VFS_ENTRY_SCOPE_PATH_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_vfs_entry_scope_path
  ON vfs_entry(scope_key, path)`.trim();

/**
 * content_hash 索引：打包候选谓词的 `NOT EXISTS (vfs_entry.content_hash)` 反查
 * 与 head 引用判定用。
 *
 * @remarks 真库形态实测：候选谓词整条 126–141ms → 加索引后 67–76ms（vfs_entry
 * 全表扫在谓词每行上重复发生，是主耗时项）；合成 2 万 revision / 5 千 entry
 * 规模从 8.9s → 0.37s。写放大可忽略（entry 行数远小于 revision）。
 *
 * **索引语句不在本文件**：`idx_vfs_entry_content_hash` 的 canonical DDL 单源于
 * `vfs-revision-schema.ts` 的同名导出——repo-mega-cr 合并时统一为**部分索引**
 * 形态（`WHERE content_hash IS NOT NULL`，目录条目恒 NULL 不入索引），是
 * blob 归零触发器守卫的 EXPLAIN 断言（vfs-gc-trigger.test.ts）钉死的形态；
 * 打包候选谓词的反查同样走它。v1.5.30 已发布的库若已建成裸（非部分）索引，
 * `IF NOT EXISTS` 幂等跳过、保留裸索引——功能上是超集，兼容不改。
 */

/** All bootstrap statements in execution order.
 *
 * 注意：`scope_key` / `entry_id` 上的具名索引不在此数组内——`UNIQUE(scope_key, path)`
 * 的隐式索引已覆盖前缀扫描需求，其余具名索引曾被视为纯写放大而不再建出
 * （历史上由 vfs-entry-id-redesign-v1 的 rebuildIndexes 统一管理，该函数为刻意空实现，
 * migration 已随第二轮退役删除）；content_hash 索引是打包谓词实测定案的例外。 */
export const VFS_SCHEMA_STATEMENTS: readonly string[] = [
  VFS_ENTRY_TABLE_DDL,
];
