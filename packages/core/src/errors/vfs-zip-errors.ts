/**
 * VFS ZIP import/export errors.
 *
 * @module errors/vfs-zip-errors
 */

import type { MessageParams } from "@/common/i18n.js";
import type { CoreMessageDescriptor, CoreMessageKey } from "@/i18n/keys.js";
import { resolveLocalizedMessage } from "@/i18n/localized-message.js";

/** Discriminant codes for {@link VfsZipError}. */
export type VfsZipErrorCode =
  | "INVALID_ZIP"
  | "INVALID_PATH"
  | "INVALID_UTF8"
  | "DUPLICATE_PATH"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_CONFIRMED"
  | "EXTERNAL_NOT_SUPPORTED"
  | "IMPORT_FAILED";

/**
 * Unified error for VFS ZIP parse, validate, and import/export orchestration.
 *
 * message 通道放宽为 `string | CoreMessageDescriptor`（同 G1.2 口径）：descriptor
 * 时 `Error.message` 取 key 原文，`messageKey`/`messageParams` 供边界翻译
 * （IMPORT_FAILED 的分片进度段即此形态）。
 */
export class VfsZipError extends Error {
  readonly code: VfsZipErrorCode;
  readonly messageKey?: CoreMessageKey;
  readonly messageParams?: MessageParams;

  constructor(code: VfsZipErrorCode, message: string | CoreMessageDescriptor) {
    const localized = resolveLocalizedMessage(message);
    super(localized.text);
    this.name = "VfsZipError";
    this.code = code;
    this.messageKey = localized.messageKey;
    this.messageParams = localized.messageParams;
  }
}

export function vfsZipError(
  code: VfsZipErrorCode,
  message: string | CoreMessageDescriptor
): VfsZipError {
  return new VfsZipError(code, message);
}
