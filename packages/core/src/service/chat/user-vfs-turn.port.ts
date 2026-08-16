/**
 * 用户 VFS 用例端口：execute 即时执行合成 tool（磁盘写链路）。
 *
 * @module service/chat/user-vfs-turn.port
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
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

/**
 * 用户 VFS 操作编排：即时 ToolRunner 执行（写盘 + 失败回滚 restore）。
 */
export interface UserVfsTurnService {
  /**
   * 执行合成 tool；写盘失败按 partialFailure 回滚 restore。
   */
  executeOp(
    sessionId: string,
    op: UserVfsTurnOp,
  ): Promise<UserVfsTurnExecuteResult>;

  /**
   * @deprecated 净 diff 热路径已拆除；实现恒返回 `[]`。
   */
  previewUserOpsActions(
    sessionId: string,
  ): Promise<readonly UserOpsActionSummary[]>;

  /**
   * @deprecated 净 diff 热路径已拆除；实现恒返回 `[]`。
   */
  previewUserOpsChangedPaths(sessionId: string): Promise<readonly string[]>;
}

/** 桥接 assistant 追加函数（maxSteps 弹窗场景；deps 由工厂绑定）。 */
export type AppendToolTurnBridgeFn = (
  sessionId: string,
) => Promise<ChatMessage>;
