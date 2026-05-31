/**
 * SQLite session snapshot repository.
 *
 * @module domain/session-fs/repositories/impl/sqlite-snapshot.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { SessionVfsSnapshot } from "../../model/snapshot.js";
import type { SessionSnapshotRepository } from "../snapshot.port.js";

function rowToSnapshot(row: Row): SessionVfsSnapshot {
  return {
    id: Number(row.id),
    sessionId: String(row.session_id),
    logicalPath: String(row.logical_path),
    snapshotRev: Number(row.snapshot_rev),
    content: row.content == null ? null : String(row.content),
    status: String(row.status) as SessionVfsSnapshot["status"],
    vfsVersion: row.vfs_version == null ? null : Number(row.vfs_version),
    createdAtMs: Number(row.created_at_ms),
    createdBy: String(row.created_by),
  };
}

/** TDBC-backed `session_vfs_snapshot` repository. */
export class SqliteSessionSnapshotRepository implements SessionSnapshotRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async nextRev(sessionId: string, logicalPath: string): Promise<number> {
    const rows = await queryTemplate<{ max_rev: number | null }>(
      this.conn,
      this.parser,
      `SELECT MAX(snapshot_rev) AS max_rev FROM session_vfs_snapshot
       WHERE session_id = #{sessionId} AND logical_path = #{logicalPath}`,
      { sessionId, logicalPath },
    );
    const maxRev = rows[0]?.max_rev;
    return maxRev == null ? 1 : Number(maxRev) + 1;
  }

  async insert(snapshot: Omit<SessionVfsSnapshot, "id">): Promise<number> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO session_vfs_snapshot
       (session_id, logical_path, snapshot_rev, content, status, vfs_version, created_at_ms, created_by)
       VALUES (#{sessionId}, #{logicalPath}, #{snapshotRev}, #{content}, #{status}, #{vfsVersion}, #{createdAtMs}, #{createdBy})`,
      {
        sessionId: snapshot.sessionId,
        logicalPath: snapshot.logicalPath,
        snapshotRev: snapshot.snapshotRev,
        content: snapshot.content,
        status: snapshot.status,
        vfsVersion: snapshot.vfsVersion,
        createdAtMs: snapshot.createdAtMs,
        createdBy: snapshot.createdBy,
      },
    );
    return Number(result.lastInsertRowid);
  }

  async listByPath(
    sessionId: string,
    logicalPath: string,
  ): Promise<SessionVfsSnapshot[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, session_id, logical_path, snapshot_rev, content, status, vfs_version, created_at_ms, created_by
       FROM session_vfs_snapshot
       WHERE session_id = #{sessionId} AND logical_path = #{logicalPath}
       ORDER BY snapshot_rev ASC`,
      { sessionId, logicalPath },
    );
    return rows.map(rowToSnapshot);
  }

  async findByRev(
    sessionId: string,
    logicalPath: string,
    snapshotRev: number,
  ): Promise<SessionVfsSnapshot | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, session_id, logical_path, snapshot_rev, content, status, vfs_version, created_at_ms, created_by
       FROM session_vfs_snapshot
       WHERE session_id = #{sessionId} AND logical_path = #{logicalPath} AND snapshot_rev = #{snapshotRev}`,
      { sessionId, logicalPath, snapshotRev },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToSnapshot(rows[0]!);
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_vfs_snapshot WHERE session_id = #{sessionId}`,
      { sessionId },
    );
  }

  async deleteAfterBatch(
    sessionId: string,
    batchCreatedAtMs: number,
  ): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM session_vfs_snapshot
       WHERE session_id = #{sessionId} AND created_at_ms >= #{batchCreatedAtMs}`,
      { sessionId, batchCreatedAtMs },
    );
  }
}
