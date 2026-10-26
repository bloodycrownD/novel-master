/**
 * Message checkpoint domain models (tree index pointers only).
 *
 * @module domain/message-checkpoint/model/message-checkpoint
 */

/** entry_id → revision version pointer at capture time. */
export interface MessageCheckpointFile {
  readonly sessionId: string;
  readonly messageId: string;
  /** 指向 vfs_entry.entry_id；文件改名后历史 checkpoint 仍命中同一 entry。 */
  readonly entryId: number;
  readonly revisionVersion: number;
}

/** Live file head for capture input（entry_id + 逻辑路径 + head 版本）。 */
export interface SessionFileHead {
  readonly entryId: number;
  readonly logicalPath: string;
  readonly headVersion: number;
}
