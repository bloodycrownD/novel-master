/**
 * Novel Master SQLite 聚合 schema 引导。
 *
 * 在单次事务内执行幂等 DDL（`CREATE IF NOT EXISTS`）与内置 provider 种子数据。
 * 不再包含历史一次性列迁移或 KKV 回填；极旧未升级库需用户自行处理。
 *
 * @module bootstrap/novel-master-bootstrap
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { VFS_SCHEMA_STATEMENTS } from "./vfs/vfs-schema.js";
import { VFS_REVISION_SCHEMA_STATEMENTS } from "./vfs/vfs-revision-schema.js";
import { MESSAGE_CHECKPOINT_SCHEMA_STATEMENTS } from "./message-checkpoint/message-checkpoint-schema.js";
import { KKV_SCHEMA_STATEMENTS } from "./kkv/kkv-schema.js";
import { CHAT_SCHEMA_STATEMENTS } from "./chat/chat-schema.js";
import { SESSION_FS_SCHEMA_STATEMENTS } from "./session-fs/session-fs-schema.js";
import { WORKTREE_SCHEMA_STATEMENTS } from "./worktree/worktree-schema.js";
import { SKSP_SCHEMA_STATEMENTS } from "./sksp/sksp-schema.js";
import { PROVIDER_SCHEMA_STATEMENTS } from "./provider/provider-schema.js";
import { REGEX_SCHEMA_STATEMENTS } from "./regex/regex-schema.js";
import { AGENT_SCHEMA_STATEMENTS } from "./agent/agent-schema.js";
import { seedBuiltinProviders } from "./provider/seed-builtin-providers.js";

/** 各模块 DDL 语句，按依赖安全顺序排列。 */
export const NOVEL_MASTER_SCHEMA_STATEMENTS: readonly string[] = [
  ...VFS_SCHEMA_STATEMENTS,
  ...VFS_REVISION_SCHEMA_STATEMENTS,
  ...MESSAGE_CHECKPOINT_SCHEMA_STATEMENTS,
  ...KKV_SCHEMA_STATEMENTS,
  ...CHAT_SCHEMA_STATEMENTS,
  ...SESSION_FS_SCHEMA_STATEMENTS,
  ...WORKTREE_SCHEMA_STATEMENTS,
  ...SKSP_SCHEMA_STATEMENTS,
  ...PROVIDER_SCHEMA_STATEMENTS,
  ...REGEX_SCHEMA_STATEMENTS,
  ...AGENT_SCHEMA_STATEMENTS,
];

/**
 * 确保所有实体表存在并写入内置 provider。可安全重复调用。
 *
 * @param conn - 已打开的 TDBC 连接
 */
export async function bootstrapNovelMaster(conn: TdbcConnection): Promise<void> {
  await conn.transaction(async (tx) => {
    for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
      await tx.execute(sql);
    }
    await seedBuiltinProviders(tx);
  });
}
