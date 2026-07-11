/**
 * 消息 transcript 副作用统一入口（hide / show / tail 截断 + markDirty）。
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
  /** hideRange + markDirty(projectId, sessionId) */
  hideMessagesInRange(
    projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number>;

  /** showRange + markDirty */
  showMessagesInRange(
    projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number>;

  /**
   * 截断 tail：deleteAfterSeq + tail checkpoint 清理 + markDirty。
   * 不做 VFS reconcile；默认不 sweepSessionRevisions（批量删）。
   */
  truncateMessagesAfter(
    projectId: string,
    sessionId: string,
    afterSeq: number,
    options?: { sweepRevisions?: boolean },
  ): Promise<void>;

  /** hide 前缀 + show 后缀 + 单次 markDirty；不 truncate。 */
  setMessageFloorAtMessage(
    projectId: string,
    sessionId: string,
    messageId: string,
  ): Promise<SetMessageFloorResult>;
}
