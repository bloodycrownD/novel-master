/**
 * 声明式 legacy 列对齐清单（仅 ADD COLUMN）。
 *
 * @module bootstrap/schema-align/schema-column-alignments
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** 单表缺列补齐声明（仅 ADD COLUMN）。 */
export type SchemaColumnAlignment = {
  readonly table: string;
  readonly column: string;
  readonly addColumnSql: string;
  /** ADD 列后可选一次性回填（如 head_version ← version）。 */
  readonly afterAdd?: (tx: TdbcConnection) => Promise<void>;
};

/** 当前版本运行必需的 legacy 列清单（顺序无关，逐项幂等）。 */
export const SCHEMA_COLUMN_ALIGNMENTS: readonly SchemaColumnAlignment[] = [
  {
    table: "chat_session",
    column: "composer_draft_json",
    addColumnSql:
      "ALTER TABLE chat_session ADD COLUMN composer_draft_json TEXT NULL",
  },
  {
    table: "chat_session",
    column: "agent_config_json",
    addColumnSql:
      "ALTER TABLE chat_session ADD COLUMN agent_config_json TEXT NULL",
  },
  {
    table: "chat_session",
    column: "parent_session_id",
    addColumnSql:
      "ALTER TABLE chat_session ADD COLUMN parent_session_id TEXT NULL",
    afterAdd: async (tx) => {
      // 老库升版补列后建索引（新库由 bootstrap 末尾的幂等步骤建）。
      await tx.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_session_parent ON chat_session(parent_session_id)",
      );
    },
  },
  {
    table: "chat_message",
    column: "hidden",
    addColumnSql:
      "ALTER TABLE chat_message ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
  },
  {
    table: "chat_message",
    column: "attachments_json",
    addColumnSql:
      "ALTER TABLE chat_message ADD COLUMN attachments_json TEXT NULL",
  },
  {
    table: "chat_project",
    column: "agent_config_json",
    addColumnSql:
      "ALTER TABLE chat_project ADD COLUMN agent_config_json TEXT NULL",
  },
  {
    table: "vfs_entry",
    column: "entry_kind",
    addColumnSql:
      "ALTER TABLE vfs_entry ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'file'",
  },
  {
    table: "vfs_entry",
    column: "head_version",
    addColumnSql:
      "ALTER TABLE vfs_entry ADD COLUMN head_version INTEGER NOT NULL DEFAULT 1",
    afterAdd: async (tx) => {
      await tx.execute("UPDATE vfs_entry SET head_version = version");
    },
  },
  // vfs_content_blob.ref_count：双保险。entry-id migration 的 Step 5b 已先补列，
  // 此条目防「旧库跳过 migration 直进 align」的边角场景（理论上不会发生，但成本低）。
  {
    table: "vfs_content_blob",
    column: "ref_count",
    addColumnSql:
      "ALTER TABLE vfs_content_blob ADD COLUMN ref_count INTEGER NOT NULL DEFAULT 0",
  },
];
