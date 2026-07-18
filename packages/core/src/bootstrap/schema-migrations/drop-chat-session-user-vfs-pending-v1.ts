/**
 * drop-chat-session-user-vfs-pending-v1：表重建删除 `user_vfs_pending_json` 列。
 *
 * 不迁移旧 pending 内容（产品接受丢弃）。
 *
 * @module bootstrap/schema-migrations/drop-chat-session-user-vfs-pending-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const DROP_CHAT_SESSION_USER_VFS_PENDING_V1_ID =
  "drop-chat-session-user-vfs-pending-v1";

async function getTableColumns(
  tx: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
  );
  return new Set(rows.map((row) => row.name));
}

/**
 * 路径 A：旧库含 `user_vfs_pending_json` → 表重建删除列（不拷贝 pending 数据）。
 * 路径 B：canonical DDL 已无该列 → no-op。
 */
async function up(tx: TdbcConnection): Promise<void> {
  const columns = await getTableColumns(tx, "chat_session");
  if (!columns.has("user_vfs_pending_json")) {
    return;
  }

  // bootstrap canonical DDL 可能已创建同名索引，先删避免新表建索引时冲突。
  await tx.execute(`DROP INDEX IF EXISTS idx_chat_session_project`);

  // 与当前 canonical DDL 对齐（含 composer_draft_json；旧 pending 库通常尚无该列 → NULL）
  await tx.execute(`
    CREATE TABLE chat_session_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT,
      composer_draft_json TEXT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);

  const copyDraft = columns.has("composer_draft_json");
  await tx.execute(`
    INSERT INTO chat_session_new (id, project_id, title, composer_draft_json, created_at_ms, updated_at_ms)
    SELECT id, project_id, title, ${copyDraft ? "composer_draft_json" : "NULL"}, created_at_ms, updated_at_ms
    FROM chat_session
  `);

  await tx.execute(`DROP TABLE chat_session`);
  await tx.execute(`ALTER TABLE chat_session_new RENAME TO chat_session`);
  await tx.execute(`
    CREATE INDEX idx_chat_session_project
      ON chat_session(project_id)
  `);
}

/** 删除 chat_session.user_vfs_pending_json（表重建；路径 B no-op）。 */
export const dropChatSessionUserVfsPendingV1Migration: SchemaMigration = {
  id: DROP_CHAT_SESSION_USER_VFS_PENDING_V1_ID,
  up,
};

export { up as dropChatSessionUserVfsPendingV1Up };
