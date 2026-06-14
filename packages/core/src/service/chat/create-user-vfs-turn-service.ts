/**
 * 用户 VFS U-A-U-A 服务工厂。
 *
 * @module service/chat/create-user-vfs-turn-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "@/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "@/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import { createScopedVfsService } from "@/service/vfs/create-scoped-vfs-service.js";
import { createMessageCheckpointService } from "@/service/message-checkpoint/create-message-checkpoint-services.js";
import { DefaultMessageService } from "./impl/message.service.js";
import { DefaultUserVfsTurnService } from "./impl/user-vfs-turn.service.js";
import { createAppendToolTurnBridge } from "./impl/append-tool-turn-bridge.js";
import type {
  AppendToolTurnBridgeFn,
  UserVfsTurnService,
} from "./user-vfs-turn.port.js";

/** `createUserVfsTurnServiceBundle` 返回值。 */
export interface UserVfsTurnServiceBundle {
  readonly userVfsTurn: UserVfsTurnService;
  readonly appendToolTurnBridge: AppendToolTurnBridgeFn;
}

/**
 * 创建用户 VFS turn 服务与桥接 append 闭包（共享连接与 repo）。
 */
export function createUserVfsTurnServiceBundle(
  conn: TdbcConnection,
): UserVfsTurnServiceBundle {
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);
  const checkpointRepo = new SqliteMessageCheckpointRepository(conn);
  const revisionRepo = new SqliteVfsRevisionRepository(conn);

  const messages = new DefaultMessageService({
    conn,
    sessions: sessionRepo,
    messages: messageRepo,
    vfs: vfsRepo,
    checkpoints: checkpointRepo,
    revisions: revisionRepo,
  });

  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  const toolRunner = new ToolRunner(registry);

  const resolveToolCtx = (
    sessionId: string,
    projectId: string,
  ): BuiltinToolContext => ({
    vfs: createScopedVfsService(conn, {
      kind: "session",
      projectId,
      sessionId,
    }),
    projectId,
    sessionId,
    listSessionMessages: () => messageRepo.listBySession(sessionId),
  });

  const userVfsTurn = new DefaultUserVfsTurnService({
    sessions: sessionRepo,
    messages,
    toolRunner,
    resolveToolCtx,
    messageCheckpoint: createMessageCheckpointService(conn),
  });

  return {
    userVfsTurn,
    appendToolTurnBridge: createAppendToolTurnBridge(messages),
  };
}

/** 创建 {@link UserVfsTurnService} 实例。 */
export function createUserVfsTurnService(
  conn: TdbcConnection,
): UserVfsTurnService {
  return createUserVfsTurnServiceBundle(conn).userVfsTurn;
}
