/**
 * Scans workspace pointers referencing a saved model UUID.
 *
 * @module domain/provider/logic/find-saved-model-references
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { Row } from "@/infra/tdbc/types.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { queryTemplate } from "@/infra/tdbc/logic/template-helper.js";
import {
  KEY_CURRENT_MODEL_ID,
  WORKSPACE_STATE_MODULE,
} from "@/service/persistent-state/impl/workspace-state-keys.js";

const parser = new SqlTemplateParser();

interface AgentDefinitionRow extends Row {
  agent_id: string;
  prompts_json: string;
}

interface ChatProjectRow extends Row {
  id: string;
  agent_config_json: string | null;
}

interface ChatSessionRow extends Row {
  id: string;
  agent_config_json: string | null;
}

/**
 * 安全解析一行 JSON；解析失败（存量脏数据）返回 null。
 *
 * ⚠️ 守卫因一条脏数据整体抛错 = 守卫失效（比不扫更糟），所以每个扫描段都必须包住。
 */
function safeParseRecord(raw: string | null): Record<string, unknown> | null {
  if (raw == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Returns human-readable reference locations for {@link savedModelId}.
 * Empty when safe to delete.
 */
export async function findSavedModelReferences(
  conn: TdbcConnection,
  savedModelId: string
): Promise<string[]> {
  const refs: string[] = [];

  const kkvRows = await queryTemplate<{ value: string }>(
    conn,
    parser,
    `SELECT value FROM kkv_entry
     WHERE module = #{module} AND key = #{key}`,
    { module: WORKSPACE_STATE_MODULE, key: KEY_CURRENT_MODEL_ID }
  );
  if (kkvRows.length > 0 && String(kkvRows[0]!.value).trim() === savedModelId) {
    refs.push("currentModelId");
  }

  const agentRows = await queryTemplate<AgentDefinitionRow>(
    conn,
    parser,
    `SELECT agent_id, prompts_json FROM agent_definition`,
    {}
  );
  for (const row of agentRows) {
    let wire: Record<string, unknown> | null;
    try {
      wire = JSON.parse(String(row.prompts_json)) as Record<string, unknown>;
    } catch {
      continue; // 脏数据不炸整个守卫
    }
    const model = wire?.model;
    if (typeof model === "string" && model.trim() === savedModelId) {
      refs.push(`agent_definition:${String(row.agent_id)}`);
    }
  }

  const projectRows = await queryTemplate<ChatProjectRow>(
    conn,
    parser,
    `SELECT id, agent_config_json FROM chat_project`,
    {}
  );
  for (const row of projectRows) {
    const config = safeParseRecord(row.agent_config_json);
    if (config == null) {
      continue;
    }
    // ⚠️ chat_project 存的是 `{mode, definition:{model}}`——要在 definition 里再挖一层。
    const definition = config.definition;
    if (
      definition == null ||
      typeof definition !== "object" ||
      Array.isArray(definition)
    ) {
      continue;
    }
    const model = (definition as Record<string, unknown>).model;
    if (typeof model === "string" && model.trim() === savedModelId) {
      refs.push(`chat_project:${String(row.id)}`);
    }
  }

  // 会话级 modelId 覆盖**只**存在这里：`chat_session` 表**没有** `model_id` 列，
  // 形态是顶层 `{agentId, modelId?}`（`SessionAgentConfig`）——
  // ⚠️ 与 chat_project 的嵌套形态不同，照抄它的取值路径会写成永远命不中的代码。
  const sessionRows = await queryTemplate<ChatSessionRow>(
    conn,
    parser,
    `SELECT id, agent_config_json FROM chat_session`,
    {}
  );
  for (const row of sessionRows) {
    const config = safeParseRecord(row.agent_config_json);
    if (config == null) {
      continue;
    }
    const model = config.modelId;
    if (typeof model === "string" && model.trim() === savedModelId) {
      refs.push(`chat_session:${String(row.id)}`);
    }
  }

  return refs;
}
