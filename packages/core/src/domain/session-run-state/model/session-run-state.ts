/**
 * Session Run State 行模型。
 *
 * @module domain/session-run-state/model/session-run-state
 */

/**
 * run 状态持久层枚举。
 *
 * interrupted/finished/failed 在持久层统一存为 `settled`——持久层只关心
 * 「该会话是否还有活着的 run」，终态子类型由 runtime 内存状态机负责。
 */
export type SessionRunStatus = "starting" | "running" | "settled";

/**
 * `session_run_state` 行模型（每 sessionId 至多一行）。
 *
 * `settled` 行的字段语义：`partialText`/`partialThinking`/`pendingChildrenJson`
 * 清空（null），仅保留 metrics 字段（`textChars`/`thinkingChars`/`startedAtMs`/
 * `updatedAtMs` 等），供跨重启的「上次生成」读取。
 */
export interface SessionRunState {
  readonly sessionId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly status: SessionRunStatus;
  readonly startedAtMs: number;
  readonly textChars: number;
  readonly thinkingChars: number;
  readonly partialText: string | null;
  readonly partialThinking: string | null;
  readonly pendingChildrenJson: string | null;
  readonly updatedAtMs: number;
}
