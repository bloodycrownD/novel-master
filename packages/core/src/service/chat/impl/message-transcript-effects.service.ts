/**
 * {@link MessageTranscriptEffectsService} 默认实现。
 *
 * @module service/chat/impl/message-transcript-effects.service
 */

import {
  truncateTailDepsFromTx,
  truncateTailInTransaction,
} from "@/domain/message-checkpoint/logic/truncate-tail-in-transaction.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { markSessionWorktreeDirty } from "@/service/prompt/logic/mark-session-worktree-dirty.js";
import type { SessionWorktreeSnapshotStore } from "@/service/prompt/session-worktree-snapshot.port.js";
import type { MessageService } from "../message.port.js";
import type { MessageTranscriptEffectsService } from "../message-transcript-effects.port.js";

/** {@link DefaultMessageTranscriptEffectsService} 依赖。 */
export interface MessageTranscriptEffectsServiceDeps {
  readonly conn: TdbcConnection;
  readonly messages: MessageService;
  readonly worktreeSnapshot: SessionWorktreeSnapshotStore;
}

/**
 * 消息 hide / show / tail 截断的统一副作用实现。
 */
export class DefaultMessageTranscriptEffectsService
  implements MessageTranscriptEffectsService
{
  constructor(private readonly deps: MessageTranscriptEffectsServiceDeps) {}

  async hideMessagesInRange(
    projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number> {
    const count = await this.deps.messages.hideRange(sessionId, fromSeq, toSeq);
    markSessionWorktreeDirty(
      this.deps.worktreeSnapshot,
      projectId,
      sessionId,
    );
    return count;
  }

  async showMessagesInRange(
    projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number> {
    const count = await this.deps.messages.showRange(sessionId, fromSeq, toSeq);
    markSessionWorktreeDirty(
      this.deps.worktreeSnapshot,
      projectId,
      sessionId,
    );
    return count;
  }

  async truncateMessagesAfter(
    projectId: string,
    sessionId: string,
    afterSeq: number,
    options?: { sweepRevisions?: boolean },
  ): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
      await truncateTailInTransaction(
        tx,
        truncateTailDepsFromTx(tx),
        {
          projectId,
          sessionId,
          afterSeq,
          sweepRevisions: options?.sweepRevisions ?? false,
        },
      );
    });
    markSessionWorktreeDirty(
      this.deps.worktreeSnapshot,
      projectId,
      sessionId,
    );
  }
}
