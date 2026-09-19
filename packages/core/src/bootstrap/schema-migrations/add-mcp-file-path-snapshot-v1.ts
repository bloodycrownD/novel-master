/**
 * add-mcp-file-path-snapshot-v1：message_checkpoint_file 加 path 快照列
 * （rollback-restore-deleted-entry：删除文件后回滚需按 capture 时点路径
 * 反解 targetTree，entry 行已物理删除时 entry_id JOIN 反解失效）。
 *
 * 幂等探测照 add-smart-sort-capture-kind-v1 模式：PRAGMA table_info 无
 * path 列才 ALTER；新库（canonical DDL 直接建出该列）与已迁移库都早退。
 *
 * 迁移 up 内一并回填：path = 按 entry_id 关联 vfs_entry 的现路径；entry
 * 已删的行子查询得 NULL、留 NULL（读取侧回退 JOIN，等同旧形态行为）。
 *
 * 本迁移走 pending migration 通道（快/慢路径都会跑），SCHEMA_BOOT_VERSION
 * 不 bump（pending migration 不受 bootVersion 快路径短路）。坑位提示：
 * 数据回填必须与加列同一首次登记内完成——空占位迁移先登记会被视为已执行，
 * 老库将永远错过回填。
 *
 * @module bootstrap/schema-migrations/add-mcp-file-path-snapshot-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const ADD_MCP_FILE_PATH_SNAPSHOT_V1_ID = "add-mcp-file-path-snapshot-v1";

/** message_checkpoint_file 表名（与 bootstrap DDL 同源）。 */
const MESSAGE_CHECKPOINT_FILE_TABLE = "message_checkpoint_file";

/** 供测试直接调用的迁移主体。 */
export async function addMcpFilePathSnapshotV1Up(
  tx: TdbcConnection
): Promise<void> {
  const cols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${MESSAGE_CHECKPOINT_FILE_TABLE}')`
  );
  const hasColumn = cols.some((r) => String(r.name) === "path");
  // 已有 path 列（新库 canonical DDL / 已迁移库）则早退。
  if (hasColumn) {
    return;
  }
  await tx.execute(
    `ALTER TABLE ${MESSAGE_CHECKPOINT_FILE_TABLE} ADD COLUMN path TEXT NULL`
  );
  // 回填存量行：entry 还在的取现路径；entry 已删的子查询得 NULL、留 NULL
  //（读取侧对 NULL 回退 JOIN，行为等同迁移前的旧形态，不会误造路径）。
  await tx.execute(
    `UPDATE ${MESSAGE_CHECKPOINT_FILE_TABLE}
     SET path = (
       SELECT e.path FROM vfs_entry e
       WHERE e.entry_id = ${MESSAGE_CHECKPOINT_FILE_TABLE}.entry_id
     )`
  );
}

/** message_checkpoint_file 加 path 快照列的 ADD COLUMN migration。 */
export const addMcpFilePathSnapshotV1Migration: SchemaMigration = {
  id: ADD_MCP_FILE_PATH_SNAPSHOT_V1_ID,
  up: addMcpFilePathSnapshotV1Up,
};
