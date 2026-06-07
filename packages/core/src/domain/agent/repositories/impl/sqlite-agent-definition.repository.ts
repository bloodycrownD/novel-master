/**
 * SQLite `agent_definition` repository.
 *
 * @module domain/agent/repositories/impl/sqlite-agent-definition.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { decode } from "@/infra/serialization/decode.js";
import { encode } from "@/infra/serialization/encode.js";
import { agentDefinitionSchema } from "../../model/agent-definition.schema.js";
import type { AgentDefinition } from "../../model/agent-definition.js";
import type { AgentDefinitionRepository } from "../agent-definition.port.js";

function rowToDefinition(row: Row): AgentDefinition {
  const wire = JSON.parse(String(row.prompts_json)) as unknown;
  return decode(wire, agentDefinitionSchema);
}

/** TDBC-backed agent definition repository. */
export class SqliteAgentDefinitionRepository implements AgentDefinitionRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listIds(): Promise<readonly string[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT agent_id FROM agent_definition ORDER BY agent_id ASC`,
      {},
    );
    return rows.map((row) => String(row.agent_id));
  }

  async get(agentId: string): Promise<AgentDefinition | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT agent_id, prompts_json
       FROM agent_definition WHERE agent_id = #{agentId}`,
      { agentId },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToDefinition(rows[0]!);
  }

  async upsert(agentId: string, def: AgentDefinition): Promise<void> {
    const now = Date.now();
    const wire = encode(def, agentDefinitionSchema);
    const promptsJson = JSON.stringify(wire);

    // Legacy columns `model` / `runtime_json` are not written; `prompts_json` is canonical.
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO agent_definition (
        agent_id, model, runtime_json, prompts_json, created_at_ms, updated_at_ms
      ) VALUES (
        #{agentId}, NULL, NULL, #{promptsJson}, #{now}, #{now}
      )
      ON CONFLICT(agent_id) DO UPDATE SET
        prompts_json = excluded.prompts_json,
        updated_at_ms = excluded.updated_at_ms`,
      { agentId, promptsJson, now },
    );
  }

  async delete(agentId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM agent_definition WHERE agent_id = #{agentId}`,
      { agentId },
    );
  }
}
