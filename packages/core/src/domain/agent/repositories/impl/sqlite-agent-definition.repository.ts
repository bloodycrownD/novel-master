/**
 * SQLite `agent_definition` repository.
 *
 * @module domain/agent/repositories/impl/sqlite-agent-definition.repository
 */

import type {TdbcConnection} from "@/infra/tdbc/ports/connection.port.js";
import {SqlTemplateParser} from "@/infra/sql-template/index.js";
import {executeTemplate, queryTemplate} from "@/infra/tdbc/logic/template-helper.js";
import {decode} from "@/infra/serialization/decode.js";
import {encode} from "@/infra/serialization/encode.js";
import {agentDefinitionSchema} from "../../model/agent-definition.schema.js";
import type {AgentDefinition} from "../../model/agent-definition.js";
import type {AgentDefinitionRepository} from "../agent-definition.port.js";

const UPSERT_SQL = `INSERT INTO agent_definition (agent_id, prompts_json, created_at_ms, updated_at_ms) VALUES (#{agentId}, #{promptsJson}, #{now}, #{now}) ON CONFLICT(agent_id) DO UPDATE SET prompts_json = excluded.prompts_json, updated_at_ms = excluded.updated_at_ms`;

/** TDBC-backed agent definition repository. */
export class SqliteAgentDefinitionRepository implements AgentDefinitionRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listIds(): Promise<readonly string[]> {
    const rows = await queryTemplate(this.conn, this.parser, `SELECT agent_id FROM agent_definition ORDER BY agent_id ASC`, {});
    return rows.map((row) => String(row.agent_id));
  }

  async get(agentId: string): Promise<AgentDefinition | null> {
    const wire = await this.getRawWire(agentId);
    return wire == null ? null : decode(wire, agentDefinitionSchema);
  }

  async getRawWire(agentId: string): Promise<unknown | null> {
    const rows = await queryTemplate(this.conn, this.parser, `SELECT prompts_json FROM agent_definition WHERE agent_id = #{agentId}`, {agentId});
    const row = rows[0];
    return row == null ? null : (JSON.parse(String(row.prompts_json)) as unknown);
  }

  async exists(agentId: string): Promise<boolean> {
    const rows = await queryTemplate(this.conn, this.parser, `SELECT 1 FROM agent_definition WHERE agent_id = #{agentId} LIMIT 1`, {agentId});
    return rows.length > 0;
  }

  async upsert(agentId: string, def: AgentDefinition): Promise<void> {
    const now = Date.now();
    const promptsJson = JSON.stringify(encode(def, agentDefinitionSchema));
    await executeTemplate(this.conn, this.parser, UPSERT_SQL, {agentId, promptsJson, now});
  }
  async delete(agentId: string): Promise<void> {
    await executeTemplate(this.conn, this.parser, `DELETE FROM agent_definition WHERE agent_id = #{agentId}`, {agentId});
  }

  async list(): Promise<readonly AgentDefinition[]> {
    const rows = await queryTemplate(this.conn, this.parser, `SELECT prompts_json FROM agent_definition ORDER BY agent_id ASC`, {});
    return rows.map((row) => decode(JSON.parse(String(row.prompts_json)) as unknown, agentDefinitionSchema));
  }
}
