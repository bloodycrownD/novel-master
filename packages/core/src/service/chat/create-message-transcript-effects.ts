/**
 * {@link MessageTranscriptEffectsService} 工厂。
 *
 * @module service/chat/create-message-transcript-effects
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SessionWorktreeSnapshotStore } from "@/service/prompt/session-worktree-snapshot.port.js";
import { DefaultMessageTranscriptEffectsService } from "./impl/message-transcript-effects.service.js";
import type { MessageTranscriptEffectsService } from "./message-transcript-effects.port.js";
import { createMessageService } from "./create-chat-services.js";

/**
 * 创建消息 transcript 副作用服务。
 *
 * @param conn - 已 bootstrap 的数据库连接
 * @param worktreeSnapshot - session worktree 快照存储
 */
export function createMessageTranscriptEffectsService(
  conn: TdbcConnection,
  worktreeSnapshot: SessionWorktreeSnapshotStore,
): MessageTranscriptEffectsService {
  return new DefaultMessageTranscriptEffectsService({
    conn,
    messages: createMessageService(conn),
    worktreeSnapshot,
  });
}
