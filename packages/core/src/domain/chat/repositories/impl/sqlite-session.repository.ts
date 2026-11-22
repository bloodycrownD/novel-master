/**
 * SQLite chat session repository.
 *
 * @module domain/chat/repositories/impl/sqlite-session.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { Coerce } from "@/common/coerce.js";
import type { ChatSession } from "../../model/session.js";
import type { SessionRepository } from "../session.port.js";
import { BaseSqliteChatRepository } from "./base-sqlite-chat-repository.js";
import { ChatSessionSql, ChatSessionSqlFragments } from "@/infra/sql-template/generated/chat_session.mapper.generated.js";

function rowToSession(row: Row): ChatSession {
    return {
        id: String(row.id),
        projectId: String(row.project_id),
        title: Coerce.nullableText(row.title),
        parentSessionId: Coerce.nullableText(row.parent_session_id),
        createdAtMs: Number(row.created_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
    };
}

/** TDBC-backed `chat_session` repository. */
export class SqliteSessionRepository extends BaseSqliteChatRepository<ChatSession> implements SessionRepository {
    constructor(conn: TdbcConnection) {
        super(conn, {
            table: "chat_session",
            columns: ChatSessionSqlFragments.selectColumns,
            insertSql: ChatSessionSql.insert,
            entityFromRow: rowToSession,
            insertParams: (session) => [session.id, session.projectId, session.title, session.parentSessionId, session.createdAtMs, session.updatedAtMs],
        });
    }

    async listByProject(projectId: string): Promise<ChatSession[]> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, ChatSessionSql.listByProject, { projectId });
        return rows.map(rowToSession);
    }

    async listByParentSession(parentSessionId: string): Promise<ChatSession[]> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, ChatSessionSql.listByParentSession, { parentSessionId });
        return rows.map(rowToSession);
    }

    /** nm-style: keep-public — SessionRepository 端口方法；session.service 单点调用。 */
    async updateTitle(id: string, title: string, updatedAtMs: number): Promise<boolean> {
        const result = await TdbcTemplate.execute(this.conn, this.parser, ChatSessionSql.updateTitle, { id, title, updatedAtMs });
        return result.changes > 0;
    }

    async deleteByProject(projectId: string): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, ChatSessionSql.deleteByProject, { projectId });
    }

    async getComposerDraftJson(id: string): Promise<string | null> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, ChatSessionSql.getComposerDraftJson, { id });
        if (rows.length === 0) {
            return null;
        }
        return Coerce.nullableText(rows[0]!.composer_draft_json);
    }

    async setComposerDraftJson(id: string, draftJson: string | null): Promise<boolean> {
        const result = await TdbcTemplate.execute(this.conn, this.parser, ChatSessionSql.setComposerDraftJson, { id, draftJson });
        return result.changes > 0;
    }

    async getSessionAgentConfig(id: string): Promise<string | null> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, ChatSessionSql.getSessionAgentConfig, { id });
        if (rows.length === 0) {
            return null;
        }
        return Coerce.nullableText(rows[0]!.agent_config_json);
    }

    async setSessionAgentConfig(id: string, agentConfigJson: string | null, updatedAtMs: number): Promise<boolean> {
        // 绑定切换是会话活动（区别于高频草稿写），同步更新 updated_at_ms。
        const result = await TdbcTemplate.execute(this.conn, this.parser, ChatSessionSql.setSessionAgentConfig, { id, agentConfigJson, updatedAtMs });
        return result.changes > 0;
    }
}
