/**
 * Session file system service port (execute, snapshots, rollback).
 *
 * @module service/session-fs/session-fs.port
 */

/** Actor for session file operations. */
export type SessionFsActor = "user" | "assistant" | "system";

/** A single action in an execute batch. */
export type SessionFsAction =
  | { function: "read"; path: string }
  | { function: "write"; path: string; content: string }
  | { function: "delete"; path: string };

/** Options for {@link SessionFsService.execute}. */
export interface SessionFsExecuteOptions {
  /** Default true; when false, writes skip optimistic version checks. */
  readonly versionCheck?: boolean;
  /** CAS version for writes; forwarded to VFS when set (e.g. from `vfs.write` tool). */
  readonly expectedVersion?: number;
}

/** Result of a successful execute batch. */
export interface SessionFsExecuteResult {
  readonly batchId: string;
  readonly results: ReadonlyArray<
    | { function: "read"; path: string; content: string }
    | { function: "write"; path: string; version: number }
    | { function: "delete"; path: string }
  >;
}

/** Summary of an execute batch for listing. */
export interface SessionFsBatchSummary {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAtMs: number;
  readonly createdBy: string;
}

/** Snapshot list entry. */
export interface SessionFsSnapshotSummary {
  readonly snapshotRev: number;
  readonly status: "active" | "deleted";
  readonly vfsVersion: number | null;
  readonly createdAtMs: number;
  readonly createdBy: string;
}

/**
 * Session-scoped file operations with hidden versioning and rollback.
 */
export interface SessionFsService {
  execute(
    sessionId: string,
    projectId: string,
    actions: SessionFsAction[],
    actor: SessionFsActor,
    options?: SessionFsExecuteOptions,
  ): Promise<SessionFsExecuteResult>;

  listBatches(sessionId: string): Promise<SessionFsBatchSummary[]>;

  rollbackBatch(
    sessionId: string,
    projectId: string,
    batchId: string,
  ): Promise<void>;

  listSnapshots(
    sessionId: string,
    logicalPath: string,
  ): Promise<SessionFsSnapshotSummary[]>;

  rollbackSnapshot(
    sessionId: string,
    projectId: string,
    logicalPath: string,
    snapshotRev: number,
  ): Promise<void>;
}
