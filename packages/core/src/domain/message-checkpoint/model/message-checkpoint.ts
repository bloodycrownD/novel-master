/**
 * Message checkpoint domain models (tree index pointers only).
 *
 * @module domain/message-checkpoint/model/message-checkpoint
 */

/** Anchor row for one Agent message with mutating tools. */
export interface MessageCheckpoint {
  readonly sessionId: string;
  readonly messageId: string;
  readonly createdAtMs: number;
}

/** File path → revision version pointer at capture time. */
export interface MessageCheckpointFile {
  readonly sessionId: string;
  readonly messageId: string;
  readonly logicalPath: string;
  readonly revisionVersion: number;
}

/** Logical path and head revision version for capture input. */
export interface SessionFileHead {
  readonly logicalPath: string;
  readonly headVersion: number;
}
