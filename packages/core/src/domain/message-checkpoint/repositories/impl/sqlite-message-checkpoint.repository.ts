/**
 * SQLite implementation of {@link MessageCheckpointRepository}.
 *
 * @module domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { Row } from "@/infra/tdbc/types.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { MessageCheckpointFile } from "../../model/message-checkpoint.js";
import type {
  MessageCheckpointInsertInput,
  MessageCheckpointRepository,
} from "../message-checkpoint.port.js";

function rowToFilePointer(row: Row): MessageCheckpointFile {
  return {
    sessionId: String(row.session_id),
    messageId: String(row.message_id),
    logicalPath: String(row.logical_path),
    revisionVersion: Number(row.revision_version),
  };
}

/**
 * TDBC-backed message checkpoint repository.
 */
export class SqliteMessageCheckpointRepository
  implements MessageCheckpointRepository
{
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async hasCheckpoint(sessionId: string, messageId: string): Promise<boolean> {
    const rows = await queryTemplate<{ one: number }>(
      this.conn,
      this.parser,
      `SELECT 1 AS one FROM message_checkpoint
       WHERE session_id = #{sessionId} AND message_id = #{messageId}
       LIMIT 1`,
      { sessionId, messageId },
    );
    return rows.length > 0;
  }

  async insertCheckpoint(input: MessageCheckpointInsertInput): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM message_checkpoint_file
       WHERE session_id = #{sessionId} AND message_id = #{messageId}`,
      { sessionId: input.sessionId, messageId: input.messageId },
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM message_checkpoint
       WHERE session_id = #{sessionId} AND message_id = #{messageId}`,
      { sessionId: input.sessionId, messageId: input.messageId },
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO message_checkpoint (session_id, message_id, created_at_ms)
       VALUES (#{sessionId}, #{messageId}, #{createdAtMs})`,
      {
        sessionId: input.sessionId,
        messageId: input.messageId,
        createdAtMs: input.createdAtMs,
      },
    );
    for (const file of input.files) {
      await executeTemplate(
        this.conn,
        this.parser,
        `INSERT INTO message_checkpoint_file
         (session_id, message_id, logical_path, revision_version)
         VALUES (#{sessionId}, #{messageId}, #{logicalPath}, #{revisionVersion})`,
        {
          sessionId: input.sessionId,
          messageId: input.messageId,
          logicalPath: normalizePath(file.logicalPath),
          revisionVersion: file.revisionVersion,
        },
      );
    }
  }

  async loadFileTree(
    sessionId: string,
    messageId: string,
  ): Promise<Map<string, number> | null> {
    const has = await this.hasCheckpoint(sessionId, messageId);
    if (!has) {
      return null;
    }
    const rows = await queryTemplate<{
      logical_path: string;
      revision_version: number;
    }>(
      this.conn,
      this.parser,
      `SELECT logical_path, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId} AND message_id = #{messageId}`,
      { sessionId, messageId },
    );
    const tree = new Map<string, number>();
    for (const row of rows) {
      tree.set(String(row.logical_path), Number(row.revision_version));
    }
    return tree;
  }

  async findCheckpointMessageIdAtOrBefore(
    sessionId: string,
    maxSeq: number,
  ): Promise<string | null> {
    const rows = await queryTemplate<{ message_id: string }>(
      this.conn,
      this.parser,
      `SELECT mc.message_id
       FROM message_checkpoint mc
       JOIN chat_message cm
         ON cm.id = mc.message_id AND cm.session_id = mc.session_id
       WHERE mc.session_id = #{sessionId} AND cm.seq <= #{maxSeq}
       ORDER BY cm.seq DESC
       LIMIT 1`,
      { sessionId, maxSeq },
    );
    return rows.length === 0 ? null : String(rows[0]!.message_id);
  }

  async listFilePointersForSession(
    sessionId: string,
  ): Promise<ReadonlyArray<MessageCheckpointFile>> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT session_id, message_id, logical_path, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId}`,
      { sessionId },
    );
    return rows.map((row) => rowToFilePointer(row));
  }

  async listFilePointersForMessages(
    sessionId: string,
    messageIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<MessageCheckpointFile>> {
    if (messageIds.length === 0) {
      return [];
    }
    const idBindings = Object.fromEntries(
      messageIds.map((id, i) => [`id${i}`, id]),
    );
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT session_id, message_id, logical_path, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId}
         AND message_id IN (${messageIds.map((_, i) => `#{id${i}}`).join(", ")})`,
      { sessionId, ...idBindings },
    );
    return rows.map((row) => rowToFilePointer(row));
  }

  async deleteCheckpointsForMessages(
    sessionId: string,
    messageIds: ReadonlyArray<string>,
  ): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }
    const bindings = Object.fromEntries(
      messageIds.map((id, i) => [`id${i}`, id]),
    );
    const inClause = messageIds.map((_, i) => `#{id${i}}`).join(", ");
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM message_checkpoint_file
       WHERE session_id = #{sessionId} AND message_id IN (${inClause})`,
      { sessionId, ...bindings },
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM message_checkpoint
       WHERE session_id = #{sessionId} AND message_id IN (${inClause})`,
      { sessionId, ...bindings },
    );
  }

  async deleteCheckpointsForSession(sessionId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM message_checkpoint_file WHERE session_id = #{sessionId}`,
      { sessionId },
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM message_checkpoint WHERE session_id = #{sessionId}`,
      { sessionId },
    );
  }
}
