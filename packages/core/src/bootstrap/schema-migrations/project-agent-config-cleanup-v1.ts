/**
 * project-agent-config-cleanup-v1：清空 `chat_project.agent_config_json` 列。
 *
 * 项目智能体功能已下线，所有项目统一走 session 级智能体选择。本迁移把历史
 * 残留的 custom 配置数据置空（列保留，不 DROP COLUMN——仓库 schema-column-alignments
 * 基建只支持 ADD COLUMN，DROP 风险大，且保留列可降低老版本数据库回滚的兼容风险）。
 *
 * 幂等：列已为 NULL 的行不受影响；列不存在的库跳过（新库由 bootstrap 建表，
 * legacy 库由 schema-column-alignments 补列后再跑本迁移）。
 *
 * @module bootstrap/schema-migrations/project-agent-config-cleanup-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const PROJECT_AGENT_CONFIG_CLEANUP_V1_ID = "project-agent-config-cleanup-v1";

/** 检查 chat_project 是否已有 agent_config_json 列（migration 顺序不保证）。 */
async function chatProjectHasAgentConfigColumn(
  tx: TdbcConnection,
): Promise<boolean> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('chat_project')`,
  );
  return rows.some((row) => row.name === "agent_config_json");
}

async function up(tx: TdbcConnection): Promise<void> {
  // 迁移跑在 alignSchemaColumns 之前：legacy 库可能还缺这列。
  // 缺列时直接跳过（无列可清），新库由 bootstrap 建表后列默认 NULL。
  if (!(await chatProjectHasAgentConfigColumn(tx))) {
    return;
  }
  await tx.execute(
    `UPDATE chat_project SET agent_config_json = NULL WHERE agent_config_json IS NOT NULL`,
  );
}

/** 项目智能体配置清理 migration（置空 agent_config_json 列数据）。 */
export const projectAgentConfigCleanupV1Migration: SchemaMigration = {
  id: PROJECT_AGENT_CONFIG_CLEANUP_V1_ID,
  up,
};
