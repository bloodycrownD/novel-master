/**
 * 用户 VFS 用例端口：execute → pending → flush 产出 user_ops 附件。
 *
 * @module service/chat/user-vfs-turn.port
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";

/** 单次 VFS 操作中的 tool 调用规格（含 flush 配对用 id）。 */
export interface UserVfsTurnToolSpec {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** `executeOp` 入参：action XML 真源 + 待执行的 tool 列表。 */
export interface UserVfsTurnOp {
  readonly actionXml: string;
  readonly tools: readonly UserVfsTurnToolSpec[];
}

/** `executeOp` 执行结果。 */
export type UserVfsTurnExecuteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown; readonly partialFailure?: true };

/** `flushPendingUserVfsTurns` 执行结果。 */
export interface UserVfsFlushResult {
  /** 是否产出了非空 user_ops 附件（pending 非空且 net diff 非空）。 */
  readonly flushed: boolean;
  /** pending→合成的 user_ops 附件；无净变更时为空数组。 */
  readonly attachments: readonly MessageAttachment[];
}

/**
 * 用户 VFS 操作编排：即时 ToolRunner 执行 + pending 队列 + flush 产出附件（不再落 UA）。
 */
export interface UserVfsTurnService {
  /**
   * 执行合成 tool 并 append pending；失败不写 pending。
   */
  executeOp(
    sessionId: string,
    op: UserVfsTurnOp,
  ): Promise<UserVfsTurnExecuteResult>;

  /**
   * pending 非空时合成 action XML → `user_ops` 附件并清空 pending；**不** insert UA 两段。
   *
   * @remarks flush 禁止再次调用 ToolRunner。checkpoint 改挂带 user_ops 的 user append（见 runAgentTurn）。
   */
  flushPendingUserVfsTurns(sessionId: string): Promise<UserVfsFlushResult>;

  /** 会话是否存在待 flush 的 VFS pending 条目。 */
  hasPendingTurns(sessionId: string): Promise<boolean>;
}

/** 桥接 assistant 追加函数（maxSteps 弹窗场景；deps 由工厂绑定）。 */
export type AppendToolTurnBridgeFn = (
  sessionId: string,
) => Promise<ChatMessage>;
