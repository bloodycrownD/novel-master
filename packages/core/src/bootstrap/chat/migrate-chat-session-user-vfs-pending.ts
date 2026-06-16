/**
 * 为旧库 `chat_session` 表添加 `user_vfs_pending_json` 列。
 *
 * WHY: `CREATE TABLE IF NOT EXISTS` 不会变更已有表；pragma 守卫的 ADD COLUMN
 * 使旧 `.db` 与用户 VFS pending 队列持久化 API 兼容。
 *
 * @module bootstrap/chat/migrate-chat-session-user-vfs-pending
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** 幂等 ADD COLUMN：legacy `chat_session` 缺少 `user_vfs_pending_json` 时补齐。 */
export async function migrateChatSessionUserVfsPending(
  tx: TdbcConnection,
): Promise<void> {
  const rows = await tx.query(
    "SELECT name FROM pragma_table_info('chat_session')",
  );
  if (rows.length === 0) {
    return;
  }
  const names = rows.map((r) => String(r.name));
  if (!names.includes("user_vfs_pending_json")) {
    await tx.execute(
      "ALTER TABLE chat_session ADD COLUMN user_vfs_pending_json TEXT NULL",
    );
  }
}
