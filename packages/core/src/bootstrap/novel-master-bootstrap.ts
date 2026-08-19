/**
 * Novel Master SQLite 聚合 schema 引导。
 *
 * 在单次事务内执行幂等 DDL（`CREATE IF NOT EXISTS`）、已登记 schema migration、
 * 声明式 legacy 列对齐与内置 provider 种子数据。不执行 DROP 列、KKV 搬迁、wire 迁移。
 *
 * 稳态冷启动：若 `PRAGMA user_version` ≥ {@link SCHEMA_BOOT_VERSION}，跳过 DDL 与
 * 列对齐，仅跑 pending migration 与 builtin seed，避免 RN 上数十次桥接往返。
 *
 * 最低支持版本：v1.4.08。低于此版本的极旧库需先升级到 v1.4.08，再升级到本版本——
 * {@link assertMinimumBaseline} 会在 migration runner 之前做 fail-fast 检查，
 * 防止跨大版本升级走样。
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
import { SKILLS_SCHEMA_STATEMENTS } from "./skills/skills-schema.js";
import { SKSP_SCHEMA_STATEMENTS } from "./sksp/sksp-schema.js";
import { PROVIDER_SCHEMA_STATEMENTS } from "./provider/provider-schema.js";
import { REGEX_SCHEMA_STATEMENTS } from "./regex/regex-schema.js";
import { AGENT_SCHEMA_STATEMENTS } from "./agent/agent-schema.js";
import { seedBuiltinProviders } from "./provider/seed-builtin-providers.js";
import { alignSchemaColumns } from "./schema-align/align-schema-columns.js";
import {
  ensureSchemaMigrationsTable,
  listAppliedSchemaMigrationIds,
  runPendingSchemaMigrations,
} from "./schema-migrations/index.js";
import { SAVED_MODEL_IDENTITY_V1_ID } from "./schema-migrations/saved-model-identity-v1.js";
import { PROVIDER_IDENTITY_V1_ID } from "./schema-migrations/provider-identity-v1.js";
import { DROP_CHAT_SESSION_USER_VFS_PENDING_V1_ID } from "./schema-migrations/drop-chat-session-user-vfs-pending-v1.js";
import { RENAME_WORKTREE_TABLES_TO_WORKPLACE_V1_ID } from "./schema-migrations/rename-worktree-tables-to-workplace-v1.js";
import { VFS_CONTENT_BLOB_ZLIB_V1_ID } from "./schema-migrations/vfs-content-blob-zlib-v1.js";
import { VFS_REVISION_REF_COUNT_V1_ID } from "./schema-migrations/vfs-revision-ref-count-v1.js";
import { createRevisionRefCountRepairOperation } from "@/domain/vfs/logic/revision-ref-count.js";
import { createProviderIdentityRepairOperation } from "@/domain/provider/logic/provider-identity-repair.js";
import { IntegrityRepairRegistry } from "@/service/integrity-repair.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteProviderRepository } from "@/domain/provider/repositories/impl/sqlite-provider.repository.js";

/**
 * 稳态 DDL + 列对齐合同版本。
 *
 * 变更 {@link NOVEL_MASTER_SCHEMA_STATEMENTS} 或 `SCHEMA_COLUMN_ALIGNMENTS` 时必须 +1，
 * 否则已升版库会走快路径而漏建表/漏补列。新增 schema migration 不必改此值
 * （快路径仍会执行 pending migration）。
 *
 * v7：v6 版本号曾在两条分支各自使用（main 侧 v1.4.29 与 skills 分支各自 +1），
 * 导致被 main v6 迁移过的库缺 skill_disabled_rule 表。 v7 强制重跑全量幂等 DDL
 * 补齐（CREATE TABLE IF NOT EXISTS，已存在的表不受影响）。
 */
export const SCHEMA_BOOT_VERSION = 7;

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
  ...SKILLS_SCHEMA_STATEMENTS,
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
 * v1.4.08 之前上线的 schema migration id 清单。
 *
 * 本版本最低支持 v1.4.08，这些 migration 的逻辑已融入 canonical DDL 与 align，
 * 不再在 {@link runPendingSchemaMigrations} 阵列里执行。但运行时仍需确认老库走过它们——
 * 若表里一条都没登记、又探测到 legacy 形态，说明用户跳过了 v1.4.08 直接到本版本，
 * 须 fail-fast 提示先升级。
 */
