/**
 * Template pull orchestration (VFS replace + worktree replace).
 *
 * global → project 的模板拉取链已随全局文件管理器迭代拆除；本服务仅保留
 * project → session 的初始化链（{@link initializeSessionWorkspace}）。
 *
 * @module service/template/impl/template-pull.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { chatNotFound } from "@/errors/chat-errors.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { initializeSessionWorkspace } from "@/service/template/logic/initialize-session-workspace.js";
import { pushSessionWorkspace } from "@/service/template/logic/push-session-workspace.js";
import type { TemplatePullService } from "../template-pull.port.js";

/**
 * Default template pull: replace session subtree from project template.
 */
export class DefaultTemplatePullService implements TemplatePullService {
  constructor(private readonly conn: TdbcConnection) {}

  async sessionTemplatePull(sessionId: string): Promise<void> {
    const sessions = new SqliteSessionRepository(this.conn);
    const session = await sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }
    await this.conn.transaction(async (tx) => {
      await initializeSessionWorkspace(tx, session.projectId, sessionId, {
        clearCheckpoints: true,
      });
    });
    await runDeferredBlobGc(this.conn);
  }

  async sessionTemplatePush(sessionId: string): Promise<void> {
    // 推送与拉取同一套校验/事务/GC 骨架，只是方向对调（session → project）。
    const sessions = new SqliteSessionRepository(this.conn);
    const session = await sessions.findById(sessionId);
    if (session == null) {
      throw chatNotFound("session", sessionId);
    }
    await this.conn.transaction(async (tx) => {
      await pushSessionWorkspace(tx, session.projectId, sessionId);
    });
    await runDeferredBlobGc(this.conn);
  }
}
