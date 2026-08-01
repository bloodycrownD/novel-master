/**
 * SQLite implementation of {@link MessageCheckpointRepository}.
 *
 * entry_id 化后 `message_checkpoint_file` 用 `entry_id` 指向 vfs_entry；`loadFileTree`
 * 经 JOIN 取当前 path 返回 `Map<logicalPath, version>`（rename 后仍指向同一 entry，路径
 * 随当前 vfs_entry.path 变化）。ref_count 增减直接吃 entryId，不再需要 scope 映射。
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
import {
  decrementRefsForCheckpointFiles,
  incrementRefsForCheckpointFiles,
} from "@/domain/vfs/logic/revision-ref-count.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { MessageCheckpointFile } from "../../model/message-checkpoint.js";
import type {
  MessageCheckpointDistinctPointer,
  MessageCheckpointInsertInput,
  MessageCheckpointRepository,
} from "../message-checkpoint.port.js";

function rowToFilePointer(row: Row): MessageCheckpointFile {
  return {
    sessionId: String(row.session_id),
    messageId: String(row.message_id),
    entryId: Number(row.entry_id),
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

  async hasAnyCheckpointForSession(sessionId: string): Promise<boolean> {
    const rows = await queryTemplate<{ one: number }>(
      this.conn,
      this.parser,
      `SELECT 1 AS one FROM message_checkpoint
       WHERE session_id = #{sessionId}
       LIMIT 1`,
      { sessionId },
    );
    return rows.length > 0;
  }

  async insertCheckpoint(input: MessageCheckpointInsertInput): Promise<void> {
    const revisionRepo = new SqliteVfsRevisionRepository(this.conn);

    const oldRows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT session_id, message_id, entry_id, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId} AND message_id = #{messageId}`,
      { sessionId: input.sessionId, messageId: input.messageId },
    );
    if (oldRows.length > 0) {
      await decrementRefsForCheckpointFiles(
        revisionRepo,
        oldRows.map((row) => rowToFilePointer(row)),
      );
    }

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
         (session_id, message_id, entry_id, revision_version)
         VALUES (#{sessionId}, #{messageId}, #{entryId}, #{revisionVersion})`,
        {
          sessionId: input.sessionId,
          messageId: input.messageId,
          entryId: file.entryId,
          revisionVersion: file.revisionVersion,
        },
      );
    }

    if (input.files.length > 0) {
      await incrementRefsForCheckpointFiles(
        revisionRepo,
        input.files.map((file) => ({
          entryId: file.entryId,
          revisionVersion: file.revisionVersion,
        })),
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
      path: string;
      revision_version: number;
    }>(
      this.conn,
      this.parser,
      `SELECT e.path AS path, mcf.revision_version AS revision_version
       FROM message_checkpoint_file mcf
       JOIN vfs_entry e ON e.entry_id = mcf.entry_id
       WHERE mcf.session_id = #{sessionId} AND mcf.message_id = #{messageId}`,
      { sessionId, messageId },
    );
    const tree = new Map<string, number>();
    for (const row of rows) {
      tree.set(String(row.path), Number(row.revision_version));
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
      `SELECT session_id, message_id, entry_id, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId}`,
      { sessionId },
    );
    return rows.map((row) => rowToFilePointer(row));
  }

  async listDistinctCheckpointPointersForSession(
    sessionId: string,
  ): Promise<ReadonlyArray<MessageCheckpointDistinctPointer>> {
    const rows = await queryTemplate<{
      entry_id: number;
      revision_version: number;
    }>(
      this.conn,
      this.parser,
      `SELECT DISTINCT entry_id, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId}`,
      { sessionId },
    );
    return rows.map((row) => ({
      entryId: Number(row.entry_id),
      revisionVersion: Number(row.revision_version),
    }));
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
      `SELECT session_id, message_id, entry_id, revision_version
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
    const revisionRepo = new SqliteVfsRevisionRepository(this.conn);
    const bindings = Object.fromEntries(
      messageIds.map((id, i) => [`id${i}`, id]),
    );
    const inClause = messageIds.map((_, i) => `#{id${i}}`).join(", ");

    const fileRows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT session_id, message_id, entry_id, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId} AND message_id IN (${inClause})`,
      { sessionId, ...bindings },
    );
    if (fileRows.length > 0) {
      await decrementRefsForCheckpointFiles(
        revisionRepo,
        fileRows.map((row) => rowToFilePointer(row)),
      );
    }

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
    const revisionRepo = new SqliteVfsRevisionRepository(this.conn);
    const fileRows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT session_id, message_id, entry_id, revision_version
       FROM message_checkpoint_file
       WHERE session_id = #{sessionId}`,
      { sessionId },
    );
    if (fileRows.length > 0) {
      await decrementRefsForCheckpointFiles(
        revisionRepo,
        fileRows.map((row) => rowToFilePointer(row)),
      );
    }

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
