/**
 * 终端用户可见的 VFS 相关中文错误文案。
 *
 * @module domain/vfs/logic/format-vfs-error-for-user
 */

import { isAppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import { ToolError } from "@/errors/tool-errors.js";
import { VfsError, isVfsError, type VfsErrorCode } from "@/errors/vfs-errors.js";
import { stripKnownPhysicalPrefixes } from "./strip-known-physical-prefixes.js";
import type { VfsScope } from "./vfs-path-mapper.js";

type IpcLikeError = {
  readonly code: string;
  readonly message: string;
};

type VfsErrorLike = {
  readonly code: VfsErrorCode;
  readonly message: string;
  readonly path?: string;
};

const APP_ERROR_TO_VFS_CODE: Partial<Record<ErrorKey, VfsErrorCode>> = {
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

/**
 * 终端用户可见中文文案；与 {@link formatVfsErrorForLlm} 分离。
 */
export function formatVfsErrorForUser(error: unknown, _scope?: VfsScope): string {
  if (error instanceof ToolError && error.cause != null) {
    return formatVfsErrorForUser(error.cause, _scope);
  }

  let shape: VfsErrorLike | null;
  if (error instanceof VfsError) {
    shape = { code: error.code, message: error.message, path: error.path };
  } else if (isAppError(error)) {
    const code = APP_ERROR_TO_VFS_CODE[error.key];
    shape = code == null ? null : { code, message: error.message, path: typeof error.details?.path === "string" ? error.details.path : undefined };
    if (shape == null) {
      return error.message;
    }
  } else if (isVfsError(error)) {
    shape = { code: (error as VfsError).code, message: error.message, path: (error as VfsError).path };
  } else if (typeof error === "object" && error !== null && "code" in error && "message" in error && typeof (error as IpcLikeError).code === "string" && typeof (error as IpcLikeError).message === "string") {
    // IPC 边界只留下 code/message：复用旧 VfsError 构造后再走同一张文案表。
    return formatVfsErrorForUser(new VfsError((error as IpcLikeError).code as VfsErrorCode, (error as IpcLikeError).message, { path: undefined }), _scope);
  } else if (error instanceof Error) {
    return error.message;
  } else {
    return String(error);
  }

  switch (shape.code) {
    case "REPLACE_NOT_FOUND":
      return "文件内容已变更，无法应用本次修改。请刷新文件后重新编辑。";
    case "NOT_FOUND":
      return "文件不存在或已被删除。";
    case "ALREADY_EXISTS":
      // 重名是用户高频可自行纠正的错误，双端（desktop/mobile）统一收敛到本表，
      // 不再在调用侧各自补映射
      return "名称不能重复";
    case "INVALID_NAME":
      // message 就是 validateVfsEntryName 的中文 reason，直接透出
      return shape.message;
    default: {
      // entry_id 化后 path 就是逻辑路径；scope 参数保留兼容签名，不再用于转换。
      const pathHint = shape.path ?? stripKnownPhysicalPrefixes(shape.message);
      const reason = stripKnownPhysicalPrefixes(shape.message);
      return pathHint.length > 0 && pathHint !== reason ? `操作失败：${pathHint}` : `操作失败：${reason}`;
    }
  }
}
