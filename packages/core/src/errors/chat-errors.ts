/**
 * Chat 域错误工厂：统一返回 `AppError`，不再保留独立的 ChatError 类。
 *
 * @module errors/chat-errors
 */

import { AppError } from "./app-error.js";

/** 会话 / 项目 / 消息不存在。 */
export function chatNotFound(kind: string, id: string, options?: { projectId?: string; sessionId?: string }): AppError<"CHAT_NOT_FOUND"> {
  return new AppError("CHAT_NOT_FOUND", `${kind} not found: ${id}`, {
    kind,
    id,
    ...(options?.projectId != null ? { projectId: options.projectId } : {}),
    ...(options?.sessionId != null ? { sessionId: options.sessionId } : {}),
    ...(kind === "message" ? { messageId: id } : {}),
  });
}

/** Chat 操作入参非法。 */
export function chatInvalidArgument(message: string): AppError<"CHAT_INVALID_ARGUMENT"> {
  return new AppError("CHAT_INVALID_ARGUMENT", message);
}
