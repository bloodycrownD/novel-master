/**
 * 消息 transcript 副作用统一入口（tail 截断 / 置位）。
 *
 * hide / show 不在这里：它们是 `MessageService.hideRange` / `showRange` 的
 * 纯委托包装，runtime 已直接暴露 messages，调用方直连即可。
 *
 * @module service/chat/message-transcript-effects.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/** 消息置位操作结果。 */
export interface SetMessageFloorResult {
  readonly hiddenCount: number;
  readonly shownCount: number;
}

/** 消息 tail 截断 / 置位的统一副作用服务。 */
export interface MessageTranscriptEffectsService {
  /**
   * 截断 tail：deleteAfterSeq + tail checkpoint 清理（共享 `truncateTailInTransaction`）。
   * 不做 VFS reconcile；默认不 sweepSessionRevisions（批量删）；不 capture worktree 块。
   * 与 `MessageService.truncateAfter` 同口径失效 prompt token 缓存。
   */
  truncateMessagesAfter(
    projectId: string,
    sessionId: string,
    afterSeq: number,
    options?: { sweepRevisions?: boolean }
  ): Promise<void>;

  /** hide 前缀 + show 后缀；不 truncate；不 capture worktree 块。 */
  setMessageFloorAtMessage(
    projectId: string,
    sessionId: string,
    messageId: string
  ): Promise<Result<SetMessageFloorResult, AppError>>;
}
