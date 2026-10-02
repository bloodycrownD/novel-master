/**
 * Default message service.
 *
 * @module service/chat/impl/message.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { assertMessageContent } from "@/domain/chat/content/parse-message-content.js";
import {
  messageMatchesKeyword,
  type MessageSearchQuery,
} from "@/domain/chat/content/message-content-match.js";
import type { MessageContent } from "@/domain/chat/model/content-block.js";
import type {
  ChatMessage,
  ChatMessageHeader,
  MessageAttachment,
} from "@/domain/chat/model/message.js";
import type { MessageUsage } from "@/domain/chat/model/message-usage.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import { messageAttachmentsSchema } from "@/domain/chat/model/message-attachment.schema.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { nextForkSessionTitle } from "@/domain/chat/logic/fork-session-title.js";
import { seedForkCopyParity } from "@/domain/chat/logic/seed-fork-copy-parity.js";
import { copyVfsTree } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { sweepSessionRevisions } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteSessionKkvRepository } from "@/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.js";
import {
  SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
  SESSION_KKV_DOMAIN_USAGE_STATS,
  USAGE_STATS_TOOL_USE_COUNT_KEY,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { countToolUseBlocks } from "@/domain/chat/logic/tool-use-count.js";
import {
  aggregateReadRefPointers,
  aggregateReadRefs,
  adjustReadRefCount,
  collectReadRefs,
} from "@/domain/vfs/logic/revision-ref-count.js";
import { chatInvalidArgument, chatNotFound } from "@/errors/chat-errors.js";
import { invalidateSessionApiPromptTokenEntry } from "@/infra/tokenizer/logic/session-api-prompt-token-store.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { MessageService } from "../message.port.js";

function reposFor(conn: TdbcConnection) {
  return {
    sessions: new SqliteSessionRepository(conn),
    messages: new SqliteMessageRepository(conn),
    vfs: new SqliteVfsEntryRepository(conn),
  };
}

function normalizeAppendAttachments(
  attachments: readonly MessageAttachment[] | undefined
): MessageAttachment[] | undefined {
  if (attachments == null || attachments.length === 0) {
    return undefined;
  }
  return messageAttachmentsSchema.parse(attachments);
}

/** Dependencies for {@link DefaultMessageService}. */
export interface MessageServiceDeps {
  readonly conn: TdbcConnection;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly vfs: VfsEntryRepository;
  readonly checkpoints: MessageCheckpointRepository;
  readonly revisions: VfsRevisionRepository;
}

/**
 * Message service with monotonic `seq` and fork support.
 */
export class DefaultMessageService implements MessageService {
  constructor(private readonly deps: MessageServiceDeps) {}

  /**
   * 失效该会话的 API prompt 占用（进程内热层 + session KKV 行双删）。
   *
   * 本类只持有 conn：就地建一个 SessionKkvService（无状态、只是仓储包装），
   * 与 message-transcript-effects / run-compaction 的失效口径一致。所有调用点
   * 都在 `conn.transaction` 块外，KKV 删除已 await（失败只吞 warn，不冒泡）。
   */
  private async invalidatePromptTokens(sessionId: string): Promise<void> {
    await invalidateSessionApiPromptTokenEntry(
      createSessionKkvService(this.deps.conn),
      sessionId
    );
  }

