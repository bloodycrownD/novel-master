/**
 * 用户 VFS 用例端口：execute 即时执行合成 tool（磁盘写链路）。
 *
 * @module service/chat/user-vfs-turn.port
 */

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
}
