// legacy-port: VfsService / VfsRestorePort — phase 2 端口实现改抛 AppError 后删除。
/**
 * legacy 手搓旧形态对象 → AppError 的单一映射。
 *
 * service 层端口（`VfsService` / `VfsRestorePort` 的实现）一期仍经
 * `service/vfs/impl/legacy-vfs-error` 抛旧形态对象（`name + 字符串 code`），
 * domain 消费点判别后经本桥翻回 AppError；映射保留原 message 与 path，
 * 原错误挂到 details.cause，方便 phase 2 排查。
 *
 * @module domain/vfs/logic/vfs-port-error
 */

import { AppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import type { LegacyVfsError, VfsErrorCode } from "@/errors/vfs-errors.js";

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

/** 把端口异常翻成 AppError：AppError 形态原样返回，legacy 旧形态转换（保留 message / path / details）。 */
export function vfsPortError(error: LegacyVfsError | VfsPortError): VfsPortError {
  if (typeof error.code === "number") {
    return error;
  }
  return new AppError(VFS_ERROR_KEYS[error.code], error.message, {
    path: error.path,
    ...(error.details != null ? { details: error.details } : {}),
    cause: error,
  });
}
