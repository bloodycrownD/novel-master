/**
 * 云同步错误模型：统一错误码与用户可读消息方向。
 *
 * message 通道放宽为 `string | CoreMessageDescriptor`（spec §5 G1.2）：descriptor
 * 时 `Error.message` 取 key 原文，`messageKey`/`messageParams` 供边界
 * `userMessageOf` + translator 翻译。
 *
 * @module infra/cloud-sync/errors/cloud-sync-errors
 */

import type { MessageParams } from "@/common/i18n.js";
import type { CoreMessageDescriptor, CoreMessageKey } from "@/i18n/keys.js";
import { resolveLocalizedMessage } from "@/i18n/localized-message.js";

/** 云同步可辨识错误码 */
export type CloudSyncErrorCode =
  | "NOT_CONFIGURED"
  | "NEED_PULL_FIRST"
  | "LOCK_HELD_BY_OTHER"
  | "LOCK_CONTENTION"
  | "AGENT_ACTIVE"
  | "PUSH_MUTEX_TIMEOUT"
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
  readonly messageKey?: CoreMessageKey;
  readonly messageParams?: MessageParams;
  declare readonly cause?: unknown;

  constructor(
    code: CloudSyncErrorCode,
    message: string | CoreMessageDescriptor,
    options?: { cause?: unknown }
  ) {
    const localized = resolveLocalizedMessage(message);
    super(localized.text, { cause: options?.cause });
    this.name = "CloudSyncError";
    this.code = code;
    this.messageKey = localized.messageKey;
    this.messageParams = localized.messageParams;
  }
}

/** 判断未知值是否为 {@link CloudSyncError} */
export function isCloudSyncError(value: unknown): value is CloudSyncError {
  return value instanceof CloudSyncError;
}
