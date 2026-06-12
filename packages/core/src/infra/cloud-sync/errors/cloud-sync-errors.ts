/**
 * 云同步错误模型：统一错误码与用户可读消息方向。
 *
 * @module infra/cloud-sync/errors/cloud-sync-errors
 */

/** 云同步可辨识错误码 */
export type CloudSyncErrorCode =
  | "NOT_CONFIGURED"
  | "NEED_PULL_FIRST"
  | "LOCK_HELD_BY_OTHER"
  | "LOCK_CONTENTION"
  | "AGENT_ACTIVE"
  | "ALREADY_UP_TO_DATE"
  | "INVALID_STATUS"
  | "SNAPSHOT_MISSING"
  | "CHECKSUM_MISMATCH"
  | "NETWORK"
  | "AUTH";

/**
 * 云同步操作统一错误类型。
 */
export class CloudSyncError extends Error {
  readonly code: CloudSyncErrorCode;
  declare readonly cause?: unknown;

  constructor(
    code: CloudSyncErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "CloudSyncError";
    this.code = code;
  }
}

/** 判断未知值是否为 {@link CloudSyncError} */
export function isCloudSyncError(value: unknown): value is CloudSyncError {
  return value instanceof CloudSyncError;
}
