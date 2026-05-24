/**
 * Chat domain errors (project, session, message).
 *
 * @module errors/chat-errors
 */

/** Discriminant codes for {@link ChatError}. */
export type ChatErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_ARGUMENT";

/**
 * Unified error for chat service and repository operations.
 */
export class ChatError extends Error {
  readonly code: ChatErrorCode;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly messageId?: string;

  constructor(
    code: ChatErrorCode,
    message: string,
    options?: {
      projectId?: string;
      sessionId?: string;
      messageId?: string;
    },
  ) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.projectId = options?.projectId;
    this.sessionId = options?.sessionId;
    this.messageId = options?.messageId;
  }
}

/** Entity not found. */
export function chatNotFound(
  kind: string,
  id: string,
  options?: { projectId?: string; sessionId?: string },
): ChatError {
  return new ChatError("NOT_FOUND", `${kind} not found: ${id}`, {
    projectId: options?.projectId,
    sessionId: options?.sessionId,
    messageId: kind === "message" ? id : undefined,
  });
}

/** Invalid argument for chat operations. */
export function chatInvalidArgument(message: string): ChatError {
  return new ChatError("INVALID_ARGUMENT", message);
}