  /**
   * 失效该会话的工具调用数缓存（usage_stats.toolUseCount，纯加速数据：
   * 失败只影响下次读数现算，best-effort 不冒泡）。
   *
   * 失效口径（见 session-kkv-domains 的 usage_stats 域注释）：新增含
   * tool_use 的消息 / 编辑 / 删除 / 回滚截断。hide/show 不失效——计数含
   * hidden 行，可见性变化不改计数。纯文本追加不失效（不触发无谓重算）。
   *
   * 失效写法是**哨兵空串**而非 delete（cr-fix-spec-r2 s3/B-1）：读口
   * 「现算回填」与失效存在竞态——SELECT 快照与回填 set 之间隔数百毫秒
   * 解压循环，delete 先落、陈旧 set 后写会让失效被覆盖且不自愈；哨兵让
   * 读口回填前能复核「原值是否仍等于 miss 时所见」，不等即放弃回填。
   */
  private async invalidateToolUseCount(sessionId: string): Promise<void> {
    try {
      await createSessionKkvService(this.deps.conn).set(
        sessionId,
        SESSION_KKV_DOMAIN_USAGE_STATS,
        USAGE_STATS_TOOL_USE_COUNT_KEY,
        ""
      );
    } catch (error) {
      console.warn(
        `[message-service] 工具调用数缓存失效失败（下次读数将现算）：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  listBySession(
    sessionId: string,
    options?: { includeHidden?: boolean }
  ): Promise<ChatMessage[]> {
    return this.deps.messages.listBySession(sessionId, options);
  }

  listMessageHeadersBySession(
    sessionId: string
  ): Promise<ChatMessageHeader[]> {
    return this.deps.messages.listMessageHeadersBySession(sessionId);
  }

  listBySessionFromSeq(
    sessionId: string,
    fromSeq: number
  ): Promise<ChatMessage[]> {
    return this.deps.messages.listBySessionFromSeq(sessionId, fromSeq);
  }

  listBySessionTail(
    sessionId: string,
    options: { limit: number }
  ): Promise<ChatMessage[]> {
    return this.deps.messages.listBySessionTail(sessionId, options.limit);
  }

  listBySessionTailOfRole(
    sessionId: string,
    options: { role: string; limit: number }
  ): Promise<ChatMessage[]> {
    return this.deps.messages.listBySessionTailOfRole(
      sessionId,
      options.role,
      options.limit
    );
  }

  listBySessionPage(
    sessionId: string,
    options: { limit: number; beforeSeq?: number }
  ): Promise<ChatMessage[]> {
    return this.deps.messages.listBySessionPage(
      sessionId,
      options.limit,
      options.beforeSeq
    );
  }

  async get(id: string): Promise<ChatMessage> {
    const message = await this.deps.messages.findById(id);
    if (message == null) {
      throw chatNotFound("message", id);
    }
    return message;
  }

  async append(
    sessionId: string,
    role: string,
    content: MessageContent,
    options?: {
      provider?: string | null;
      modelName?: string | null;
      providerId?: string | null;
      raw?: Record<string, unknown> | null;
      attachments?: readonly MessageAttachment[];
      usage?: MessageUsage;
    }
  ): Promise<ChatMessage> {
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }
    assertMessageContent(content);
    const attachments = normalizeAppendAttachments(options?.attachments);
    const seq = await this.deps.messages.nextSeq(sessionId);
    // New messages are visible by default
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId,
      seq,
      role,
      content,
      provider: options?.provider ?? null,
      modelName: options?.modelName ?? null,
      providerId: options?.providerId ?? null,
      raw: options?.raw ?? null,
      createdAtMs: Date.now(),
      hidden: false,
      ...(attachments != null ? { attachments } : {}),
      ...(options?.usage != null ? { usage: options.usage } : {}),
    };
    await this.deps.messages.insert(message);
    // 消息「增」不再失效 API 占用（统计优先口径，2026-09-29 真机复验拍板）：
    // 纯追加由读口的「基线 + anchorSeq 之后追加消息的增量估算」覆盖（metric
    // 同款），失效反而会让 run 起步的压缩评估与 chip 首帧跌回估算档（评估
    // 已 preferEstimate 廉价即回，真正多付的是 UI 刷新路径的后台精确计数）。
    // 删除/改写/隐藏类路径（delete/updateContent/hide/show/hideRange/
    // showRange/truncateAfter）的失效保留——增量表达不了内容消失。
    // 工具调用数缓存：仅含 tool_use 块的追加失效（run 的工具步在此失效、
    // 纯文本追加不动缓存——避免 run 内每步无谓重算）。
    if (role === "assistant" && countToolUseBlocks(content) > 0) {
      await this.invalidateToolUseCount(sessionId);
    }
    return message;
  }

  async delete(id: string): Promise<void> {
    const message = await this.deps.messages.findById(id);
    if (message == null) {
      throw chatNotFound("message", id);
    }

    const session = await this.deps.sessions.findById(message.sessionId);
    if (session == null) {
      throw chatNotFound("session", message.sessionId);
    }

    await this.deps.conn.transaction(async (tx) => {
      const messages = new SqliteMessageRepository(tx);
      const checkpoints = new SqliteMessageCheckpointRepository(tx);
      const entries = new SqliteVfsEntryRepository(tx);
      const revisions = new SqliteVfsRevisionRepository(tx);

      // read 引用 −1（消息内 (entryId, version) 去重）：必须在 sweep 之前，
      // 否则被引用 revision 会被 GC（read 引用是 ref_count 第三类持有者）。
      await adjustReadRefCount(revisions, collectReadRefs(message.content), -1);

      const deleted = await messages.delete(id);
      if (!deleted) {
        throw chatNotFound("message", id);
      }

      // 发生删除即清 backfill 游标：消息删除改变计数口径（count < 游标或圈段
      // 位移），残留会让下次 backfill 判定错位——清掉走保守全量自愈。
      await new SqliteSessionKkvRepository(tx).clearDomain(
        message.sessionId,
        SESSION_KKV_DOMAIN_BACKFILL_CURSOR
      );
      await checkpoints.deleteCheckpointsForMessages(message.sessionId, [id]);
      await sweepSessionRevisions(
        revisions,
        entries,
        checkpoints,
        session.projectId,
        message.sessionId,
        tx
      );
    });
    await runDeferredBlobGc(this.deps.conn);
    await this.invalidatePromptTokens(message.sessionId);
    await this.invalidateToolUseCount(message.sessionId);
  }

  async updateContent(
    messageId: string,
    content: MessageContent
  ): Promise<ChatMessage> {
    assertMessageContent(content);
    // 覆写换算 read 引用（旧 blocks −1、新 blocks +1）+ 正文替换收进同一事务：
    // 引用计数与消息行要么同时生效、要么同时回滚，不产生无主计数。
    // 序列化与压缩编码都下沉到 repository（port 签名为 MessageContent 对象）。
    await this.deps.conn.transaction(async (tx) => {
      const messages = new SqliteMessageRepository(tx);
      const revisions = new SqliteVfsRevisionRepository(tx);
      const existing = await messages.findById(messageId);
      if (existing == null) {
        throw chatNotFound("message", messageId);
      }
      await adjustReadRefCount(
        revisions,
        collectReadRefs(existing.content),
        -1
      );
      const updated = await messages.updateContent(messageId, content);
      if (!updated) {
        throw chatNotFound("message", messageId);
      }
      // +1 带 NOT_FOUND 守护（batchAdjustRefCountWithDelta 语义）：新 blocks
      // 引用的 revision 必须存在，悬空引用在落库前 fail-fast。
      await adjustReadRefCount(revisions, collectReadRefs(content), +1);
    });
    const message = await this.get(messageId);
    await this.invalidatePromptTokens(message.sessionId);
    await this.invalidateToolUseCount(message.sessionId);
    return message;
  }

  async fork(sessionId: string, upToMessageId: string): Promise<ChatSession> {
    const source = await this.deps.sessions.findById(sessionId);
    if (source == null) {
      throw chatNotFound("session", sessionId);
    }
    const upTo = await this.deps.messages.findById(upToMessageId);
    if (upTo == null || upTo.sessionId !== sessionId) {
      throw chatNotFound("message", upToMessageId, { sessionId });
    }
    // 上界收窄读口：fork 的全部消费都落在「锚点及更早」方向（下方
    // aggregateReadRefs / seedForkCopyParity 都吃同一份 toCopy），锚点之后的
    // 整条尾巴是纯浪费。旧形态是 listBySession 全量读 + 事务内 filter 丢弃。
    const all = await this.deps.messages.listBySessionUpToSeq(
      sessionId,
      upTo.seq
    );
    if (all.length === 0) {
      // 空集合守卫**必须在开事务之前**：上界读口在事务外，锚点之前的消息一条都
      // 没有时直接抛，不为一个必然回滚的动作开事务。
      throw chatInvalidArgument("No messages to fork up to the given id");
    }
    const projectSessions = await this.deps.sessions.listByProject(
      source.projectId
    );
    const forkTitle = nextForkSessionTitle(
      source.title,
      projectSessions.map((s) => s.title)
    );
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      // 上界读口的返回集合与旧的 all.filter(m => m.seq <= upTo.seq) 逐条等价，
      // 零新增过滤语义（含 hidden 行——fork 要 Preserve hidden state）。
      const toCopy = all;
      const now = Date.now();
      const forked: ChatSession = {
        id: randomUUID(),
        projectId: source.projectId,
        title: forkTitle,
        // P2-13：fork 出的是独立主会话，不继承源会话的 parent 关系。
        parentSessionId: null,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(forked);
      // 刻意不复制 session_kkv（SPEC：fork/copy 不复制 kkv）
      // 刻意不复制 composer_draft_json（维持现状）
      // agent_config_json：继承源会话配置（与 copy 一致）。必须走 repo 层——
      // NULL 静默跳过；service 层 getSessionAgentConfig 对 NULL 会抛且不在本事务上。
      const sourceAgentConfigJson = await r.sessions.getSessionAgentConfig(
        source.id
      );
      if (sourceAgentConfigJson != null) {
        await r.sessions.setSessionAgentConfig(
          forked.id,
          sourceAgentConfigJson,
          now
        );
      }
      // 顺序钉死：VFS → MSG(ids) → helper(REV + RULE + CK)
      // entry_id 化后会话独立 scope：session:{pid}:{sid}，逻辑前缀为 "/"
      await copyVfsTree(
        r.vfs,
        { scopeKey: `session:${source.projectId}:${source.id}` },
        "/",
        { scopeKey: `session:${source.projectId}:${forked.id}` },
        "/",
        { contentStore: new SqliteVfsContentStore(tx) }
      );

      const newMessages: { id: string }[] = [];
      let seq = 1;
      // 逐条 INSERT 改成先构造数组再一次 batchInsert，把 M 次 round-trip 收敛成 1 次。
      const forkedMessages: ChatMessage[] = [];
      for (const msg of toCopy) {
        const id = randomUUID();
        // Preserve hidden state when forking
        forkedMessages.push({ ...msg, id, sessionId: forked.id, seq });
        newMessages.push({ id });
        seq++;
      }
      await r.messages.batchInsert(forkedMessages);
      // fork 消息浅拷贝原样保留 contentRef 的 (entryId, version)（指向源会话的
      // revision）——按全局键对**源** revision +1（消息内去重、消息间累加），
      // 源会话删除后 fork 侧引用依旧保活。
      await adjustReadRefCount(
        new SqliteVfsRevisionRepository(tx),
        aggregateReadRefs(toCopy.map((m) => m.content)),
        +1
      );
      await seedForkCopyParity(tx, {
        projectId: source.projectId,
        sourceSessionId: source.id,
        targetSessionId: forked.id,
        newMessages,
      });
      return forked;
    });
  }

  async hide(messageId: string): Promise<void> {
    const existing = await this.deps.messages.findById(messageId);
    if (existing == null) {
      throw chatNotFound("message", messageId);
    }
    const updated = await this.deps.messages.updateHidden(messageId, true);
    if (!updated) {
      throw chatNotFound("message", messageId);
    }
    await this.invalidatePromptTokens(existing.sessionId);
  }

  async show(messageId: string): Promise<void> {
    const existing = await this.deps.messages.findById(messageId);
    if (existing == null) {
      throw chatNotFound("message", messageId);
    }
    const updated = await this.deps.messages.updateHidden(messageId, false);
    if (!updated) {
      throw chatNotFound("message", messageId);
    }
    await this.invalidatePromptTokens(existing.sessionId);
  }

  async hideRange(
    sessionId: string,
    fromSeq: number,
    toSeq: number
  ): Promise<number> {
    // Verify session exists
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }
    const count = await this.deps.messages.updateHiddenRange(
      sessionId,
      fromSeq,
      toSeq,
      true
    );
    if (count > 0) {
      await this.invalidatePromptTokens(sessionId);
    }
    return count;
  }

  async showRange(
    sessionId: string,
    fromSeq: number,
    toSeq: number
  ): Promise<number> {
    // Verify session exists
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }
    const count = await this.deps.messages.updateHiddenRange(
      sessionId,
      fromSeq,
      toSeq,
      false
    );
    if (count > 0) {
      await this.invalidatePromptTokens(sessionId);
    }
    return count;
  }

  async truncateAfter(
    sessionId: string,
    afterMessageId: string | null
  ): Promise<void> {
    const session = await this.deps.sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }

    if (afterMessageId == null) {
      // anchor 为 null → 清空整 session：产出「要删的消息 id + 它们的 read 引用」
      // 这两样删除链素材。窄投影读口（4 列）替掉原来的 21 列全量读，
      // 且**移进写事务**——旧形态读在事务外，读到 id 集合之后新 append 的消息
      // 会被 deleteBySession 删掉、但它的 checkpoint 不在 ids 里 ⇒ 孤儿 checkpoint。
      // 产出的 ids/refs 就是要删的写集合，按「产出写集合的读必须留在事务内」处理。
      await this.deps.conn.transaction(async (tx) => {
        const messages = new SqliteMessageRepository(tx);
        const checkpoints = new SqliteMessageCheckpointRepository(tx);
        const targets = await messages.listReadRefTargetsBySession(sessionId);
        if (targets.length > 0) {
          // 发生删除即清 backfill 游标（清空重聊场景 seq 全量复用，防线同 delete）。
          await new SqliteSessionKkvRepository(tx).clearDomain(
            sessionId,
            SESSION_KKV_DOMAIN_BACKFILL_CURSOR
          );
          // read 引用 −1（公开 API 不留无挂点的消息删除面）：与消息删除同事务。
          await adjustReadRefCount(
            new SqliteVfsRevisionRepository(tx),
            aggregateReadRefPointers(targets.map((t) => t.refs)),
            -1
          );
          await checkpoints.deleteCheckpointsForMessages(
            sessionId,
            targets.map((t) => t.id)
          );
        }
        await messages.deleteBySession(sessionId);
      });
      await this.invalidatePromptTokens(sessionId);
      await this.invalidateToolUseCount(sessionId);
      return;
    }

    const anchor = await this.deps.messages.findById(afterMessageId);
    if (anchor == null || anchor.sessionId !== sessionId) {
      throw chatNotFound("message", afterMessageId, { sessionId });
    }

    // 拉带正文的 tail（seq > anchor.seq ⟺ seq >= anchor.seq + 1）：id 列表与
    // read 引用收集共用一次查询。
    const tailMessages = await this.deps.messages.listBySessionFromSeq(
      sessionId,
      anchor.seq + 1
    );
    if (tailMessages.length === 0) {
      // 没有 tail 需要截断，也顺手 invalidate 一下 prompt 缓存保险
      await this.invalidatePromptTokens(sessionId);
      return;
    }

    await this.deps.conn.transaction(async (tx) => {
      const messages = new SqliteMessageRepository(tx);
      const checkpoints = new SqliteMessageCheckpointRepository(tx);
      // 发生删除即清 backfill 游标（tail 截断后 seq 复用，防线同 delete）。
      await new SqliteSessionKkvRepository(tx).clearDomain(
        sessionId,
        SESSION_KKV_DOMAIN_BACKFILL_CURSOR
      );
      // read 引用 −1（公开 API 不留无挂点的消息删除面）：与消息删除同事务。
      await adjustReadRefCount(
        new SqliteVfsRevisionRepository(tx),
        aggregateReadRefs(tailMessages.map((m) => m.content)),
        -1
      );
      await checkpoints.deleteCheckpointsForMessages(
        sessionId,
        tailMessages.map((m) => m.id)
      );
      await messages.deleteAfterSeq(sessionId, anchor.seq);
    });
    await this.invalidatePromptTokens(sessionId);
    await this.invalidateToolUseCount(sessionId);
  }

  async searchMessages(
    sessionId: string,
    query: MessageSearchQuery
  ): Promise<ChatMessage[]> {
    const candidates = await this.deps.messages.searchMessages(
      sessionId,
      query
    );
    const keyword = query.keyword?.trim() ?? "";
    if (keyword.length === 0) {
      // keyword 为空时不做关键词过滤，仓储层已返回所有符合时间/limit 约束的消息。
      return candidates;
    }
    // 仓储层（SqliteMessageRepository）已在内存层按 TextBlock 精筛——这里是
    // 防御性重筛：port 合同允许其它实现退回超集召回（如曾经的 SQL LIKE 粗筛），
    // messageMatchesKeyword 是最终判定口径（幂等，对已精筛结果零开销）。
    // 精筛后防御性截断到 limit（ic-31）：换一个「退回超集召回」的 port 实现
    // 时不会把超量结果透传给 UI——截断口径与仓储层 clampedLimit 一致
    // （Math.max(1, Math.floor(limit))，规避负数/浮点）。
    return candidates
      .filter((msg) => messageMatchesKeyword(msg, keyword))
      .slice(0, Math.max(1, Math.floor(query.limit)));
  }
}
