/**
 * Message checkpoint capture port (Agent step boundary).
 *
 * @module service/message-checkpoint/message-checkpoint.port
 */

/**
 * Captures the session work tree after Agent mutating tools complete.
 */
export interface MessageCheckpointService {
  /**
   * Records `{ logicalPath → head_version }` for all session files.
   *
   * @remarks No-op when the work tree has zero files (optional per PRD).
   */
  capture(
    sessionId: string,
    projectId: string,
    messageId: string
  ): Promise<void>;

  /**
   * 给「最后一个有 checkpoint 的消息之后」的空窗消息补 baseline 快照。
   *
   * 用途：Step 9 之前产生的历史消息可能没有 baseline，这里在事务内统一修补。
   * 已经有 checkpoint 的消息不会被覆盖；没有 message 或没有 live 文件时是空操作。
   *
   * @remarks 幂等：所有消息都有 checkpoint 时直接 short-circuit。
   *
   * @param signal 可选。r3-run-4 引入的弃权信号——前奏期 backfill 是大会话上
   *   秒级的纯扫描，用户在这段窗口按停止时不该被逼着等它跑完（真机 2026-09-30：
   *   连点停止要等 11s 才兑现）。传入后实现会在扫描循环内检查并提前退出。
   *
   *   **中途退出的语义**：退出发生在 `conn.transaction` 之内，已写的部分随事务
   *   提交留下——这是有意的、也是安全的：backfill 本身幂等（已写的行不会被覆盖），
   *   下一轮发送会接着补齐剩下的空窗；且中断时不写 backfill 游标，判定下次必然
   *   回退全量，**不会**因游标前移而把「没补完」误判成「已确认无空窗」。
   *
   *   不传时行为与旧版逐字节一致（对不传 signal 的调用方零影响）。
   */
  backfillMissingBaselines(
    sessionId: string,
    projectId: string,
    signal?: AbortSignal
  ): Promise<void>;

  /**
   * 删除指定消息的 checkpoint 行（capture 的补偿动作）。
   *
   * 主要给 {@link CoordinatedWrite} 的回滚路径用：当 append + capture 这条链里 capture
   * 之后的步骤失败、需要把刚写的 baseline checkpoint 收回去时调用。幂等——消息没有
   * checkpoint 时是空操作。
   *
   * @remarks 实现可选；不提供时回滚按 no-op 处理（best-effort 约定）。
   */
  release?(sessionId: string, messageId: string): Promise<void>;
}
