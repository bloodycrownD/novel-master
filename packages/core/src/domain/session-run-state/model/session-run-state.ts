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
 * 输出 token 计数来源（中立命名，展示层与持久层 alias 同一份声明）：
 * - `usage`：协议事件 / step done 补发事件的真值（run 级累计）；
 * - `heuristic`：字符折算兜底；usage 到达后不再回写。
 */
export type StreamTokenSource = "usage" | "heuristic";

/**
 * 行模型字段名（历史命名，与 {@link StreamTokenSource} 是同一份声明）。
 *
 * 展示层（双端 hook 的 `AgentStreamTokenSource`、mobile 单元的
 * `SessionStreamUnitTokenSource`）一律 alias 到本类型，新增来源只改一处。
 */
export type SessionRunStateTokenSource = StreamTokenSource;

/**
 * `session_run_state` 行模型（每 sessionId 至多一行）。
 *
 * `settled` 行的字段语义：`partialText`/`partialThinking`/`pendingChildrenJson`
 * 清空（null），仅保留 metrics 字段（`textChars`/`thinkingChars`/
 * `completionTokens`/`tokenSource`/`startedAtMs`/`updatedAtMs` 等），供跨重启的
 * 「上次生成」读取。
 */
export interface SessionRunState {
  readonly sessionId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly status: SessionRunStatus;
  readonly startedAtMs: number;
  readonly textChars: number;
  readonly thinkingChars: number;
  /** run 级累计输出 token（usage 真值优先，heuristic 兜底折算）。 */
  readonly completionTokens: number;
  readonly tokenSource: SessionRunStateTokenSource;
  readonly partialText: string | null;
  readonly partialThinking: string | null;
  readonly pendingChildrenJson: string | null;
  readonly updatedAtMs: number;
}
