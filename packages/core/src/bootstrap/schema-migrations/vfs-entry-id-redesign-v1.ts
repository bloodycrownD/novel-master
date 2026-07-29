/**
 * vfs-entry-id-redesign-v1：entry_id 化三表 rebuild + blob ref_count + 触发器。
 *
 * 把 VFS 版本管理从「path 作身份键」重设计为「不可变 `entry_id` 作身份键、path 降级
 * 为可变属性列、scope 独立成列」。具体覆盖 `vfs_entry` / `vfs_revision` /
 * `message_checkpoint_file` 三张表的表重建（SQLite 不支持 DROP COLUMN，只能 rebuild），
 * 顺手给 `vfs_content_blob` 补 `ref_count` 列并初始化为「被多少条 revision 引用」，
 * 最后挂上 3 个 blob ref_count 维护触发器。
 *
 * 幂等保护：开头用 `PRAGMA table_info(vfs_entry)` 探测是否已是 entry_id 主键形态，
 * 已迁移则整个 `up` 直接 return。靠这个探测 + migration runner 的 id-based 幂等双重保险。
 *
 * @module bootstrap/schema-migrations/vfs-entry-id-redesign-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { inferScopeFromPhysicalPath } from "@/domain/vfs/logic/infer-scope-from-path.js";
import {
  VFS_REVISION_INSERT_TRIGGER_DDL,
  VFS_REVISION_DELETE_TRIGGER_DDL,
  VFS_REVISION_UPDATE_TRIGGER_DDL,
} from "../vfs/vfs-revision-schema.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const VFS_ENTRY_ID_REDESIGN_V1_ID = "vfs-entry-id-redesign-v1";

/** PRAGMA table_info 行的最小投影。 */
type PragmaColumnInfo = { name: string; pk: number };

async function getTableColumnInfo(
  tx: TdbcConnection,
  table: string,
): Promise<PragmaColumnInfo[]> {
  const rows = await tx.query<{ name: string; pk: number }>(
    `PRAGMA table_info(${table})`,
  );
  return rows.map((row) => ({
    name: String(row.name),
    pk: Number(row.pk ?? 0),
  }));
}

async function columnNames(
  tx: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const cols = await getTableColumnInfo(tx, table);
  return new Set(cols.map((c) => c.name));
}

/**
 * 判断 vfs_entry 是否已是 entry_id 主键形态（即本 migration 是否已 apply）。
 *
 * 旧形态 pk 是 `path`（pk=1 在 path 行）；新形态 pk 是 `entry_id`，且必有 `scope_key`
 * 列、无 `storage_kind` 列。这里用「存在 entry_id 列且它是 pk」作为判据最稳妥。
 */
async function isEntryIdForm(tx: TdbcConnection): Promise<boolean> {
  const cols = await getTableColumnInfo(tx, "vfs_entry");
  if (cols.length === 0) {
    // 表不存在（理论不该发生，bootstrap 已跑过 DDL），保守按已迁移处理。
    return true;
  }
  const entryId = cols.find((c) => c.name === "entry_id");
  return entryId != null && entryId.pk > 0;
}

