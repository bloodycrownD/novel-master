/**
 * 用户 VFS 用例端口：execute → 操作日志 → flush 产出 user_ops 附件。
 *
 * @module service/chat/user-vfs-turn.port
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";
import type { UserOpsActionSummary } from "@/domain/chat/logic/synthesize-user-vfs-flush-actions.js";

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
  /**
   * 是否已将未发送操作日志转为附件。
   * `true` ⇔ 日志非空且已转为附件并清空 store（**废除** pending∧net-diff 非空条件）。
   */
  readonly flushed: boolean;
  /** 由未发送日志逐条构造的 user_ops 附件；无日志时为空数组。 */
  readonly attachments: readonly MessageAttachment[];
}

/**
 * 用户 VFS 操作编排：即时 ToolRunner 执行 + 进程内操作日志 + flush 产出附件（不再落 UA）。
 */
export interface UserVfsTurnService {
  /**
   * 执行合成 tool；成功后 append 操作日志（停写 `user_vfs_pending`）。
   * 写盘失败不写日志；日志 append 失败不回滚已成功写盘。
   */
  executeOp(
    sessionId: string,
    op: UserVfsTurnOp,
  ): Promise<UserVfsTurnExecuteResult>;

  /**
   * 未发送日志 → 逐条 `user_ops` 附件并清空 store；**不** insert UA，**不**做 checkpoint 净 diff。
   *
   * @remarks flush 禁止再次调用 ToolRunner；附件按日志条目各一条（跨次不合并）。
   * checkpoint 仍可在带 user_ops 的 user append 后 capture（不作下一轮 flush baseline）。
   */
  flushPendingUserVfsTurns(sessionId: string): Promise<UserVfsFlushResult>;

  /**
   * @deprecated 净 diff 热路径已拆除；实现恒返回 `[]`。
   * 状态条请改读 UserOpsLogStore / `projectComposerStatusAttachments`。
   */
  previewUserOpsActions(
    sessionId: string,
  ): Promise<readonly UserOpsActionSummary[]>;

  /**
   * @deprecated 净 diff 热路径已拆除；实现恒返回 `[]`。
   * 门闩 / chip 请改读 `hasPendingTurns` / log store。
   */
  previewUserOpsChangedPaths(sessionId: string): Promise<readonly string[]>;

  /**
   * 会话是否存在未发送手改（读操作日志 store；可暂保留本方法名）。
   */
  hasPendingTurns(sessionId: string): Promise<boolean>;
}

/** 桥接 assistant 追加函数（maxSteps 弹窗场景；deps 由工厂绑定）。 */
export type AppendToolTurnBridgeFn = (
  sessionId: string,
) => Promise<ChatMessage>;
