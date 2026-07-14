/**
 * {@link MessageTranscriptEffectsService} 工厂。
 *
 * @module service/chat/create-message-transcript-effects
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { DefaultMessageTranscriptEffectsService } from "./impl/message-transcript-effects.service.js";
import type { MessageTranscriptEffectsService } from "./message-transcript-effects.port.js";
import { createMessageService } from "./create-chat-services.js";

/**
 * 创建消息 transcript 副作用服务（置位成功时 clear session kkv）。
 *
 * @param conn - 已 bootstrap 的数据库连接
 */
export function createMessageTranscriptEffectsService(
  conn: TdbcConnection,
): MessageTranscriptEffectsService {
  return new DefaultMessageTranscriptEffectsService({
    conn,
    messages: createMessageService(conn),
    sessionKkv: createSessionKkvService(conn),
  });
}
