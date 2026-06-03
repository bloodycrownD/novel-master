/**
 * Session FS errors: message rollback and batch restore failures.
 *
 * @module errors/session-fs-errors
 */

/** Discriminant codes for {@link SessionFsError}. */
export type SessionFsErrorCode =
  | "ROLLBACK_LEGACY_BATCH"
  | "ROLLBACK_SNAPSHOT_MISSING"
  | "ROLLBACK_MESSAGE_NOT_FOUND"
  | "ROLLBACK_MESSAGE_SESSION_MISMATCH";

/**
 * Unified error for session-fs rollback operations.
 */
export class SessionFsError extends Error {
  readonly code: SessionFsErrorCode;
  readonly sessionId?: string;
  readonly messageId?: string;
  readonly batchId?: string;

  constructor(
    code: SessionFsErrorCode,
    message: string,
    options?: {
      sessionId?: string;
      messageId?: string;
      batchId?: string;
    },
  ) {
    super(message);
    this.name = "SessionFsError";
    this.code = code;
    this.sessionId = options?.sessionId;
    this.messageId = options?.messageId;
    this.batchId = options?.batchId;
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

export function sessionFsRollbackLegacyBatch(sessionId: string): SessionFsError {
  return new SessionFsError(
    "ROLLBACK_LEGACY_BATCH",
    "存在无法关联的旧检查点，请使用 nm session vfs records rollback --batch",
    { sessionId },
  );
}

export function sessionFsRollbackSnapshotMissing(
  batchId: string,
  path: string,
): SessionFsError {
  return new SessionFsError(
    "ROLLBACK_SNAPSHOT_MISSING",
    `回滚所需快照缺失：batch=${batchId} path=${path}`,
    { batchId },
  );
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
