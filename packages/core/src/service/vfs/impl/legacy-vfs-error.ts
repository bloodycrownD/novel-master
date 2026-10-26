/**
 * service 边界：把 domain AppError 翻回 VfsService / VfsZipIoService 的 phase 1 旧错误契约。
 *
 * 旧契约（VfsError / VfsZipError）仍被 apps、CLI 与既有测试按 code 分支消费，
 * 因此 service 在解包 Result 时保留原 message 与 path/details，不新增壳字段。
 * phase 2 端口与 app 全部改认 AppError 后删除本文件。
 *
 * @module service/vfs/impl/legacy-vfs-error
 */

import { AppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import { VfsError, type VfsErrorCode } from "@/errors/vfs-errors.js";
import { VfsZipError, type VfsZipErrorCode } from "@/errors/vfs-zip-errors.js";

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

/** 解包失败：VFS key 翻成 VfsError，其余 AppError 原样抛出。 */
export function throwLegacyVfs(error: AppError): never {
  const code = APP_TO_VFS[error.key];
  if (code == null) {
    throw error;
  }
  const path = typeof error.details?.path === "string" ? error.details.path : undefined;
  throw new VfsError(code, error.message, { path, ...(error.details?.details !== undefined ? { details: error.details.details } : {}) });
}

/** 解包失败：VFS_ZIP_* key 翻成 VfsZipError，其余 AppError 原样抛出。 */
export function throwLegacyVfsZip(error: AppError): never {
  const code = APP_TO_VFS_ZIP[error.key];
  if (code == null) {
    throw error;
  }
  throw new VfsZipError(code, error.message);
}
