/**
 * 会话 run 状态持久层（`session_run_state` 表）的公开入口。
 *
 * 下游通过 `@novel-master/core/session-run-state` 子路径消费本 barrel，
 * 这里收拢工厂、端口与行模型导出。
 *
 * @module public/session-run-state
 */

export { createSessionRunStateService } from "../service/session-run-state/create-session-run-state-service.js";
export type {
  SessionRunStateService,
  SessionRunStateSettleInput,
} from "../service/session-run-state/session-run-state.port.js";
export type {
  SessionRunState,
  SessionRunStatus,
} from "../domain/session-run-state/model/session-run-state.js";
