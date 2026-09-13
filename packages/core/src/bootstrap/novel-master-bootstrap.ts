/**
 * Novel Master SQLite 聚合 schema 引导。
 *
 * 在单次事务内执行幂等 DDL（`CREATE IF NOT EXISTS`）、已登记 schema migration、
 * 声明式 legacy 列对齐与内置 provider 种子数据。不执行 DROP 列、KKV 搬迁、wire 迁移。
 *
 * 稳态冷启动：若 `PRAGMA user_version` ≥ {@link SCHEMA_BOOT_VERSION}，跳过 DDL 与
 * 列对齐，仅跑 pending migration 与 builtin seed，避免 RN 上数十次桥接往返。
 *
 * 最低支持版本：v1.5.5。低于此版本的极旧库需先升级到 v1.5.5，再升级到本版本——
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
import { SMART_SORT_RULE_SCHEMA_STATEMENTS } from "./smart-sort-rule/smart-sort-rule-schema.js";
import { SKILLS_SCHEMA_STATEMENTS } from "./skills/skills-schema.js";
import { SKSP_SCHEMA_STATEMENTS } from "./sksp/sksp-schema.js";
import { PROVIDER_SCHEMA_STATEMENTS } from "./provider/provider-schema.js";
import { AGENT_SCHEMA_STATEMENTS } from "./agent/agent-schema.js";
import { seedBuiltinProviders } from "./provider/seed-builtin-providers.js";
import { seedBuiltinSmartSortRules } from "./smart-sort-rule/builtin-smart-sort-rules.js";
import { seedBuiltinSkills } from "./skills/seed-builtin-skills.js";
import { alignSchemaColumns } from "./schema-align/align-schema-columns.js";
import {
  ensureSchemaMigrationsTable,
  listAppliedSchemaMigrationIds,
  runPendingSchemaMigrations,
} from "./schema-migrations/index.js";
import { createVfsEntrySequenceRepairOperation } from "@/domain/vfs/logic/entry-sequence-repair.js";
import { IntegrityRepairRegistry } from "@/service/integrity-repair.js";

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
 *
 * v8：chat_message 新增 cache_read_tokens / cache_creation_tokens / model_name
 * 三列与 idx_chat_message_created_at 索引。老库（v7）靠本轮 bump 走慢路径，
 * 由 DDL 建索引 + ALIGN 补列；新列的存量回填由 usage-cache-model-backfill-v1
 * migration 承担（见 schema-migrations 目录）。
 * v9：chat_message 新增 first_token_ms / duration_ms 两列（TTFT/速率统计）。
 * 老库（v8）靠本轮 bump 走慢路径，由 ALIGN 补列；两列仅新消息写入，
 * 无存量回填。token-usage-stats-enhance 迭代曾遗漏此 bump，导致存量库
 * 走快路径永远不补列（真机实测 no such column: first_token_ms）。
 * v10：chat_message 新增 provider_id 列（provider×model 维度统计，写入时
 * 快照 savedModel.providerId）。老库（v9）靠本轮 bump 走慢路径由 ALIGN
 * 补列；无存量回填（历史行 NULL 归「其他」桶）。曾再犯 v9 同款遗漏，
 * 真机实测 no such column: provider_id。
 * v11：移除正则系统——statements 删去 regex_group/regex_rule 建表并加入
 * DROP TABLE IF EXISTS 幂等清理两表。老库（v10）靠本轮 bump 走慢路径
 * 执行 DROP；全新库建表语句已不存在；恢复旧备份（user_version 回退）
 * 同样走慢路径再次清理。KKV currentRegexGroupId 残留键随方法删除后
 * 无人读写，无害保留。
 * v12：llm_provider 新增 body_params_json 列（服务商「自定义参数」，
 * 原样合并进请求体顶层）。老库（v11）靠本轮 bump 走慢路径由 ALIGN
 * 补列；DEFAULT '{}' 无存量回填。seed 内置行的 INSERT 显式列清单，
 * 新列走 DEFAULT。
 * v13：workplace_dir_rule.sort_field CHECK 扩枚举 'smart'（文件名智能排序）
 * + 新表 smart_sort_rule（规则管理）与内置规则 seed。老库（v12）靠本轮
 * bump 走慢路径：新表由 DDL 建出；但 CHECK 变更对已存在的表不生效，
 * 由 workplace-dir-rule-smart-field-v1 migration rebuild 承担（存量行
 * 原样搬运）。本条在分支内原编号 v11；merge origin/main（已发布 v11/v12）
 * 时顺延为 v13，保证走过 v1.5.16（user_version=12）的存量库走慢路径。
 */
export const SCHEMA_BOOT_VERSION = 13;

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
  ...SMART_SORT_RULE_SCHEMA_STATEMENTS,
  ...SKILLS_SCHEMA_STATEMENTS,
  ...SKSP_SCHEMA_STATEMENTS,
  ...PROVIDER_SCHEMA_STATEMENTS,
  ...AGENT_SCHEMA_STATEMENTS,
  // v11：正则系统移除，幂等清理两表（idx_regex_rule_group_sort 随表消亡）；
  // 先子表后父表，避免未来开启 FK 约束时 DROP 顺序问题。
  "DROP TABLE IF EXISTS regex_rule;",
  "DROP TABLE IF EXISTS regex_group;",
];

