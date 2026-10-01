/**
 * VFS revision SQLite DDL (append-only file history).
 *
 * entry_id 化后 revision 改用 `(entry_id, version)` 复合主键寻址，旧的 `path`
 * / `content`（明文，已迁 blob）/ `storage_kind`（恒 inline）三列退役。同时挂上
 * 3 个触发器在 revision INSERT/DELETE/UPDATE 时维护 `vfs_content_blob.ref_count`，
 * 用于 blob 存储回收（归零自动删 blob 行）。
 *
 * @module bootstrap/vfs/vfs-revision-schema
 */

/** Creates vfs_revision table if missing (entry_id 主键形态，WITHOUT ROWID + 约束).
 *
 * 决策 4：切 WITHOUT ROWID 后生产代码里的 deleteUnreferencedUnderScope 已改用
 * `(entry_id, version) IN (...)` 复合 PK 寻址，不再依赖 rowid。 */
export const VFS_REVISION_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS vfs_revision (
  entry_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  mtime_ms INTEGER NOT NULL,
  content_hash TEXT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
  PRIMARY KEY (entry_id, version),
  CHECK (NOT (status = 'active' AND content_hash IS NULL))
) WITHOUT ROWID`.trim();

/** entry_id 查询索引，用于 revision GC / restore / scope 扫描。 */
export const VFS_REVISION_ENTRY_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_vfs_revision_entry
  ON vfs_revision(entry_id)`.trim();

/** revision INSERT 时，对非 NULL content_hash 的 blob ref_count + 1。 */
export const VFS_REVISION_INSERT_TRIGGER_DDL = `
CREATE TRIGGER IF NOT EXISTS trg_revision_insert_inc_blob_ref
AFTER INSERT ON vfs_revision
WHEN NEW.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash;
END`.trim();

/**
 * revision DELETE 时 -1 并在归零时删 blob —— **带 vfs_entry 守卫**（`_v2`）。
 *
 * 守卫必要：`vfs_content_blob.ref_count` 只由 revision 触发器维护，而
 * `vfs_entry.content_hash` 这一路引用对触发器完全不可见。只要存在「entry 有
 * content_hash 但没有对应 revision 行」的状态（批量 ingest 绕开 revision 层时
 * 会造出这种「悬空 head」），该 blob 的 ref_count 就常年为 0；此时任何一条
 * 引用同 hash 的 revision 被删，无守卫的归零判定就把 blob 行删掉 ⇒ 共享该
 * hash 的另一条 entry `read` 抛「vfs_content_blob 缺失」，**文件永久不可读**。
 * 内容寻址让同 hash 共享极可能（实测去重省 61.3%）。
 *
 * 方向是**保守**的（宁可留垃圾不可丢数据）：entry 还引用着就不删。
 */
export const VFS_REVISION_DELETE_TRIGGER_DDL = `
CREATE TRIGGER trg_revision_delete_dec_blob_ref_v2
AFTER DELETE ON vfs_revision
WHEN OLD.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob
  SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash;
  DELETE FROM vfs_content_blob
  WHERE content_hash = OLD.content_hash AND ref_count <= 0
    AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
END`.trim();

/**
 * revision UPDATE content_hash 变更时，旧 hash -1 新 hash +1（防御性触发器）。
 *
 * ⚠️ 归零删除**必须带同款守卫**：`UPDATE OF content_hash` 时旧 hash 走的是
 * **这段** DELETE，DELETE 触发器在这条路径上根本不会被触发 ⇒ 「DELETE 触发器
 * 同款兜底」的推理不成立。`WHEN OLD.content_hash IS NOT NEW.content_hash`
 * 这一句本身就是逐字节同款缺陷（`IS NOT` 与 `!=` 等价），一并修掉。
 */
export const VFS_REVISION_UPDATE_TRIGGER_DDL = `
CREATE TRIGGER trg_revision_update_transfer_blob_ref_v2
AFTER UPDATE OF content_hash ON vfs_revision
WHEN OLD.content_hash IS NOT NEW.content_hash
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash AND OLD.content_hash IS NOT NULL;
  DELETE FROM vfs_content_blob
  WHERE content_hash = OLD.content_hash AND ref_count <= 0 AND OLD.content_hash IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash AND NEW.content_hash IS NOT NULL;
END`.trim();

