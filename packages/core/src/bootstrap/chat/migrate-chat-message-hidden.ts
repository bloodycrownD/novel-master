/**
 * Adds `chat_message.hidden` for databases created before the column was in DDL.
 *
 * WHY: `CREATE TABLE IF NOT EXISTS` does not alter existing tables; pragma-guarded
 * ADD COLUMN keeps old `.db` files compatible with MessageService visibility APIs.
 *
 * @module bootstrap/chat/migrate-chat-message-hidden
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** Idempotent ADD COLUMN for legacy chat_message tables missing `hidden`. */
export async function migrateChatMessageHidden(
  tx: TdbcConnection,
): Promise<void> {
  const rows = await tx.query(
    "SELECT name FROM pragma_table_info('chat_message')",
  );
  if (rows.length === 0) {
    return;
  }
  const names = rows.map((r) => String(r.name));
  if (!names.includes("hidden")) {
    await tx.execute(
      "ALTER TABLE chat_message ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
    );
  }
}
