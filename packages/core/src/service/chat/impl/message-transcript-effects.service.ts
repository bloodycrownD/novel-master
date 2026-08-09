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
import { sessionApiPromptTokenCache } from '@/infra/tokenizer/logic/session-api-prompt-token-cache.js';
import type { TdbcConnection } from '@/infra/tdbc/ports/connection.port.js';
import { CoordinatedWrite } from '@/service/coordinated-write.js';
import {
  createTruncateTailDepsFromTx,
  truncateTailInTransaction,
} from '@/service/message-checkpoint/truncate-tail-wiring.js';
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from '@/domain/session-kkv/model/session-kkv-domains.js';
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

    // S-1：hideRange / showRange / clearDomain×2 四步跨资源写塞进 CoordinatedWrite。
    // hide/show 的补偿是反向 range 操作，恢复可见性计数一致；
    // rule_snapshot / file_cache 是纯缓存，清空后无法精确重建，按 best-effort no-op 处理。
    const write = new CoordinatedWrite();
    if (hidePrefix != null) {
      write.register({
        name: 'hide-prefix',
        execute: async () => {
          hiddenCount = await this.deps.messages.hideRange(
            sessionId,
            hidePrefix.fromSeq,
            hidePrefix.toSeq,
          );
        },
        rollback: async () => {
          await this.deps.messages.showRange(
            sessionId,
            hidePrefix.fromSeq,
            hidePrefix.toSeq,
          );
        },
      });
    }
    if (showSuffix != null) {
      write.register({
        name: 'show-suffix',
        execute: async () => {
          shownCount = await this.deps.messages.showRange(
            sessionId,
            showSuffix.fromSeq,
            showSuffix.toSeq,
          );
        },
        rollback: async () => {
          await this.deps.messages.hideRange(
            sessionId,
            showSuffix.fromSeq,
            showSuffix.toSeq,
          );
        },
      });
    }
    write.register({
      name: 'clear-rule-snapshot',
      execute: async () => {
        await this.deps.sessionKkv.clearDomain(
          sessionId,
          SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
        );
      },
      rollback: async () => {
        // rule_snapshot 是缓存快照，清空后无法重建原值；丢失只触发下次重算，不影响一致性。
      },
    });
    write.register({
      name: 'clear-file-cache',
      execute: async () => {
        await this.deps.sessionKkv.clearDomain(
          sessionId,
          SESSION_KKV_DOMAIN_FILE_CACHE,
        );
      },
      rollback: async () => {
        // file_cache 同为缓存，best-effort 不补偿。
      },
    });
    await write.run();
    sessionApiPromptTokenCache.invalidate(sessionId);

    return { hiddenCount, shownCount };
  }
}
