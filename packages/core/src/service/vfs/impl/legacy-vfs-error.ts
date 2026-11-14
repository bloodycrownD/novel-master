/**
 * service 边界：把 domain AppError 翻回 VfsService / VfsZipIoService 的 phase 1 旧错误契约。
 *
 * 旧契约（`name === "VfsError"` / `name === "VfsZipError"` 手搓对象）仍被 apps、CLI 与既有测试按 code 分支消费，
 * 因此 service 在解包 Result 时保留原 message 与 path/details，不新增壳字段。
 * phase 2 端口与 app 全部改认 AppError 后删除本文件。
 *
 * @module service/vfs/impl/legacy-vfs-error
 */

import { AppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import type { VfsErrorCode } from "@/errors/vfs-errors.js";
import type { MessageParams } from "@/common/i18n.js";
import type { CoreMessageDescriptor, CoreMessageKey } from "@/i18n/keys.js";
import { resolveLocalizedMessage } from "@/i18n/localized-message.js";

/** VfsZip 旧形态字符串短码（VfsZipError 类退役后仅本 mapper 生产/消费）。 */
type VfsZipErrorCode =
  | "INVALID_ZIP"
  | "INVALID_PATH"
  | "INVALID_UTF8"
  | "DUPLICATE_PATH"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_CONFIRMED"
  | "EXTERNAL_NOT_SUPPORTED"
  | "IMPORT_FAILED";

const APP_TO_VFS: Partial<Record<ErrorKey, VfsErrorCode>> = {
  VFS_NOT_FOUND: "NOT_FOUND",
  VFS_REPLACE_NOT_FOUND: "REPLACE_NOT_FOUND",
  VFS_DIRECTORY_NOT_EMPTY: "DIRECTORY_NOT_EMPTY",
  VFS_INVALID_PATH: "INVALID_PATH",
  VFS_INVALID_NAME: "INVALID_NAME",
  VFS_IS_DIRECTORY: "IS_DIRECTORY",
  VFS_ALREADY_EXISTS: "ALREADY_EXISTS",
  VFS_NOT_A_DIRECTORY: "NOT_A_DIRECTORY",
  VFS_PARENT_NOT_FOUND: "PARENT_NOT_FOUND",
};

const APP_TO_VFS_ZIP: Partial<Record<ErrorKey, VfsZipErrorCode>> = {
  VFS_ZIP_INVALID_ARCHIVE: "INVALID_ZIP",
  VFS_ZIP_INVALID_PATH: "INVALID_PATH",
  VFS_ZIP_INVALID_UTF8: "INVALID_UTF8",
  VFS_ZIP_DUPLICATE_PATH: "DUPLICATE_PATH",
  VFS_ZIP_PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
};

/** 解包失败：VFS key 翻成 legacy 旧形态对象（`name + code` 手搓，VfsError 类已退役），其余 AppError 原样抛出（descriptor 随 messageKey 透传）。 */
export function throwLegacyVfs(error: AppError): never {
  const code = APP_TO_VFS[error.key];
  if (code == null) {
    throw error;
  }
  const path = typeof error.details?.path === "string" ? error.details.path : undefined;
  const localized = resolveLocalizedMessage(legacyMessageOf(error));
  throw Object.assign(new Error(localized.text), {name: "VfsError", code, ...(path != null ? {path} : {}), ...(error.details?.details !== undefined ? {details: error.details.details} : {}), ...(localized.messageKey != null ? {messageKey: localized.messageKey as CoreMessageKey, messageParams: localized.messageParams as MessageParams} : {})});
}

/** 解包失败：VFS_ZIP_* key 翻成 legacy 旧形态对象（`name + code` 手搓，VfsZipError 类已退役），其余 AppError 原样抛出（descriptor 随 messageKey 透传）。 */
export function throwLegacyVfsZip(error: AppError): never {
  const code = APP_TO_VFS_ZIP[error.key];
  if (code == null) {
    throw error;
  }
  const localized = resolveLocalizedMessage(legacyMessageOf(error));
  throw Object.assign(new Error(localized.text), {name: "VfsZipError", code, ...(localized.messageKey != null ? {messageKey: localized.messageKey as CoreMessageKey, messageParams: localized.messageParams as MessageParams} : {})});
}

/** 原 message（string 路径）或 descriptor（迁移后的 messageKey 路径）二选一透传。 */
function legacyMessageOf(error: AppError): string | CoreMessageDescriptor {
  return error.messageKey == null ? error.message : {key: error.messageKey, ...(error.messageParams != null ? {params: error.messageParams} : {})};
}