async function readSchemaBootVersion(tx: TdbcConnection): Promise<number> {
  const rows = await tx.query<{ user_version: number }>("PRAGMA user_version");
  return Number(rows[0]?.user_version ?? 0);
}

async function writeSchemaBootVersion(
  tx: TdbcConnection,
  version: number
): Promise<void> {
  // user_version 为整数 pragma，不能参数绑定。
  await tx.execute(`PRAGMA user_version = ${version}`);
}

/**
 * v1.4.27 之前上线的 schema migration id 清单。
 *
 * 本版本最低支持 v1.4.27，这些 migration 的逻辑已融入 canonical DDL 与 align（或
 * 已不再需要），源文件已删除，不再在 {@link runPendingSchemaMigrations} 阵列里执行。
 * 但运行时仍需确认老库走过它们——若表里一条都没登记、又探测到 legacy 形态，
 * 说明用户跳过了 v1.4.27 直接到本版本，须 fail-fast 提示先升级。
 *
 * 前三条（vfs-entry-id-redesign-v1、session-agent-config-v2、
 * project-agent-config-cleanup-v1）为第二轮退役：所有 ≥v1.4.27 的库都已应用过。
 * 第三轮退役：orphan-revision-gc-v1、table-constraints-v1b——所有
 * ≥v1.4.28 的库都已应用过，最低支持版本随之升至 v1.4.28。
 * 第四轮退役：usage-cache-model-backfill-v1（数据回填，v1.5.4 首发引入）——
 * 所有 ≥v1.5.5 的库都已应用过，最低支持版本随之升至 v1.5.5。
 */
export const BASELINE_MIGRATION_IDS: readonly string[] = [
  "saved-model-identity-v1",
  "provider-identity-v1",
  "drop-chat-session-user-vfs-pending-v1",
  "rename-worktree-tables-to-workplace-v1",
  "vfs-content-blob-zlib-v1",
  "vfs-revision-ref-count-v1",
  "vfs-entry-id-redesign-v1",
  "session-agent-config-v2",
  "project-agent-config-cleanup-v1",
  "orphan-revision-gc-v1",
  "table-constraints-v1b",
  "usage-cache-model-backfill-v1",
];

/** 老库升级失败提示，指引用户先升到 v1.5.5。 */
export const BASELINE_TOO_OLD_MESSAGE =
  "检测到当前数据库低于本版本最低支持版本（v1.5.5）。请先升级到 v1.5.5，再升级到本版本。";

/** `llm_saved_model` 无 `id` 列 → 常见老库尚未走 saved-model-identity-v1。 */
async function hasLegacySavedModelShape(tx: TdbcConnection): Promise<boolean> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'llm_saved_model'`
  );
  if (tables.length === 0) {
    return false;
  }
  const cols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('llm_saved_model')`
  );
  const names = new Set(cols.map((c) => c.name));
  return !names.has("id");
}

/** 存在 `worktree_*` 规则表 → 未走 rename-worktree-tables-to-workplace-v1。 */
async function hasLegacyWorktreeTables(tx: TdbcConnection): Promise<boolean> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND (name = 'worktree_dir_rule' OR name = 'worktree_file_rule')`
  );
  return rows.length > 0;
}

/**
 * `vfs_entry` 存在但 `entry_id` 不是主键（旧形态 pk 是 `path`）
 * → 未走 vfs-entry-id-redesign-v1。判据与原迁移自身的探测一致。
 */
async function hasLegacyVfsEntryShape(tx: TdbcConnection): Promise<boolean> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vfs_entry'`
  );
  if (tables.length === 0) {
    return false;
  }
  const cols = await tx.query<{ name: string; pk: number }>(
    `SELECT name, pk FROM pragma_table_info('vfs_entry')`
  );
  const entryId = cols.find((c) => c.name === "entry_id");
  return !(entryId != null && entryId.pk > 0);
}

/**
 * `chat_session` 存在但缺 `agent_config_json` 列
 * → 未走 session-agent-config-v2（该迁移/DDL 在 v1.4.21 前后引入此列）。
 */
async function hasLegacyChatSessionShape(tx: TdbcConnection): Promise<boolean> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_session'`
  );
  if (tables.length === 0) {
    return false;
  }
  const cols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('chat_session')`
  );
  return !cols.some((c) => c.name === "agent_config_json");
}

/**
 * `chat_project` 存在且 `agent_config_json` 有非 NULL 残留
 * → 未走 project-agent-config-cleanup-v1（该功能已下线，新库不会再写入非 NULL）。
 */
async function hasLegacyChatProjectShape(tx: TdbcConnection): Promise<boolean> {
  const tables = await tx.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_project'`
  );
  if (tables.length === 0) {
    return false;
  }
  const cols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('chat_project')`
  );
  if (!cols.some((c) => c.name === "agent_config_json")) {
    return false;
  }
  const rows = await tx.query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM chat_project WHERE agent_config_json IS NOT NULL`
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

