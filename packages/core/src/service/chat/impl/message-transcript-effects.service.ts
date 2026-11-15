/**
 * {@link MessageTranscriptEffectsService} 默认实现。
 *
 * @module service/chat/impl/message-transcript-effects.service
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { invalidateSessionApiPromptTokenEntry } from "@/infra/tokenizer/logic/session-api-prompt-token-store.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { CoordinatedWrite } from "@/service/coordinated-write.js";
import {
  createTruncateTailDepsFromTx,
  truncateTailInTransaction,
} from "@/service/message-checkpoint/truncate-tail-wiring.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { MessageService } from "../message.port.js";
import type {
  MessageTranscriptEffectsService,
  SetMessageFloorResult,
} from "../message-transcript-effects.port.js";

/** {@link DefaultMessageTranscriptEffectsService} 依赖。 */
interface MessageTranscriptEffectsServiceDeps {
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
    toSeq: number
  ): Promise<Result<number, AppError>> {
    return this.deps.messages.hideRange(sessionId, fromSeq, toSeq);
  }

  async showMessagesInRange(
    _projectId: string,
    sessionId: string,
    fromSeq: number,
    toSeq: number
  ): Promise<Result<number, AppError>> {
    return this.deps.messages.showRange(sessionId, fromSeq, toSeq);
  }

  async truncateMessagesAfter(
    projectId: string,
    sessionId: string,
    afterSeq: number,
    options?: { sweepRevisions?: boolean }
  ): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
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
    messageId: string
  ): Promise<Result<SetMessageFloorResult, AppError>> {
    // 读路径（2026-09-29 治本）：原先全量 listBySession（大会话连解压秒级）
    // 只为找锚点 + 算 MAX(seq)——锚点单行 get，MAX(seq) 用尾部一条（含
    // hidden、按 seq 取最大，与原口径一致）。
    const anchorResult = await this.deps.messages.get(messageId);
    if (!anchorResult.ok) {
      // get 的 not-found 不带会话上下文，包回原错误形态（含 sessionId）。
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `message not found: ${messageId}`, kind: "message", id: messageId, sessionId, messageId }));
    }
    const anchor = anchorResult.value;
    // 锚点必须归属本会话：get 全局按 id 查，跨会话传入他会话的合法消息 id
    // 会拿他会话的 seq 对本会话错误范围执行 hide/show，按旧实现的 404 口径拦下。
    if (anchor.sessionId !== sessionId) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `message not found: ${messageId}`, kind: "message", id: messageId, sessionId, messageId }));
    }
    if (anchor.role !== "user") {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { detail: `set-floor anchor role must be user, got: ${anchor.role}` }));
    }

    const tail = await this.deps.messages.listBySessionTail(sessionId, {
      limit: 1,
    });
    const sessionMaxSeq = tail.length > 0 ? tail[0]!.seq : 0;
    const hidePrefix = anchor.seq > 1 ? { fromSeq: 1 as const, toSeq: anchor.seq - 1 } : null;
    const showSuffix = anchor.seq <= sessionMaxSeq ? { fromSeq: anchor.seq, toSeq: sessionMaxSeq } : null;

    let hiddenCount = 0;
    let shownCount = 0;

    // S-1：hideRange / showRange / clearDomain×2 四步跨资源写塞进 CoordinatedWrite。
    // hide/show 的补偿是反向 range 操作，恢复可见性计数一致；
    // rule_snapshot / file_cache 是纯缓存，清空后无法精确重建，按 best-effort no-op 处理。
    const write = new CoordinatedWrite();
    if (hidePrefix != null) {
      write.register({
        name: "hide-prefix",
        execute: async () => {
          const r = await this.deps.messages.hideRange(
            sessionId,
            hidePrefix.fromSeq,
            hidePrefix.toSeq
          );
          // 步骤已知失败沿 Result 回传（四期门⑦），协调器触发逆序补偿。
          if (!r.ok) return Result.err(r.error);
          hiddenCount = r.value;
          return Result.ok(undefined);
        },
        rollback: async () => {
          const r = await this.deps.messages.showRange(
            sessionId,
            hidePrefix.fromSeq,
            hidePrefix.toSeq
          );
          if (!r.ok) return Result.err(r.error);
          return Result.ok(undefined);
        },
      });
    }
    if (showSuffix != null) {
      write.register({
        name: "show-suffix",
        execute: async () => {
          const r = await this.deps.messages.showRange(
            sessionId,
            showSuffix.fromSeq,
            showSuffix.toSeq
          );
          if (!r.ok) return Result.err(r.error);
          shownCount = r.value;
          return Result.ok(undefined);
        },
        rollback: async () => {
          const r = await this.deps.messages.hideRange(
            sessionId,
            showSuffix.fromSeq,
            showSuffix.toSeq
          );
          if (!r.ok) return Result.err(r.error);
          return Result.ok(undefined);
        },
      });
    }
    write.register({
      name: "clear-rule-snapshot",
      execute: async () => {
        await this.deps.sessionKkv.clearDomain(
          sessionId,
          SESSION_KKV_DOMAIN_RULE_SNAPSHOT
        );
        return Result.ok(undefined);
      },
      rollback: async () => {
        // rule_snapshot 是缓存快照，清空后无法重建原值；丢失只触发下次重算，不影响一致性。
        return Result.ok(undefined);
      },
    });
    write.register({
      name: "clear-file-cache",
      execute: async () => {
        await this.deps.sessionKkv.clearDomain(
          sessionId,
          SESSION_KKV_DOMAIN_FILE_CACHE
        );
        return Result.ok(undefined);
      },
      rollback: async () => {
        // file_cache 同为缓存，best-effort 不补偿。
        return Result.ok(undefined);
      },
    });
    const ran = await write.run();
    if (!ran.ok) return Result.err(ran.error);
    // 置位后上下文范围变了：API 占用双删（进程内热层 + session KKV 行），
    // 否则重启后从 KKV 读回旧值，与置位后的可见 prompt 不符。
    await invalidateSessionApiPromptTokenEntry(
      this.deps.sessionKkv,
      sessionId
    );

    return Result.ok({ hiddenCount, shownCount });
  }
}
