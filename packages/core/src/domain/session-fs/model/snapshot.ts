/**
 * Session VFS snapshot model.
 *
 * @module domain/session-fs/model/snapshot
 */

/** Snapshot row status. */
export type SnapshotStatus = "active" | "deleted";

/** A path-level version snapshot within a session. */
export interface SessionVfsSnapshot {
  readonly id: number;
  readonly sessionId: string;
  readonly logicalPath: string;
  readonly snapshotRev: number;
  readonly content: string | null;
  readonly status: SnapshotStatus;
  readonly vfsVersion: number | null;
  readonly createdAtMs: number;
  readonly createdBy: string;
}
