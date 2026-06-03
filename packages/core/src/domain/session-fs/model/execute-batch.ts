/**
 * Session execute batch model.
 *
 * @module domain/session-fs/model/execute-batch
 */

/** A batch of session file operations. */
export interface SessionExecuteBatch {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAtMs: number;
  readonly createdBy: string;
  /** Assistant message id when batch was opened from an agent round; null for legacy/script batches. */
  readonly messageId?: string | null;
}

/** A single action within an execute batch. */
export interface SessionExecuteAction {
  readonly batchId: string;
  readonly seq: number;
  readonly function: "read" | "write" | "delete";
  readonly logicalPath: string;
  readonly payloadJson: string | null;
}

/** Pre-execution checkpoint for rollback. */
export interface SessionExecuteCheckpoint {
  readonly batchId: string;
  readonly logicalPath: string;
  readonly snapshotRev: number;
  readonly vfsVersion: number | null;
  readonly createdAtMs: number;
  readonly createdBy: string;
}
