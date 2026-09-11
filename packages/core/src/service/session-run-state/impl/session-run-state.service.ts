/**
 * 默认 Session Run State 服务实现。
 *
 * @module service/session-run-state/impl/session-run-state.service
 */

import type { SessionRunStateRepository } from "@/domain/session-run-state/repositories/session-run-state.port.js";
import type {
  SessionRunState,
  SessionRunStatus,
} from "@/domain/session-run-state/model/session-run-state.js";
import type {
  SessionRunStateService,
  SessionRunStateSettleInput,
} from "../session-run-state.port.js";

/**
 * 委托 {@link SessionRunStateRepository} 的会话 run 状态服务。
 */
export class DefaultSessionRunStateService implements SessionRunStateService {
  constructor(private readonly repo: SessionRunStateRepository) {}

  get(sessionId: string): Promise<SessionRunState | null> {
    return this.repo.get(sessionId);
  }

  upsert(state: SessionRunState): Promise<void> {
    return this.repo.upsert(state);
  }

  async settle(input: SessionRunStateSettleInput): Promise<void> {
    await this.repo.upsert({
      ...input,
      status: "settled",
      partialText: null,
      partialThinking: null,
      pendingChildrenJson: null,
    });
  }

  listByStatuses(
    statuses: readonly SessionRunStatus[]
  ): Promise<SessionRunState[]> {
    return this.repo.listByStatuses(statuses);
  }

  deleteBySession(sessionId: string): Promise<boolean> {
    return this.repo.deleteBySession(sessionId);
  }

  deleteByProject(projectId: string): Promise<boolean> {
    return this.repo.deleteByProject(projectId);
  }
}
