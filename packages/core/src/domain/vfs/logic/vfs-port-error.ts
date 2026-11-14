/**
 * VFS 端口失败载荷类型。
 *
 * `vfsPortError` 桥（旧 VfsError → AppError）已随端口实现统一改抛 AppError 删除；
 * 本文件只保留 `copyVfsPath` / `moveVfsPath` 的 Result 错误类型别名。
 *
 * @module domain/vfs/logic/vfs-port-error
 */

import { isAppError, type AppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import type { VfsErrorCode } from "@/errors/vfs-errors.js";

const VFS_ERROR_KEYS = {
  NOT_FOUND: "VFS_NOT_FOUND",
  REPLACE_NOT_FOUND: "VFS_REPLACE_NOT_FOUND",
  DIRECTORY_NOT_EMPTY: "VFS_DIRECTORY_NOT_EMPTY",
  INVALID_PATH: "VFS_INVALID_PATH",
  INVALID_NAME: "VFS_INVALID_NAME",
  IS_DIRECTORY: "VFS_IS_DIRECTORY",
  ALREADY_EXISTS: "VFS_ALREADY_EXISTS",
  NOT_A_DIRECTORY: "VFS_NOT_A_DIRECTORY",
  PARENT_NOT_FOUND: "VFS_PARENT_NOT_FOUND",
} as const satisfies Record<VfsErrorCode, ErrorKey>;

/** 端口异常转换后的失败载荷。 */
export type VfsPortError = AppError<(typeof VFS_ERROR_KEYS)[VfsErrorCode]>;

/** 端口失败载荷守卫：VFS_* 前缀的 AppError（端口已统一抛 AppError）。 */
export function isVfsPortError(error: unknown): error is VfsPortError {
  return isAppError(error) && error.key.startsWith("VFS_");
}
