/**
 * Session VFS snapshot repository port.
 *
 * @module domain/session-fs/repositories/snapshot.port
 */

import type { SessionVfsSnapshot, SnapshotStatus } from "../model/snapshot.js";

/** Persistence for `session_vfs_snapshot` rows. */
export interface SessionSnapshotRepository {
  nextRev(sessionId: string, logicalPath: string): Promise<number>;

  insert(snapshot: Omit<SessionVfsSnapshot, "id">): Promise<number>;

  listByPath(sessionId: string, logicalPath: string): Promise<SessionVfsSnapshot[]>;

  findByRev(
    sessionId: string,
    logicalPath: string,
    snapshotRev: number,
  ): Promise<SessionVfsSnapshot | null>;

  deleteBySession(sessionId: string): Promise<void>;

  deleteAfterBatch(sessionId: string, batchCreatedAtMs: number): Promise<void>;
}

/** Input for creating a snapshot row. */
export type SnapshotInsert = {
  readonly sessionId: string;
  readonly logicalPath: string;
  readonly snapshotRev: number;
  readonly content: string | null;
  readonly status: SnapshotStatus;
  readonly vfsVersion: number | null;
  readonly createdAtMs: number;
  readonly createdBy: string;
};
