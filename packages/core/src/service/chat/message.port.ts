/**
 * Message application service port.
 *
 * @module service/chat/message.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { Outcome } from "@/errors/outcome.js";
import type { LongTaskHooks } from "@/domain/abort/model/abort-scope.js";
import type {
  ChatMessageData,
  ChatMessageHeader,
  MessageAttachment,
  MessageContent,
} from "@/domain/chat/model/message.js";
import type { MessageUsage } from "@/domain/chat/model/message-usage.js";
import type { ChatSession } from "@/domain/chat/model/session.js";

/**
 * Message CRUD and fork (branch) operations.
 *
 * 大结果集读口返回 `Outcome`：分片边界命中 `hooks.checkpoint` 时给
 * `cancelled` / `replaced`（中断不是错误，不返回半份结果），业务失败给
 * `failed`。未注入 hooks 的调用方拿到的中断分支恒不可达。
 */
export interface MessageService {
  /** `includeHidden: false` 只取可见消息（SQL 层过滤，不解压隐藏行正文）。 */
  listBySession(
    sessionId: string,
    options?: { includeHidden?: boolean },
    hooks?: LongTaskHooks
  ): Promise<Outcome<ChatMessageData[]>>;

  /** 消息头投影（无正文不解压）——压缩/置位的区间逻辑专用轻量读。 */
  listMessageHeadersBySession(
    sessionId: string
  ): Promise<ChatMessageHeader[]>;

  /** 按 seq 升序取 `seq >= fromSeq` 的全量消息（锚定窗口补拉真行用）。 */
  listBySessionFromSeq(
    sessionId: string,
    fromSeq: number,
    hooks?: LongTaskHooks
  ): Promise<Outcome<ChatMessageData[]>>;
  listBySessionTail(
    sessionId: string,
    options: { limit: number },
    hooks?: LongTaskHooks
  ): Promise<Outcome<ChatMessageData[]>>;
  /**
   * tail + role 过滤：取该 role 的最后 `limit` 条（role 在 SQL 子查询里滤，
   * limit 只数该 role 的行 ⇒ 夹在中间的其它 role 消息不占配额）。
   * subagent 工具取「末条 assistant 文本」专用。
   */
  listBySessionTailOfRole(
    sessionId: string,
    options: { role: string; limit: number },
    hooks?: LongTaskHooks
  ): Promise<Outcome<ChatMessageData[]>>;
  listBySessionPage(
    sessionId: string,
    options: { limit: number; beforeSeq?: number },
    hooks?: LongTaskHooks
  ): Promise<Outcome<ChatMessageData[]>>;

  get(id: string): Promise<Result<ChatMessageData, AppError>>;

  append(
    sessionId: string,
    role: string,
    content: MessageContent,
    options?: {
      provider?: string | null;
      /** 厂商模型 id（写入 `model_name` 列，统计页接续/筛选用）。 */
      modelName?: string | null;
      /** 服务商配置 id（写入 `provider_id` 列，写入时快照，供 provider×model 维度统计）。 */
      providerId?: string | null;
      raw?: Record<string, unknown> | null;
      /** 结构化附件；写入 `attachments_json`，不写入 `content_json`。 */
      attachments?: readonly MessageAttachment[];
      /** LLM token usage（assistant message 持久化）。 */
      usage?: MessageUsage;
    }
  ): Promise<Result<ChatMessageData, AppError>>;

  delete(id: string): Promise<Result<void, AppError>>;

  /** Replaces message content (e.g. user edit in mobile). */
  updateContent(
    messageId: string,
    content: MessageContent
  ): Promise<Result<ChatMessageData, AppError>>;

  /**
   * Creates a new session with source session VFS and messages up to `upToMessageId`.
   *
   * `hooks` 透传给上界读口与 `batchInsert`：中断在事务边界转
   * `throw createAbortError()` 整体回滚（不留半写 fork）。
   */
  fork(sessionId: string, upToMessageId: string, hooks?: LongTaskHooks): Promise<Result<ChatSession, AppError>>;

  /** Hide a single message from LLM prompt rendering. */
  hide(messageId: string): Promise<Result<void, AppError>>;

  /** Show a previously hidden message. */
  show(messageId: string): Promise<Result<void, AppError>>;

  /** Hide a range of messages by seq. Returns count of affected messages. */
  hideRange(sessionId: string, fromSeq: number, toSeq: number): Promise<Result<number, AppError>>;

  /** Show a range of messages by seq. Returns count of affected messages. */
  showRange(sessionId: string, fromSeq: number, toSeq: number): Promise<Result<number, AppError>>;

  /**
   * 删除 `sessionId` 中严格位于 `afterMessageId` 之后的所有消息（及其 checkpoint 指针），
   * 不含 anchor 自身；`afterMessageId` 为 null 时清空 session 内全部消息。
   *
   * 主要给 agent turn abort 回滚用——干净回到 turn 起点。
   */
  truncateAfter(
    sessionId: string,
    afterMessageId: string | null
  ): Promise<Result<void, AppError>>;
}