/**
 * `vfs_revision` 存在但未切 WITHOUT ROWID（table-constraints-v1b 的独有形态变化，
 * canonical DDL 之外没有别处会改它）→ 未走 table-constraints-v1b（< v1.4.28）。
 * 判据与原迁移自身的探测一致；查询异常/空结果的保守方向是 false（新装路径不触发）。
 */
async function hasLegacyVfsRevisionShape(tx: TdbcConnection): Promise<boolean> {
  const rows = await tx.query<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vfs_revision'`
  );
  if (rows.length === 0 || rows[0]?.sql == null) {
    return false;
  }
  return !/WITHOUT\s+ROWID/i.test(String(rows[0]?.sql ?? ""));
}

/** 任一 legacy 形态命中即视为未升级到 v1.4.28。 */
async function detectLegacyShape(tx: TdbcConnection): Promise<boolean> {
  if (await hasLegacySavedModelShape(tx)) {
    return true;
  }
  if (await hasLegacyWorktreeTables(tx)) {
    return true;
  }
  if (await hasLegacyVfsEntryShape(tx)) {
    return true;
  }
  if (await hasLegacyChatSessionShape(tx)) {
    return true;
  }
  if (await hasLegacyVfsRevisionShape(tx)) {
    return true;
  }
  return hasLegacyChatProjectShape(tx);
}

/**
 * 版本基线检查：migration runner 之前 fail-fast。
 *
 * 判断逻辑：`schema_migrations` 表里必须至少有一条 baseline id 被登记；
 * 一条都没登记、且探测到 legacy 形态时，判定为跨大版本升级，报错拦下。
 * 全新空库（无 legacy 表征）不触发——首次安装是新装路径。
 */
export async function assertMinimumBaseline(tx: TdbcConnection): Promise<void> {
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
 * 确保所有实体表存在并写入内置 provider。可安全重复调用。
 *
 * @param conn - 已打开的 TDBC 连接
 */
export async function bootstrapNovelMaster(
  conn: TdbcConnection
): Promise<void> {
  await conn.transaction(async (tx) => {
    const bootVersion = await readSchemaBootVersion(tx);
    if (bootVersion >= SCHEMA_BOOT_VERSION) {
      // 快路径：表结构已与当前 DDL/列对齐合同一致，跳过数十次 CREATE/PRAGMA。
      await assertMinimumBaseline(tx);
      await runPendingSchemaMigrations(tx);
      await seedBuiltinProviders(tx);
      await seedBuiltinSmartSortRules(tx);
      return;
    }

    for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
      await tx.execute(sql);
    }
    await assertMinimumBaseline(tx);
    await runPendingSchemaMigrations(tx);
    await alignSchemaColumns(tx);
    // parent_session_id 索引不能放在 DDL 里——老库升级路径下 DDL 阶段该列还没被
    // ALIGN 加上，CREATE INDEX 会炸。这里在 ALIGN 之后幂等建一次，保证新老库都有。
    await tx.execute(
      "CREATE INDEX IF NOT EXISTS idx_chat_session_parent ON chat_session(parent_session_id)"
    );
    await seedBuiltinProviders(tx);
    await seedBuiltinSmartSortRules(tx);
    await writeSchemaBootVersion(tx, SCHEMA_BOOT_VERSION);
  });

  // D1：内置技能 seed 挂事务之后的公共路径（快/慢两分支共用本出口；放事务内
  // 会与 createSkillsService 内部基于外层 conn 的 VfsService 装配嵌套冲突）。
  // 种入属可选内容——失败仅记日志不阻断启动，下次启动幂等重试。
  try {
    await seedBuiltinSkills(conn);
  } catch (error) {
    console.warn(
      "[bootstrap] 内置技能种入失败（不阻断启动，下次启动重试）:",
      error
    );
  }

  // W3：发号器安全网（无条件，await 保证先于任何业务写入）：孤儿 revision 占号
  // + sqlite_sequence 回退时，新建文件会撞 vfs_revision(entry_id, version)
  // 唯一键（导入旧备份库实测）。两条聚合查询成本可忽。
  // 历史：这里曾另有 entry-id migration 刚跑完时的 ref_count / provider 身份键
  // 兜底修复分支，随 vfs-entry-id-redesign-v1 退役（最低支持 v1.4.27）一并移除。
  try {
    const reports = await new IntegrityRepairRegistry()
      .register(createVfsEntrySequenceRepairOperation(conn))
      .runAll();
    for (const report of reports) {
      if (report.error != null) {
        console.warn(
          `[bootstrap] 发号器完整性修复失败（${report.name}，不阻断启动，下次启动重试）:`,
          report.error
        );
      }
    }
  } catch (error) {
    // runAll 对单步失败已兜底挂报告，这里是 registry 编排层异常的保险：
    // 同样只记日志不阻断启动（可重试）。
    console.warn(
      "[bootstrap] 发号器完整性修复运行异常（不阻断启动，下次启动重试）:",
      error
    );
  }
}
