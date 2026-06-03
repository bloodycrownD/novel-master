/**
 * SQLite session execute repository.
 *
 * @module domain/session-fs/repositories/impl/sqlite-execute.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type {
  SessionExecuteAction,
  SessionExecuteBatch,
  SessionExecuteCheckpoint,
} from "../../model/execute-batch.js";
import type { SessionExecuteRepository } from "../execute.port.js";

function rowToBatch(row: Row): SessionExecuteBatch {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    createdAtMs: Number(row.created_at_ms),
    createdBy: String(row.created_by),
    messageId: row.message_id == null ? null : String(row.message_id),
  };
}

function rowToAction(row: Row): SessionExecuteAction {
  return {
    batchId: String(row.batch_id),
    seq: Number(row.seq),
    function: String(row.function) as SessionExecuteAction["function"],
    logicalPath: String(row.logical_path),
    payloadJson: row.payload_json == null ? null : String(row.payload_json),
  };
}

function rowToCheckpoint(row: Row): SessionExecuteCheckpoint {
  return {
    batchId: String(row.batch_id),
    logicalPath: String(row.logical_path),
    snapshotRev: Number(row.snapshot_rev),
    vfsVersion: row.vfs_version == null ? null : Number(row.vfs_version),
    createdAtMs: Number(row.created_at_ms),
    createdBy: String(row.created_by),
  };
}

/** TDBC-backed execute batch repository. */
export class SqliteSessionExecuteRepository implements SessionExecuteRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async insertBatch(batch: SessionExecuteBatch): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO session_execute_batch (id, session_id, created_at_ms, created_by, message_id)
       VALUES (#{id}, #{sessionId}, #{createdAtMs}, #{createdBy}, #{messageId})`,
      {
        id: batch.id,
        sessionId: batch.sessionId,
        createdAtMs: batch.createdAtMs,
        createdBy: batch.createdBy,
        messageId: batch.messageId ?? null,
      },
    );
  }

  async insertAction(action: SessionExecuteAction): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO session_execute_action (batch_id, seq, function, logical_path, payload_json)
       VALUES (#{batchId}, #{seq}, #{function}, #{logicalPath}, #{payloadJson})`,
      {
        batchId: action.batchId,
        seq: action.seq,
        function: action.function,
        logicalPath: action.logicalPath,
        payloadJson: action.payloadJson,
      },
    );
  }

  async insertCheckpoint(checkpoint: SessionExecuteCheckpoint): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO session_execute_checkpoint
       (batch_id, logical_path, snapshot_rev, vfs_version, created_at_ms, created_by)
       VALUES (#{batchId}, #{logicalPath}, #{snapshotRev}, #{vfsVersion}, #{createdAtMs}, #{createdBy})`,
      {
        batchId: checkpoint.batchId,
        logicalPath: checkpoint.logicalPath,
        snapshotRev: checkpoint.snapshotRev,
        vfsVersion: checkpoint.vfsVersion,
        createdAtMs: checkpoint.createdAtMs,
        createdBy: checkpoint.createdBy,
      },
    );
  }

  async listBatches(sessionId: string): Promise<SessionExecuteBatch[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, session_id, created_at_ms, created_by, message_id FROM session_execute_batch
       WHERE session_id = #{sessionId} ORDER BY created_at_ms DESC`,
      { sessionId },
    );
    return rows.map(rowToBatch);
  }

  async findBatch(id: string): Promise<SessionExecuteBatch | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, session_id, created_at_ms, created_by, message_id FROM session_execute_batch WHERE id = #{id}`,
      { id },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToBatch(rows[0]!);
  }

  async listActions(batchId: string): Promise<SessionExecuteAction[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT batch_id, seq, function, logical_path, payload_json
       FROM session_execute_action WHERE batch_id = #{batchId} ORDER BY seq ASC`,
      { batchId },
    );
    return rows.map(rowToAction);
  }

  async listCheckpoints(batchId: string): Promise<SessionExecuteCheckpoint[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT batch_id, logical_path, snapshot_rev, vfs_version, created_at_ms, created_by
       FROM session_execute_checkpoint WHERE batch_id = #{batchId}
       ORDER BY logical_path DESC`,
      { batchId },
    );
    return rows.map(rowToCheckpoint);
  }

  async maxActionSeq(batchId: string): Promise<number> {
    const rows = await queryTemplate<{ max_seq: number | null }>(
      this.conn,
      this.parser,
      `SELECT MAX(seq) AS max_seq FROM session_execute_action WHERE batch_id = #{batchId}`,
      { batchId },
    );
    const maxSeq = rows[0]?.max_seq;
    return maxSeq == null ? -1 : Number(maxSeq);
  }

  async deleteBatch(batchId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_execute_checkpoint WHERE batch_id = #{batchId}`,
      { batchId },
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_execute_action WHERE batch_id = #{batchId}`,
      { batchId },
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_execute_batch WHERE id = #{batchId}`,
      { batchId },
    );
  }

  async deleteBySession(sessionId: string): Promise<void> {
    const batches = await this.listBatches(sessionId);
    for (const batch of batches) {
      await this.deleteBatch(batch.id);
    }
  }
}
