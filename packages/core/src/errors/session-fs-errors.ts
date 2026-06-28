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
  | "RESTORE_REVISION_MISSING"
  | "ROLLBACK_VFS_RESTORE_FAILED"
  | "ROLLBACK_REVISION_BACKFILL_REQUIRED";

/**
 * Unified error for session-fs rollback operations.
 */
export class SessionFsError extends Error {
  readonly code: SessionFsErrorCode;
  readonly sessionId?: string;
  readonly messageId?: string;
  readonly logicalPath?: string;
  readonly revisionVersion?: number;
  readonly missingLogicalPaths?: readonly string[];

  constructor(
    code: SessionFsErrorCode,
    message: string,
    options?: {
      sessionId?: string;
      messageId?: string;
      logicalPath?: string;
      revisionVersion?: number;
      missingLogicalPaths?: readonly string[];
    },
  ) {
    super(message);
    this.name = "SessionFsError";
    this.code = code;
    this.sessionId = options?.sessionId;
    this.messageId = options?.messageId;
    this.logicalPath = options?.logicalPath;
    this.revisionVersion = options?.revisionVersion;
    this.missingLogicalPaths = options?.missingLogicalPaths;
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
 * Reserved error code for rollback-without-checkpoint scenarios.
 *
 * @remarks Rollback no longer throws this: message truncation always proceeds; workspace
 *          restore uses prior/empty tree when no checkpoint exists.
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

/** VFS reconcile 失败，UI 可提供仅截断消息的降级回滚。 */
export function sessionFsRollbackVfsRestoreFailed(
  message: string,
  options?: {
    sessionId?: string;
    messageId?: string;
    logicalPath?: string;
  },
): SessionFsError {
  return new SessionFsError("ROLLBACK_VFS_RESTORE_FAILED", message, options);
}

/**
 * checkpoint revision 缺失，需用户确认 head 回补后再回滚。
 */
export function sessionFsRollbackRevisionBackfillRequired(
  missingLogicalPaths: readonly string[],
  options?: {
    sessionId?: string;
    messageId?: string;
  },
): SessionFsError {
  const paths = missingLogicalPaths.join(", ");
  return new SessionFsError(
    "ROLLBACK_REVISION_BACKFILL_REQUIRED",
    `回滚所需 revision 缺失，需确认使用最新内容修复：${paths}`,
    { ...options, missingLogicalPaths },
  );
}

/** 判断是否为 revision 缺失需回补错误（含 cause 链）。 */
export function isRollbackRevisionBackfillRequiredError(
  error: unknown,
): boolean {
  return isSessionFsError(error, "ROLLBACK_REVISION_BACKFILL_REQUIRED");
}

/**
 * 判断错误是否可降级为仅截断消息（含 cause 链）。
 *
 * @remarks 当 error 或其 cause 链中存在 `ROLLBACK_VFS_RESTORE_FAILED` 时返回 true。
 */
export function isRollbackVfsDegradableError(error: unknown): boolean {
  return isSessionFsError(error, "ROLLBACK_VFS_RESTORE_FAILED");
}
