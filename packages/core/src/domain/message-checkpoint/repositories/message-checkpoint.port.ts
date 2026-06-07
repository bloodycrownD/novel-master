/**
 * Message checkpoint repository port.
 *
 * @module domain/message-checkpoint/repositories/message-checkpoint.port
 */

import type { MessageCheckpointFile } from "../model/message-checkpoint.js";

/** Input for inserting a checkpoint tree. */
export interface MessageCheckpointInsertInput {
  readonly sessionId: string;
  readonly messageId: string;
  readonly createdAtMs: number;
  readonly files: ReadonlyArray<{
    readonly logicalPath: string;
    readonly revisionVersion: number;
  }>;
}

/**
 * Persistence for `message_checkpoint` and `message_checkpoint_file` rows.
 */
export interface MessageCheckpointRepository {
  /** Returns whether a checkpoint row exists for the message. */
  hasCheckpoint(sessionId: string, messageId: string): Promise<boolean>;

  /** Returns whether the session has any message checkpoint rows. */
  hasAnyCheckpointForSession(sessionId: string): Promise<boolean>;

  /**
   * Inserts checkpoint anchor + file pointers (replaces existing rows for the message).
   */
  insertCheckpoint(input: MessageCheckpointInsertInput): Promise<void>;

  /**
   * Loads the file tree for a message checkpoint.
   *
   * @returns `null` when no checkpoint exists for the message.
   */
  loadFileTree(
    sessionId: string,
    messageId: string,
  ): Promise<Map<string, number> | null>;

  /**
   * Finds the message id of the nearest checkpoint at or before `maxSeq`.
   *
   * @returns `null` when no checkpoint exists in range.
   */
  findCheckpointMessageIdAtOrBefore(
    sessionId: string,
    maxSeq: number,
  ): Promise<string | null>;

  /** Lists all file pointers for a session (used by revision GC). */
  listFilePointersForSession(
    sessionId: string,
  ): Promise<ReadonlyArray<MessageCheckpointFile>>;

  /** Lists file pointers for specific messages (used during rollback diff). */
  listFilePointersForMessages(
    sessionId: string,
    messageIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<MessageCheckpointFile>>;

  /** Deletes checkpoint rows for the given messages. */
  deleteCheckpointsForMessages(
    sessionId: string,
    messageIds: ReadonlyArray<string>,
  ): Promise<void>;

  /** Deletes all checkpoint rows for a session (used on session delete). */
  deleteCheckpointsForSession(sessionId: string): Promise<void>;
}
