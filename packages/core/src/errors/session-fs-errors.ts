/**
 * Session FS errors: message rollback failures.
 *
 * @module errors/session-fs-errors
 */

/** Discriminant codes for {@link SessionFsError}. */
export type SessionFsErrorCode =
  | "ROLLBACK_MESSAGE_NOT_FOUND"
  | "ROLLBACK_MESSAGE_SESSION_MISMATCH"
  | "ROLLBACK_NO_CHECKPOINT"
  | "RESTORE_REVISION_MISSING";

/**
 * Unified error for session-fs rollback operations.
 */
export class SessionFsError extends Error {
  readonly code: SessionFsErrorCode;
  readonly sessionId?: string;
  readonly messageId?: string;
  readonly logicalPath?: string;
  readonly revisionVersion?: number;

  constructor(
    code: SessionFsErrorCode,
    message: string,
    options?: {
      sessionId?: string;
      messageId?: string;
      logicalPath?: string;
      revisionVersion?: number;
    },
  ) {
    super(message);
    this.name = "SessionFsError";
    this.code = code;
    this.sessionId = options?.sessionId;
    this.messageId = options?.messageId;
    this.logicalPath = options?.logicalPath;
    this.revisionVersion = options?.revisionVersion;
  }
}

function unwrapCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return error;
  }
  const withCause = error as { cause?: unknown };
  if (withCause.cause != null && withCause.cause !== error) {
    return unwrapCause(withCause.cause);
  }
  return error;
}

/** Type guard for {@link SessionFsError}. */
export function isSessionFsError(
  error: unknown,
  code?: SessionFsErrorCode,
): error is SessionFsError {
  const candidate = unwrapCause(error);
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const err = candidate as { name?: unknown; code?: unknown };
  if (err.name !== "SessionFsError" || typeof err.code !== "string") {
    return false;
  }
  return code === undefined || err.code === code;
}

export function sessionFsRollbackMessageNotFound(messageId: string): SessionFsError {
  return new SessionFsError(
    "ROLLBACK_MESSAGE_NOT_FOUND",
    `消息不存在：${messageId}`,
    { messageId },
  );
}

export function sessionFsRollbackMessageSessionMismatch(
  messageId: string,
  sessionId: string,
): SessionFsError {
  return new SessionFsError(
    "ROLLBACK_MESSAGE_SESSION_MISMATCH",
    `消息不属于当前会话：${messageId}`,
    { messageId, sessionId },
  );
}

export function sessionFsRestoreRevisionMissing(
  logicalPath: string,
  revisionVersion: number,
): SessionFsError {
  return new SessionFsError(
    "RESTORE_REVISION_MISSING",
    `恢复所需 revision 缺失：${logicalPath} v${revisionVersion}`,
    { logicalPath, revisionVersion },
  );
}

/**
 * Raised when rollback is requested but the session has no v2 checkpoint for the anchor.
 *
 * @remarks Typical after upgrading from pre-checkpoint storage: legacy messages have no
 *          `message_checkpoint` rows, so workspace restore is unavailable.
 */
export function sessionFsRollbackNoCheckpoint(
  messageId: string,
  sessionId: string,
): SessionFsError {
  return new SessionFsError(
    "ROLLBACK_NO_CHECKPOINT",
    "该消息无回滚点",
    { messageId, sessionId },
  );
}
