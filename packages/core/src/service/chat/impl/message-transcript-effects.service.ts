/**
 * {@link MessageTranscriptEffectsService} 默认实现。
 *
 * @module service/chat/impl/message-transcript-effects.service
 */

import {
  computeSetFloorRanges,
  isSetFloorAnchorRole,
} from '@/domain/chat/logic/message-set-floor-range.js';
import { chatInvalidArgument, chatNotFound } from '@/errors/chat-errors.js';
import type { TdbcConnection } from '@/infra/tdbc/ports/connection.port.js';
import {
  createTruncateTailDepsFromTx,
  truncateTailInTransaction,
} from '@/service/message-checkpoint/truncate-tail-wiring.js';
import type { SessionKkvService } from '@/service/session-kkv/session-kkv.port.js';
import type { MessageService } from '../message.port.js';
import type {
  MessageTranscriptEffectsService,
  SetMessageFloorResult,
} from '../message-transcript-effects.port.js';

/** {@link DefaultMessageTranscriptEffectsService} 依赖。 */
export interface MessageTranscriptEffectsServiceDeps {
  readonly conn: TdbcConnection;
  readonly messages: MessageService;
  readonly sessionKkv: SessionKkvService;
}

/**
 * 消息 hide / show / tail 截断的统一副作用实现。
 */
export class DefaultMessageTranscriptEffectsService
  implements MessageTranscriptEffectsService
{
  constructor(private readonly deps: MessageTranscriptEffectsServiceDeps) {}

  async hideMessagesInRange(
    _projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number> {
    return this.deps.messages.hideRange(sessionId, fromSeq, toSeq);
  }

  async showMessagesInRange(
    _projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<number> {
    return this.deps.messages.showRange(sessionId, fromSeq, toSeq);
  }

  async truncateMessagesAfter(
    projectId: string,
    sessionId: string,
    afterSeq: number,
    options?: { sweepRevisions?: boolean },
  ): Promise<void> {
    await this.deps.conn.transaction(async tx => {
      await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {
        projectId,
        sessionId,
        afterSeq,
        sweepRevisions: options?.sweepRevisions ?? false,
      });
    });
  }

  async setMessageFloorAtMessage(
    _projectId: string,
    sessionId: string,
    messageId: string,
  ): Promise<SetMessageFloorResult> {
    const messages = await this.deps.messages.listBySession(sessionId);
    const anchor = messages.find(m => m.id === messageId);
    if (anchor == null) {
      throw chatNotFound('message', messageId, { sessionId });
    }
    if (!isSetFloorAnchorRole(anchor.role)) {
      throw chatInvalidArgument(
        `set-floor anchor role must be user, got: ${anchor.role}`,
      );
    }

    const sessionMaxSeq =
      messages.length > 0 ? Math.max(...messages.map(m => m.seq)) : 0;
    const { hidePrefix, showSuffix } = computeSetFloorRanges(
      anchor.seq,
      sessionMaxSeq,
    );

    let hiddenCount = 0;
    let shownCount = 0;
    if (hidePrefix != null) {
      hiddenCount = await this.deps.messages.hideRange(
        sessionId,
        hidePrefix.fromSeq,
        hidePrefix.toSeq,
      );
    }
    if (showSuffix != null) {
      shownCount = await this.deps.messages.showRange(
        sessionId,
        showSuffix.fromSeq,
        showSuffix.toSeq,
      );
    }

    // 置位成功：清空 session kkv，下次 assemble 按新可见域重建常驻前缀
    await this.deps.sessionKkv.clearSession(sessionId);

    return { hiddenCount, shownCount };
  }
}
