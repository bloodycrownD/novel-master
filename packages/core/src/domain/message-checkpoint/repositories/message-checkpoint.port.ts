/**
 * Message checkpoint repository port.
 *
 * @module domain/message-checkpoint/repositories/message-checkpoint.port
 */

import type { MessageCheckpointFile } from "../model/message-checkpoint.js";

/** 会话内去重后的 checkpoint 文件指针（不含 message_id，供 revision GC 可达集）。 */
export type MessageCheckpointDistinctPointer = {
  readonly entryId: number;
  readonly revisionVersion: number;
};

/** Input for inserting a checkpoint tree. */
export interface MessageCheckpointInsertInput {
  readonly sessionId: string;
  readonly messageId: string;
  readonly createdAtMs: number;
  readonly files: ReadonlyArray<{
    readonly entryId: number;
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
   * 批量播种 checkpoint（seed 场景专用：目标 session 全新，无需 DELETE 旧行）。
   *
   * 一次性写入所有消息的锚点行 + 文件行，并对每个文件指针的 revision ref_count
   * 批量 +count（count = 消息数）。比循环调 insertCheckpoint 快一到两个数量级。
   *
   * @param sessionId  目标会话
   * @param messages   要挂 checkpoint 的消息 ID 列表
   * @param files      文件指针列表（所有消息共享同一组文件树快照）
   * @param createdAtMs 创建时间戳
   *
   * @remarks 仅用于 fork/copy 的 seed 路径；capture 路径仍走 insertCheckpoint（需要处理旧行）。
   */
  seedCheckpoints(
    sessionId: string,
    messages: ReadonlyArray<{ readonly id: string }>,
    files: ReadonlyArray<{
      readonly entryId: number;
      readonly revisionVersion: number;
    }>,
    createdAtMs: number,
  ): Promise<void>;

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

  /**
   * 列出会话内 DISTINCT (logical_path, revision_version)（revision GC 可达集）。
   *
   * @remarks 不含 message_id；同一路径版本在多 checkpoint 中重复时只计一次。
   */
  listDistinctCheckpointPointersForSession(
    sessionId: string,
  ): Promise<ReadonlyArray<MessageCheckpointDistinctPointer>>;

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
