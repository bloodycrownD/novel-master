/**
 * Novel Master SQLite 聚合 schema 引导。
 *
 * 在单次事务内执行幂等 DDL（`CREATE IF NOT EXISTS`）、已登记 schema migration、
 * 声明式 legacy 列对齐与内置 provider 种子数据。不执行 DROP 列、KKV 搬迁、wire 迁移；
 * 极旧未升级库（缺表、缺 RENAME 前列等）仍不在支持范围。
 *
 * 稳态冷启动：若 `PRAGMA user_version` ≥ {@link SCHEMA_BOOT_VERSION}，跳过 DDL 与
 * 列对齐，仅跑 pending migration 与 builtin seed，避免 RN 上数十次桥接往返。
 *
 * @module bootstrap/novel-master-bootstrap
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { VFS_SCHEMA_STATEMENTS } from "./vfs/vfs-schema.js";
import { VFS_REVISION_SCHEMA_STATEMENTS } from "./vfs/vfs-revision-schema.js";
import { VFS_CONTENT_BLOB_SCHEMA_STATEMENTS } from "./vfs/vfs-content-blob-schema.js";
import { MESSAGE_CHECKPOINT_SCHEMA_STATEMENTS } from "./message-checkpoint/message-checkpoint-schema.js";
import { KKV_SCHEMA_STATEMENTS } from "./kkv/kkv-schema.js";
import { SESSION_KKV_SCHEMA_STATEMENTS } from "./session-kkv/session-kkv-schema.js";
import { CHAT_SCHEMA_STATEMENTS } from "./chat/chat-schema.js";
import { SESSION_FS_SCHEMA_STATEMENTS } from "./session-fs/session-fs-schema.js";
import { WORKPLACE_SCHEMA_STATEMENTS } from "./workplace/workplace-schema.js";
import { SKSP_SCHEMA_STATEMENTS } from "./sksp/sksp-schema.js";
import { PROVIDER_SCHEMA_STATEMENTS } from "./provider/provider-schema.js";
import { REGEX_SCHEMA_STATEMENTS } from "./regex/regex-schema.js";
import { AGENT_SCHEMA_STATEMENTS } from "./agent/agent-schema.js";
import { seedBuiltinProviders } from "./provider/seed-builtin-providers.js";
import { alignSchemaColumns } from "./schema-align/align-schema-columns.js";
import { runPendingSchemaMigrations } from "./schema-migrations/index.js";
import { repairRefCounts } from "@/domain/vfs/logic/revision-ref-count.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";

/**
 * 稳态 DDL + 列对齐合同版本。
 *
 * 变更 {@link NOVEL_MASTER_SCHEMA_STATEMENTS} 或 `SCHEMA_COLUMN_ALIGNMENTS` 时必须 +1，
 * 否则已升版库会走快路径而漏建表/漏补列。新增 schema migration 不必改此值
 * （快路径仍会执行 pending migration）。
 */
export const SCHEMA_BOOT_VERSION = 4;

/** 各模块 DDL 语句，按依赖安全顺序排列。 */
export const NOVEL_MASTER_SCHEMA_STATEMENTS: readonly string[] = [
  ...VFS_SCHEMA_STATEMENTS,
  ...VFS_REVISION_SCHEMA_STATEMENTS,
  ...VFS_CONTENT_BLOB_SCHEMA_STATEMENTS,
  ...MESSAGE_CHECKPOINT_SCHEMA_STATEMENTS,
  ...KKV_SCHEMA_STATEMENTS,
  ...SESSION_KKV_SCHEMA_STATEMENTS,
  ...CHAT_SCHEMA_STATEMENTS,
  ...SESSION_FS_SCHEMA_STATEMENTS,
  ...WORKPLACE_SCHEMA_STATEMENTS,
  ...SKSP_SCHEMA_STATEMENTS,
  ...PROVIDER_SCHEMA_STATEMENTS,
  ...REGEX_SCHEMA_STATEMENTS,
  ...AGENT_SCHEMA_STATEMENTS,
];

async function readSchemaBootVersion(tx: TdbcConnection): Promise<number> {
  const rows = await tx.query<{ user_version: number }>("PRAGMA user_version");
  return Number(rows[0]?.user_version ?? 0);
}

async function writeSchemaBootVersion(
  tx: TdbcConnection,
  version: number,
): Promise<void> {
  // user_version 为整数 pragma，不能参数绑定。
  await tx.execute(`PRAGMA user_version = ${version}`);
}

/**
 * entry-id migration 刚跑完时置为 true，供 repairRefCounts 空闲调度判断。
 */
export let _entryIdMigrationJustApplied = false;

/**
 * 确保所有实体表存在并写入内置 provider。可安全重复调用。
 *
 * @param conn - 已打开的 TDBC 连接
 */
export async function bootstrapNovelMaster(conn: TdbcConnection): Promise<void> {
  await conn.transaction(async (tx) => {
    const bootVersion = await readSchemaBootVersion(tx);
    if (bootVersion >= SCHEMA_BOOT_VERSION) {
      // 快路径：表结构已与当前 DDL/列对齐合同一致，跳过数十次 CREATE/PRAGMA。
      const entryIdApplied = await runPendingSchemaMigrations(tx);
      await seedBuiltinProviders(tx);
      _entryIdMigrationJustApplied = entryIdApplied;
      return;
    }

    for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
      await tx.execute(sql);
    }
    const entryIdApplied = await runPendingSchemaMigrations(tx);
    await alignSchemaColumns(tx);
    // parent_session_id 索引不能放在 DDL 里——老库升级路径下 DDL 阶段该列还没被
    // ALIGN 加上，CREATE INDEX 会炸。这里在 ALIGN 之后幂等建一次，保证新老库都有。
    await tx.execute(
      "CREATE INDEX IF NOT EXISTS idx_chat_session_parent ON chat_session(parent_session_id)",
    );
    await seedBuiltinProviders(tx);
    _entryIdMigrationJustApplied = entryIdApplied;
    await writeSchemaBootVersion(tx, SCHEMA_BOOT_VERSION);
  });

  // W3：entry-id migration 刚跑完时，异步触发 repairRefCounts 作为安全网
  if (_entryIdMigrationJustApplied) {
    const revisionRepo = new SqliteVfsRevisionRepository(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const checkpoints = new SqliteMessageCheckpointRepository(conn);
    // global scope 兜底修复；不阻塞启动，丢 rejection 也不崩
    repairRefCounts(revisionRepo, entryRepo, checkpoints, "global", "/", "").catch(() => {});
  }
}