/** 归零删除的守卫子串（bootstrap 对齐段与测试用它判定「新触发器已生效」）。 */
export const VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT =
  "NOT EXISTS (SELECT 1 FROM vfs_entry";

/** 两个 blob 归零触发器的**新名**（含版本后缀）。 */
export const VFS_BLOB_GC_TRIGGER_NAMES_V2 = [
  "trg_revision_delete_dec_blob_ref_v2",
  "trg_revision_update_transfer_blob_ref_v2",
] as const;

/**
 * 两个 blob 归零触发器的**旧名**。
 *
 * ⚠️ 存量库里旧名**仍注册着、仍在每次 `DELETE FROM vfs_revision` 时触发**，
 * 照样执行没有守卫的归零删除。SQLite 的触发器不是「代码不再引用就不存在」
 * 的东西 ⇒ 光 `CREATE <新名>` 不够：那样新旧两条会**同时注册**、同一次
 * DELETE 归零两次，旧那条照样把 blob 删掉。必须先显式 DROP 旧名。
 */
export const VFS_BLOB_GC_TRIGGER_LEGACY_NAMES = [
  "trg_revision_delete_dec_blob_ref",
  "trg_revision_update_transfer_blob_ref",
] as const;

/**
 * blob 归零触发器的 DROP 前缀语句（CS-07 存量库生效机制·子动作一）。
 *
 * ⚠️ **「建了新名」不等于「旧名失效」**——这是本条唯一能拦住 P0 的牙齿。
 * 与修法「指纹比对 `sqlite_master` 后按需重建」相比，这里取的是**更廉价、
 * 不可能漏**的等价手法：旧名无条件 DROP + 新名无条件重建（CREATE 前也先
 * DROP 幂等），宁可每次慢路径多重建两次（纯 DDL、零数据搬运、完全幂等），
 * 也不做「改了触发器却判成没改」的比对。
 *
 * 另一条不可省的配套动作是 **bump `SCHEMA_BOOT_VERSION`**：本组语句与
 * `alignSchemaColumns` 同在慢路径，而 `bootVersion >= SCHEMA_BOOT_VERSION`
 * 的存量库会在快路径直接 return ⇒ 不 bump 的话这组语句永远补不上。
 */
export const VFS_BLOB_GC_TRIGGER_DROP_STATEMENTS: readonly string[] = [
  ...VFS_BLOB_GC_TRIGGER_LEGACY_NAMES.map(
    (name) => `DROP TRIGGER IF EXISTS ${name};`
  ),
  ...VFS_BLOB_GC_TRIGGER_NAMES_V2.map(
    (name) => `DROP TRIGGER IF EXISTS ${name};`
  ),
];

/** All vfs_revision bootstrap statements in execution order.
 *
 * 触发器 DDL 历史上不在此数组——旧库在跑更早的 zlib migration 时 `vfs_revision` 尚无
 * `content_hash` 列、`vfs_content_blob` 尚无 `ref_count` 列，schema 变更重编译触发器会撞
 * `no such column`，故曾由 `vfs-entry-id-redesign-v1` migration 统一创建。该 migration 已
 * 随第二轮退役（最低支持 v1.4.27）删除，更早的 zlib migration 也不存在了：受支持的库
 * 从建库起就具备两列，触发器直接并入 canonical DDL（SQLite 对触发体内的表/列引用
 * 延迟解析，CREATE 阶段不校验，实测前向引用与缺列形态均安全）。
 *
 * ⚠️ blob 归零两个触发器前面挂着 {@link VFS_BLOB_GC_TRIGGER_DROP_STATEMENTS}
 * （CS-07）：`CREATE TRIGGER IF NOT EXISTS` 对存量库**不重建**已存在的同名触发器，
 * 而只补 `CREATE <新名>` 又会让新旧两条同时注册。每条语句是**单语句**——
 * `NOVEL_MASTER_SCHEMA_STATEMENTS` 逐条 `tx.execute`，不合并多语句。 */
export const VFS_REVISION_SCHEMA_STATEMENTS: readonly string[] = [
  VFS_REVISION_TABLE_DDL,
  VFS_REVISION_INSERT_TRIGGER_DDL,
  ...VFS_BLOB_GC_TRIGGER_DROP_STATEMENTS,
  VFS_REVISION_DELETE_TRIGGER_DDL,
  VFS_REVISION_UPDATE_TRIGGER_DDL,
];
