/**
 * SQLite `agent_definition` repository.
 *
 * @module domain/agent/repositories/impl/sqlite-agent-definition.repository
 */

import type {TdbcConnection} from "@/infra/tdbc/ports/connection.port.js";
import {SqlTemplateParser} from "@/infra/sql-template/index.js";
import {TdbcTemplate} from "@/infra/tdbc/logic/template-helper.js";
import {SerializationDecode} from "@/common/serialization/decode.js";
import {SerializationEncode} from "@/common/serialization/encode.js";
import {AppError} from "@/errors/app-error.js";
import {Result} from "@/errors/either.js";
import {AgentDefinitionSql} from "@/infra/sql-template/generated/agent_definition.mapper.generated.js";
import {agentDefinitionSchema} from "../../model/agent-definition.schema.js";
import type {AgentDefinition} from "../../model/agent-definition.js";
import type {AgentDefinitionRepository} from "../agent-definition.port.js";

/** TDBC-backed agent definition repository. */
export class SqliteAgentDefinitionRepository implements AgentDefinitionRepository {
    private readonly parser = new SqlTemplateParser();

    constructor(private readonly conn: TdbcConnection) {}

    async listIds(): Promise<readonly string[]> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, AgentDefinitionSql.listIds, {});
        return rows.map((row) => String(row.agent_id));
    }

    async get(agentId: string): Promise<Result<AgentDefinition | null, AppError>> {
        const wire = await this.getRawWire(agentId);
        if (wire == null) return Result.ok(null);
        // decode 已 Result 化（错误通道迁移四期）；毒行 decode 失败沿返回值上递
        // （registry.get 收 Err 后由 service 层接力），不再解包抛出。
        return SerializationDecode.decode(wire, agentDefinitionSchema);
    }

    async getRawWire(agentId: string): Promise<unknown | null> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, AgentDefinitionSql.getRawWire, {agentId});
        const row = rows[0];
        return row == null ? null : (JSON.parse(String(row.prompts_json)) as unknown);
    }

    async exists(agentId: string): Promise<boolean> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, AgentDefinitionSql.exists, {agentId});
        return rows.length > 0;
    }

    async upsert(agentId: string, def: AgentDefinition): Promise<Result<void, AppError>> {
        const now = Date.now();
        const wire = SerializationEncode.encode(def, agentDefinitionSchema);
        if (!wire.ok) return Result.err(wire.error);
        const promptsJson = JSON.stringify(wire.value);
        await TdbcTemplate.execute(this.conn, this.parser, AgentDefinitionSql.upsert, {agentId, promptsJson, now});
        return Result.ok(undefined);
    }
    async delete(agentId: string): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, AgentDefinitionSql.delete, {agentId});
    }

    async list(): Promise<Result<readonly AgentDefinition[], AppError>> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, AgentDefinitionSql.list, {});
        // 与旧 throw 契约等价：任一行毒行（decode 失败）即整个列表失败，Err 原样上递。
        const defs: AgentDefinition[] = [];
        for (const row of rows) {
            const decoded = SerializationDecode.decode(JSON.parse(String(row.prompts_json)) as unknown, agentDefinitionSchema);
            if (!decoded.ok) return Result.err(decoded.error);
            defs.push(decoded.value);
        }
        return Result.ok(defs);
    }
}
