/**
 * 消息 transcript 副作用统一入口（hide / show / tail 截断）。
 *
 * @module service/chat/message-transcript-effects.port
 */

/** 消息置位操作结果。 */
export interface SetMessageFloorResult {
  readonly hiddenCount: number;
  readonly shownCount: number;
}

/** 消息 hide / show / tail 截断的统一副作用服务。 */
export interface MessageTranscriptEffectsService {
  /** hideRange（不 capture worktree 块）。 */
  hideMessagesInRange(
    projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number>;

  /** showRange（不 capture worktree 块）。 */
  showMessagesInRange(
    projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number>;

  /**
   * 截断 tail：deleteAfterSeq + tail checkpoint 清理。
   * 不做 VFS reconcile；默认不 sweepSessionRevisions（批量删）；不 capture worktree 块。
   */
  truncateMessagesAfter(
    projectId: string,
    sessionId: string,
    afterSeq: number,
    options?: { sweepRevisions?: boolean },
  ): Promise<void>;

  /** hide 前缀 + show 后缀；不 truncate；不 capture worktree 块。 */
  setMessageFloorAtMessage(
    projectId: string,
    sessionId: string,
    messageId: string,
  ): Promise<SetMessageFloorResult>;
}
