/**
 * 用户 VFS UA 两段用例端口。
 *
 * @module service/chat/user-vfs-turn.port
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";

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
  | { readonly ok: false; readonly error: unknown };

/** `flushPendingUserVfsTurns` 执行结果。 */
export interface UserVfsFlushResult {
  /** 是否实际落库了 UA 两段（pending 非空时为 true）。 */
  readonly flushed: boolean;
}

/**
 * 用户 VFS 操作编排：即时 ToolRunner 执行 + pending 队列 + flush 落库 UA 两段。
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
   * pending 非空时 merge 并 append 2 条 UA，清空 pending，capture checkpoint 一次（锚 U 条）。
   *
   * @remarks flush 禁止再次调用 ToolRunner。
   */
  flushPendingUserVfsTurns(sessionId: string): Promise<UserVfsFlushResult>;
}

/** 桥接 assistant 追加函数（maxSteps 弹窗场景；deps 由工厂绑定）。 */
export type AppendToolTurnBridgeFn = (
  sessionId: string,
) => Promise<ChatMessage>;