export const BASELINE_MIGRATION_IDS: readonly string[] = [
  SAVED_MODEL_IDENTITY_V1_ID,
  PROVIDER_IDENTITY_V1_ID,
  DROP_CHAT_SESSION_USER_VFS_PENDING_V1_ID,
  RENAME_WORKTREE_TABLES_TO_WORKPLACE_V1_ID,
  VFS_CONTENT_BLOB_ZLIB_V1_ID,
  VFS_REVISION_REF_COUNT_V1_ID,
];

/** 老库升级失败提示，指引用户先升到 v1.4.08。 */
export const BASELINE_TOO_OLD_MESSAGE =
  "检测到当前数据库低于本版本最低支持版本（v1.4.08）。请先升级到 v1.4.08，再升级到本版本。";

/** `llm_saved_model` 无 `id` 列 → 常见老库尚未走 saved-model-identity-v1。 */
async function hasLegacySavedModelShape(tx: TdbcConnection): Promise<boolean> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'llm_saved_model'`,
  );
  if (tables.length === 0) {
    return false;
  }
  const cols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('llm_saved_model')`,
  );
  const names = new Set(cols.map((c) => c.name));
  return !names.has("id");
}

/** 存在 `worktree_*` 规则表 → 未走 rename-worktree-tables-to-workplace-v1。 */
async function hasLegacyWorktreeTables(tx: TdbcConnection): Promise<boolean> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND (name = 'worktree_dir_rule' OR name = 'worktree_file_rule')`,
  );
  return rows.length > 0;
}

/** 任一 legacy 形态命中即视为未升级到 v1.4.08。 */
async function detectLegacyShape(tx: TdbcConnection): Promise<boolean> {
  if (await hasLegacySavedModelShape(tx)) {
    return true;
  }
  return hasLegacyWorktreeTables(tx);
}

/**
 * 版本基线检查：migration runner 之前 fail-fast。
 *
 * 判断逻辑：`schema_migrations` 表里必须至少有一条 baseline id 被登记；
 * 一条都没登记、且探测到 legacy 形态时，判定为跨大版本升级，报错拦下。
 * 全新空库（无 legacy 表征）不触发——首次安装是新装路径。
 */
export async function assertMinimumBaseline(
  tx: TdbcConnection,
): Promise<void> {
  await ensureSchemaMigrationsTable(tx);
  const applied = await listAppliedSchemaMigrationIds(tx);

  const hasBaseline = BASELINE_MIGRATION_IDS.some((id) => applied.has(id));
  if (hasBaseline) {
    return;
  }

  if (await detectLegacyShape(tx)) {
    throw new Error(BASELINE_TOO_OLD_MESSAGE);
  }
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
      await assertMinimumBaseline(tx);
      const entryIdApplied = await runPendingSchemaMigrations(tx);
      await seedBuiltinProviders(tx);
      _entryIdMigrationJustApplied = entryIdApplied;
      return;
    }

    for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
      await tx.execute(sql);
    }
    await assertMinimumBaseline(tx);
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

  // W3：entry-id migration 刚跑完时，异步走统一完整性修复注册表作为安全网。
  //
  // 这里登记两类操作：
  //   1. vfs revision ref_count 修复（只动 vfs_revision.ref_count，不碰 blob 侧触发器计数）；
  //   2. provider 双身份键形态校验（migration 后 assertMigratedShape 的运行时镜像）。
  //
  // 两条路径各自独立，互不干扰。不阻塞启动，丢 rejection 也不崩。
  if (_entryIdMigrationJustApplied) {
    const revisionRepo = new SqliteVfsRevisionRepository(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const checkpoints = new SqliteMessageCheckpointRepository(conn);
    const providerRepo = new SqliteProviderRepository(conn);
    const registry = new IntegrityRepairRegistry()
      .register(
        createRevisionRefCountRepairOperation({
          revisionRepo,
          entryRepo,
          checkpoints,
          scopeKey: "global",
          pathPrefix: "/",
          sessionId: "",
        }),
      )
      .register(createProviderIdentityRepairOperation({ providerRepo }));
    // global scope 兜底修复；不阻塞启动，丢 rejection 也不崩
    registry.runAll().catch(() => {});
  }
}
