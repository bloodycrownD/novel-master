/**
 * Scans workspace pointers referencing a saved model UUID.
 *
 * @module domain/provider/logic/find-saved-model-references
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { Row } from "@/infra/tdbc/types.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
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

/**
 * Returns human-readable reference locations for {@link savedModelId}.
 * Empty when safe to delete.
 */
export async function findSavedModelReferences(
  conn: TdbcConnection,
  savedModelId: string,
): Promise<string[]> {
  const refs: string[] = [];

  const kkvRows = await queryTemplate<{ value: string }>(
    conn,
    parser,
    `SELECT value FROM kkv_entry
     WHERE module = #{module} AND key = #{key}`,
    { module: WORKSPACE_STATE_MODULE, key: KEY_CURRENT_MODEL_ID },
  );
  if (kkvRows.length > 0 && String(kkvRows[0]!.value).trim() === savedModelId) {
    refs.push("currentModelId");
  }

  const agentRows = await queryTemplate<AgentDefinitionRow>(
    conn,
    parser,
    `SELECT agent_id, prompts_json FROM agent_definition`,
    {},
  );
  for (const row of agentRows) {
    const wire = JSON.parse(String(row.prompts_json)) as Record<string, unknown>;
    const model = wire.model;
    if (typeof model === "string" && model.trim() === savedModelId) {
      refs.push(`agent_definition:${String(row.agent_id)}`);
    }
  }

  const projectRows = await queryTemplate<ChatProjectRow>(
    conn,
    parser,
    `SELECT id, agent_config_json FROM chat_project`,
    {},
  );
  for (const row of projectRows) {
    const raw = row.agent_config_json;
    if (raw == null) {
      continue;
    }
    const config = JSON.parse(String(raw)) as Record<string, unknown>;
    const definition = config.definition;
    if (definition == null || typeof definition !== "object" || Array.isArray(definition)) {
      continue;
    }
    const model = (definition as Record<string, unknown>).model;
    if (typeof model === "string" && model.trim() === savedModelId) {
      refs.push(`chat_project:${String(row.id)}`);
    }
  }

  return refs;
}
