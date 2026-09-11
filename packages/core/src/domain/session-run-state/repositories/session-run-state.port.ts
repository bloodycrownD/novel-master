/**
 * Session Run State 仓储端口。
 *
 * @module domain/session-run-state/repositories/session-run-state.port
 */

import type {
  SessionRunState,
  SessionRunStatus,
} from "../model/session-run-state.js";

/**
 * `session_run_state` 持久化契约。
 *
 * @remarks
 * - {@link upsert} 为单行单主键 UPSERT，天然原子——不进事务、不做
 *   CoordinatedWrite，规避 tdbc 嵌套事务铁律。
 * - 删除方法（{@link deleteBySession}/{@link deleteByProject}）供
 *   会话/项目删除联动在删除事务内调用。
 */
export interface SessionRunStateRepository {
  get(sessionId: string): Promise<SessionRunState | null>;

  /** 覆盖写该会话的行（不存在则插入）。 */
  upsert(state: SessionRunState): Promise<void>;

  /** 按状态扫描（如水合时 `['starting','running']` 一批、`['settled']` 一批）。 */
  listByStatuses(
    statuses: readonly SessionRunStatus[]
  ): Promise<SessionRunState[]>;

  /** 删除该会话的行，返回是否删到。 */
  deleteBySession(sessionId: string): Promise<boolean>;

  /** 删除该项目的全部行（项目删除级联），返回是否删到。 */
  deleteByProject(projectId: string): Promise<boolean>;
}
