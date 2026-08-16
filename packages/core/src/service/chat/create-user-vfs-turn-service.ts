/**
 * 鐢ㄦ埛 VFS U-A-U-A 鏈嶅姟宸ュ巶銆?
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
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { DefaultMessageService } from "./impl/message.service.js";
import { DefaultUserVfsTurnService } from "./impl/user-vfs-turn.service.js";
import { createAppendToolTurnBridge } from "./impl/append-tool-turn-bridge.js";
import type {
  AppendToolTurnBridgeFn,
  UserVfsTurnService,
} from "./user-vfs-turn.port.js";

/** `createUserVfsTurnServiceBundle` 杩斿洖鍊笺€?*/
export interface UserVfsTurnServiceBundle {
  readonly userVfsTurn: UserVfsTurnService;
  readonly appendToolTurnBridge: AppendToolTurnBridgeFn;
}

/**
 * 鍒涘缓鐢ㄦ埛 VFS turn 鏈嶅姟涓庢ˉ鎺?append 闂寘锛堝叡浜繛鎺ヤ笌 repo锛夈€?
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
  const sessionKkv = createSessionKkvService(conn);

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
    sessionKkv,
    // A-14 path policy：用户 VFS turn 走 toolCtx 也走默认不限制语义；
    // 后续根据 agent 定义 / project 策略收紧时在此注入。
    allowedPaths: undefined,
    resourceQuota: undefined,
  });

  const userVfsTurn = new DefaultUserVfsTurnService({
    conn,
    sessions: sessionRepo,
    sessionKkv,
    messages,
    chatMessages: messageRepo,
    checkpoints: checkpointRepo,
    entries: vfsRepo,
    revisions: revisionRepo,
    toolRunner,
    resolveToolCtx,
    messageCheckpoint: createMessageCheckpointService(conn),
  });

  return {
    userVfsTurn,
    appendToolTurnBridge: createAppendToolTurnBridge(messages),
  };
}

/** 鍒涘缓 {@link UserVfsTurnService} 瀹炰緥銆?*/
export function createUserVfsTurnService(
  conn: TdbcConnection,
): UserVfsTurnService {
  return createUserVfsTurnServiceBundle(conn).userVfsTurn;
}
