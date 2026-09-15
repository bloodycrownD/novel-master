/**
 * Session Run State 应用服务端口。
 *
 * @module service/session-run-state/session-run-state.port
 */

import type {
  SessionRunState,
  SessionRunStatus,
} from "@/domain/session-run-state/model/session-run-state.js";

/** {@link SessionRunStateService.settle} 的 metrics 输入（不含 partial 字段）。 */
export interface SessionRunStateSettleInput {
  readonly sessionId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly startedAtMs: number;
  readonly textChars: number;
  readonly thinkingChars: number;
  readonly updatedAtMs: number;
}

/**
 * 会话 run 状态的持久层服务（`session_run_state` 表，每会话单行）。
 *
 * @remarks
 * - {@link upsert}/{@link settle} 为单行单主键 UPSERT，天然原子——不进事务、
 *   不做 CoordinatedWrite；写通侧节流合并后调这里全量覆盖写。
 * - {@link listByStatuses} 供水合：`['starting','running']` 一批建 interrupted
 *   单元、`['settled']` 一批回填「上次生成」metrics 投影。
 * - 删除方法供会话/项目删除联动在删除事务内调用；不清理的话，孤儿
 *   starting/running 行会在重启水合时生成幽灵 interrupted 单元。
 * - fork / copy 会话**不**复制本表行。
 */
export interface SessionRunStateService {
  get(sessionId: string): Promise<SessionRunState | null>;

  /** UPSERT 覆盖写该会话的行（不存在则插入）。 */
  upsert(state: SessionRunState): Promise<void>;

  /**
   * 收尾写 settled 行：partial_text/partial_thinking/pending_children_json
   * 清空，仅保留 metrics 字段（覆盖 starting/running 行，终态子类型由
   * runtime 内存状态机负责，持久层统一存 `settled`）。
   */
  settle(input: SessionRunStateSettleInput): Promise<void>;

  /** 按状态扫描（全表小扫描，结果按 session_id 排序）。 */
  listByStatuses(
    statuses: readonly SessionRunStatus[]
  ): Promise<SessionRunState[]>;

  /** 删除该会话的行（会话删除联动），返回是否删到。 */
  deleteBySession(sessionId: string): Promise<boolean>;

  /** 删除该项目的全部行（项目删除级联），返回是否删到。 */
  deleteByProject(projectId: string): Promise<boolean>;
}