/** Step 5b：探测式给 vfs_content_blob 补 ref_count 列（必须在 Step 6 UPDATE 之前）。 */
async function ensureBlobRefCountColumn(tx: TdbcConnection): Promise<void> {
  // vfs_content_blob 在更早的 vfs-content-blob-zlib-v1 migration 中已建好，
  // 这里只是双保险——万一有库跳过了那条 migration 直接进本条。
  await tx.execute(`
    CREATE TABLE IF NOT EXISTS vfs_content_blob (
      content_hash TEXT PRIMARY KEY,
      encoding TEXT NOT NULL,
      bytes BLOB NOT NULL,
      byte_len INTEGER NOT NULL
    )
  `);
  const cols = await columnNames(tx, "vfs_content_blob");
  if (!cols.has("ref_count")) {
    await tx.execute(
      `ALTER TABLE vfs_content_blob ADD COLUMN ref_count INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

/** Step 2：建三张 _new 表（新 schema 形态，此时不带触发器，触发器最后建）。 */
async function createNewTables(tx: TdbcConnection): Promise<void> {
  await tx.execute(`
    CREATE TABLE vfs_entry_new (
      entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT NULL,
      head_version INTEGER NOT NULL DEFAULT 1,
      mtime_ms INTEGER NOT NULL,
      entry_kind TEXT NOT NULL DEFAULT 'file',
      content TEXT NULL,
      UNIQUE(scope_key, path)
    )
  `);
  await tx.execute(`
    CREATE TABLE vfs_revision_new (
      entry_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      content_hash TEXT NULL,
      ref_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (entry_id, version)
    )
  `);
  await tx.execute(`
    CREATE TABLE message_checkpoint_file_new (
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      entry_id INTEGER NOT NULL,
      revision_version INTEGER NOT NULL,
      PRIMARY KEY (session_id, message_id, entry_id)
    )
  `);
  // 旧物理 path → 新 entry_id 的临时映射表，供 revision/checkpoint 回填反查。
  await tx.execute(`
    CREATE TABLE _migration_path_map (
      path TEXT PRIMARY KEY,
      entry_id INTEGER NOT NULL
    )
  `);
}

/**
 * Step 3：回填 vfs_entry。
 *
 * 这里走 JS 循环 + `inferScopeFromPhysicalPath`，因为 scope_key 的反解需要正则匹配
 * （SQLite 内置字符串函数做不了「先判 sessions 再判 template」这种顺序敏感的分支）。
 * 只把 path（短字符串）拉进 JS 堆，正文 content_hash 是哈希值也不大；真正的大字段
 * content 列虽被 SELECT 拉进来，但在新表里仍写回（保留该列），不进 contentStore。
 */
async function backfillVfsEntry(tx: TdbcConnection): Promise<void> {
  const hasContent = await columnNames(tx, "vfs_entry").then((s) =>
    s.has("content"),
  );
  const entries = await tx.query<{
    path: string;
    content_hash: string | null;
    head_version: number;
    mtime_ms: number;
    entry_kind: string;
    content: string | null;
  }>(
    `SELECT path, content_hash, head_version, mtime_ms, entry_kind${
      hasContent ? ", content" : ""
    } FROM vfs_entry`,
  );

  for (const row of entries) {
    const { scopeKey, logicalPath } = inferScopeFromPhysicalPath(
      String(row.path),
    );
    await tx.execute(
      `INSERT INTO vfs_entry_new
         (scope_key, path, content_hash, head_version, mtime_ms, entry_kind${
           hasContent ? ", content" : ""
         })
       VALUES (?, ?, ?, ?, ?, ?${hasContent ? ", ?" : ""})`,
      hasContent
        ? [
            scopeKey,
            logicalPath,
            row.content_hash,
            Number(row.head_version),
            Number(row.mtime_ms),
            String(row.entry_kind),
            row.content,
          ]
        : [
            scopeKey,
            logicalPath,
            row.content_hash,
            Number(row.head_version),
            Number(row.mtime_ms),
            String(row.entry_kind),
          ],
    );
    // 取 AUTOINCREMENT 生成的 entry_id，写回 path→entry_id 映射（key 是旧物理 path）。
    const lastIdRows = await tx.query<{ id: number }>(
      `SELECT last_insert_rowid() AS id`,
    );
    const entryId = Number(lastIdRows[0]?.id);
    await tx.execute(
      `INSERT INTO _migration_path_map (path, entry_id) VALUES (?, ?)`,
      [String(row.path), entryId],
    );
  }
}

/** Step 4：回填 vfs_revision（一次性 INSERT...SELECT，纯引擎内部 JOIN）。 */
async function backfillVfsRevision(tx: TdbcConnection): Promise<void> {
  const hasRefCount = await columnNames(tx, "vfs_revision").then((s) =>
    s.has("ref_count"),
  );
  await tx.execute(`
    INSERT INTO vfs_revision_new
      (entry_id, version, status, mtime_ms, content_hash${
        hasRefCount ? ", ref_count" : ""
      })
    SELECT m.entry_id, r.version, r.status, r.mtime_ms, r.content_hash${
      hasRefCount ? ", r.ref_count" : ""
    }
    FROM vfs_revision r
    JOIN _migration_path_map m ON m.path = r.path
  `);
}

/**
 * Step 5：回填 message_checkpoint_file。
 *
 * 用 SQL 字符串拼接还原旧物理 path（`/projects/{pid}/sessions/{sid}{logical_path}`），
 * 再 JOIN `_migration_path_map` 反查 entry_id。`chat_session` 主键列名是 `id`，
 * 项目 id 列名是 `project_id`（已核实 `bootstrap/chat/chat-schema.ts`）。
 * 找不到 entry_id 的孤儿 checkpoint 行（文件已删但 checkpoint 残留）直接丢弃。
 *
 * 兼容守卫：若 `message_checkpoint_file` 已是新形态（canonical DDL 直接建了 entry_id
 * 列、无 logical_path 列），则该表本就无需回填，直接跳过。
 */
async function backfillCheckpointFile(tx: TdbcConnection): Promise<void> {
  const cpCols = await columnNames(tx, "message_checkpoint_file");
  if (cpCols.size === 0 || !cpCols.has("logical_path")) {
    return;
  }
  // LEFT JOIN + WHERE m.entry_id IS NOT NULL：丢掉反查不到的孤儿行。
  // 用 INNER JOIN 等价但更直观，这里显式 LEFT JOIN 是为了在 SELECT 阶段能看到被丢弃的行
  // （未来如需 warning 日志可在 LEFT JOIN 的 NULL 分支统计）。
  await tx.execute(`
    INSERT INTO message_checkpoint_file_new
      (session_id, message_id, entry_id, revision_version)
    SELECT c.session_id, c.message_id, m.entry_id, c.revision_version
    FROM message_checkpoint_file c
    JOIN chat_session s ON s.id = c.session_id
    JOIN _migration_path_map m
      ON m.path = ('/projects/' || s.project_id || '/sessions/' || s.id || c.logical_path)
  `);
}

/** Step 6：回填 vfs_content_blob.ref_count 为当前被 revision 引用的次数。 */
async function backfillBlobRefCount(tx: TdbcConnection): Promise<void> {
  await tx.execute(`
    UPDATE vfs_content_blob
    SET ref_count = (
      SELECT COUNT(*) FROM vfs_revision_new
      WHERE vfs_revision_new.content_hash = vfs_content_blob.content_hash
    )
  `);
}

/** Step 7：DROP 旧表 + RENAME _new → 正名（外键依赖顺序：先 revision/checkpoint，后 entry）。 */
async function swapTables(tx: TdbcConnection): Promise<void> {
  // 先删旧索引（命名挂在旧表上，rename 不会带过来；新索引在下一步重建）。
  await tx.execute(`DROP INDEX IF EXISTS idx_vfs_entry_path_prefix`);
  await tx.execute(`DROP INDEX IF EXISTS idx_vfs_revision_path`);

  await tx.execute(`DROP TABLE vfs_revision`);
  await tx.execute(`DROP TABLE message_checkpoint_file`);
  await tx.execute(`DROP TABLE vfs_entry`);

  await tx.execute(`ALTER TABLE vfs_entry_new RENAME TO vfs_entry`);
  await tx.execute(`ALTER TABLE vfs_revision_new RENAME TO vfs_revision`);
  await tx.execute(
    `ALTER TABLE message_checkpoint_file_new RENAME TO message_checkpoint_file`,
  );
  await tx.execute(`DROP TABLE _migration_path_map`);
}

/** Step 8：重建索引（按新 schema 形态）。 */
async function rebuildIndexes(tx: TdbcConnection): Promise<void> {
  // UNIQUE(scope_key, path) 已自带唯一索引，这里另建复合索引用于前缀扫描。
  await tx.execute(`
    CREATE INDEX IF NOT EXISTS idx_vfs_entry_scope_path
      ON vfs_entry(scope_key, path)
  `);
  await tx.execute(`
    CREATE INDEX IF NOT EXISTS idx_vfs_revision_entry
      ON vfs_revision(entry_id)
  `);
  await tx.execute(`
    CREATE INDEX IF NOT EXISTS idx_message_checkpoint_session
      ON message_checkpoint(session_id)
  `);
}

/** Step 9：创建 3 个 blob ref_count 维护触发器（DDL 常量与 canonical DDL 同源）。 */
async function createTriggers(tx: TdbcConnection): Promise<void> {
  await tx.execute(VFS_REVISION_INSERT_TRIGGER_DDL);
  await tx.execute(VFS_REVISION_DELETE_TRIGGER_DDL);
  await tx.execute(VFS_REVISION_UPDATE_TRIGGER_DDL);
}

/**
 * 路径 A：旧库（path 主键形态）→ 三表 rebuild + blob ref_count + 触发器。
 * 路径 B：canonical DDL 已建 entry_id 主键形态 → PRAGMA 探测后 ensure 索引/触发器
 * （canonical DDL 只建表 + 触发器，具名索引靠 migration 补齐）后 return。
 */
async function up(tx: TdbcConnection): Promise<void> {
  if (await isEntryIdForm(tx)) {
    // 新库路径：canonical DDL 已建 entry_id 形态。补齐具名索引 + 触发器
    // （CREATE INDEX 引用的列在旧库 canonical DDL 阶段尚不存在，故索引由 migration 统一管）。
    await ensureBlobRefCountColumn(tx);
    await rebuildIndexes(tx);
    await createTriggers(tx);
    return;
  }

  await ensureBlobRefCountColumn(tx);
  await createNewTables(tx);
  await backfillVfsEntry(tx);
  await backfillVfsRevision(tx);
  await backfillCheckpointFile(tx);
  await backfillBlobRefCount(tx);
  await swapTables(tx);
  await rebuildIndexes(tx);
  await createTriggers(tx);
}

/** entry_id 化三表 rebuild + blob ref_count + 触发器（路径 B no-op）。 */
export const vfsEntryIdRedesignV1Migration: SchemaMigration = {
  id: VFS_ENTRY_ID_REDESIGN_V1_ID,
  up,
};

export { up as vfsEntryIdRedesignV1Up };
