/**
 * session-agent-config-v2：把 `chat_session.agent_config_json` 从老 follow/bind
 * 形态迁移到 v2 单形态 `{ agentId, modelId? }`。
 *
 * 老形态：
 * - NULL（mode=follow）：用 workspace 当前 agentId + modelId 回填；
 *   workspace agentId 缺失时回落 registry 第一个 agent；registry 也空则保留 NULL
 *   （service 层 getSessionAgentConfig 会抛错提示）。
 * - `{ mode: "bind", agentId, modelId? }` JSON：剥掉 mode，转 `{ agentId, modelId? }`。
 *
 * 幂等：已是 v2 形态（JSON 无 `mode` 字段且非 NULL）则跳过。
 *
 * @module bootstrap/schema-migrations/session-agent-config-v2
 */

import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { Row } from "@/infra/tdbc/types.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import {
  KEY_CURRENT_AGENT_ID,
  KEY_CURRENT_MODEL_ID,
  WORKSPACE_STATE_MODULE,
} from "@/service/persistent-state/impl/workspace-state-keys.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const SESSION_AGENT_CONFIG_V2_ID = "session-agent-config-v2";

const parser = new SqlTemplateParser();

interface ChatSessionRow extends Row {
  id: string;
  agent_config_json: string | null;
}

interface KkvEntryRow extends Row {
  value: string;
}

interface AgentDefinitionIdRow extends Row {
  agent_id: string;
}

/** 检查 chat_session 是否已有 agent_config_json 列（migration 跑在 align 之前）。 */
async function chatSessionHasAgentConfigColumn(
  tx: TdbcConnection,
): Promise<boolean> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('chat_session')`,
  );
  return rows.some((row) => row.name === "agent_config_json");
}

/** 读 kkv_entry 中 module=nm-workspace-state 的某个 key 值。 */
async function readWorkspaceKey(
  tx: TdbcConnection,
  key: string,
): Promise<string | null> {
  const rows = await queryTemplate<KkvEntryRow>(
    tx,
    parser,
    `SELECT value FROM kkv_entry
     WHERE module = #{module} AND key = #{key}`,
    { module: WORKSPACE_STATE_MODULE, key },
  );
  if (rows.length === 0) {
    return null;
  }
  const value = String(rows[0]!.value);
  return value === "" ? null : value;
}

/** 读 registry 第一个 agent id（按 agent_id ASC）作为回落。 */
async function readFirstRegistryAgentId(
  tx: TdbcConnection,
): Promise<string | null> {
  const rows = await queryTemplate<AgentDefinitionIdRow>(
    tx,
    parser,
    `SELECT agent_id FROM agent_definition ORDER BY agent_id ASC LIMIT 1`,
    {},
  );
  if (rows.length === 0) {
    return null;
  }
  return String(rows[0]!.agent_id);
}

/** 探测 JSON 是否已是 v2 形态（无 `mode` 字段且含 `agentId`）。 */
function isV2Shape(parsed: Record<string, unknown>): boolean {
  return !("mode" in parsed) && typeof parsed.agentId === "string";
}

async function up(tx: TdbcConnection): Promise<void> {
  // migration 跑在 alignSchemaColumns 之前：legacy 库可能还缺这列。
  // 缺列时手动补上（NULL），再继续回填，避免依赖 align 后序补列导致跳过回填。
  if (!(await chatSessionHasAgentConfigColumn(tx))) {
    await tx.execute(
      `ALTER TABLE chat_session ADD COLUMN agent_config_json TEXT`,
    );
  }

  const workspaceAgentId =
    (await readWorkspaceKey(tx, KEY_CURRENT_AGENT_ID)) ??
    (await readFirstRegistryAgentId(tx));
  const workspaceModelId = await readWorkspaceKey(tx, KEY_CURRENT_MODEL_ID);

  const rows = await queryTemplate<ChatSessionRow>(
    tx,
    parser,
    `SELECT id, agent_config_json FROM chat_session`,
    {},
  );

  for (const row of rows) {
    const sessionId = String(row.id);
    const raw = row.agent_config_json;

    // 老 follow：列 NULL → 用 workspace 指针回填；workspace 也无则保留 NULL。
    if (raw == null) {
      if (workspaceAgentId == null) {
        // workspace 与 registry 均空，无法回填；保留 NULL，service 层会抛错。
        continue;
      }
      const wire: Record<string, unknown> = { agentId: workspaceAgentId };
      if (workspaceModelId != null) {
        wire.modelId = workspaceModelId;
      }
      await executeTemplate(
        tx,
        parser,
        `UPDATE chat_session SET agent_config_json = #{configJson}
         WHERE id = #{sessionId}`,
        { sessionId, configJson: JSON.stringify(wire) },
      );
      continue;
    }

    // 非 NULL：解析并判定是否已是 v2 或需转换。
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      // 损坏 JSON 不动它，避免误覆盖；service 层读时会抛 decode 错。
      continue;
    }
    if (isV2Shape(parsed)) {
      // 已迁移，幂等跳过。
      continue;
    }

    // 老 bind：`{ mode: "bind", agentId, modelId? }` → 剥 mode。
    if (parsed.mode === "bind" && typeof parsed.agentId === "string") {
      const wire: Record<string, unknown> = { agentId: parsed.agentId };
      if (typeof parsed.modelId === "string" && parsed.modelId !== "") {
        wire.modelId = parsed.modelId;
      }
      await executeTemplate(
        tx,
        parser,
        `UPDATE chat_session SET agent_config_json = #{configJson}
         WHERE id = #{sessionId}`,
        { sessionId, configJson: JSON.stringify(wire) },
      );
      continue;
    }

    // 其他未知形态（含老 mode=follow 的 JSON 异常态）：按 NULL 同策略回填。
    if (workspaceAgentId != null) {
      const wire: Record<string, unknown> = { agentId: workspaceAgentId };
      if (workspaceModelId != null) {
        wire.modelId = workspaceModelId;
      }
      await executeTemplate(
        tx,
        parser,
        `UPDATE chat_session SET agent_config_json = #{configJson}
         WHERE id = #{sessionId}`,
        { sessionId, configJson: JSON.stringify(wire) },
      );
    }
  }
}

/** session agent config v2 migration（NULL→workspace 回填；bind→剥 mode）。 */
export const sessionAgentConfigV2Migration: SchemaMigration = {
  id: SESSION_AGENT_CONFIG_V2_ID,
  up,
};

export { up as sessionAgentConfigV2Up };
