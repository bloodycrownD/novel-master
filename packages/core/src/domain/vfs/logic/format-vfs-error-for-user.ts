/**
 * 终端用户可见的 VFS 相关错误文案（descriptor 形态，G1.5）。
 *
 * 只产出 `CoreMessageDescriptor`（key + params），不含文案、不依赖 locale；
 * 由宿主用 catalog + `createTranslator` 渲染（同 chat 通道口径）。
 *
 * @module domain/vfs/logic/format-vfs-error-for-user
 */

import { isAppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import { ToolError } from "@/errors/tool-errors.js";
import { VfsError, isVfsError, type VfsErrorCode } from "@/errors/vfs-errors.js";
import type { CoreMessageDescriptor, CoreMessageKey } from "@/i18n/keys.js";
import { CORE_MESSAGE_KEYS } from "@/i18n/keys.js";
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

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>(CORE_MESSAGE_KEYS);

/** 兜底文案：`操作失败：{detail}`。 */
function operationFailed(detail: string): CoreMessageDescriptor {
  return {key: "error.vfs.operation_failed", params: {detail}};
}

/**
 * 终端用户可见 VFS 文案 descriptor；与 formatVfsErrorForLlm 分离。
 */
export function vfsUserMessage(error: unknown, _scope?: VfsScope): CoreMessageDescriptor {
  if (error instanceof ToolError && error.cause != null) {
    return vfsUserMessage(error.cause, _scope);
  }
  // 错误自带 messageKey（迁移后的抛错点）→ 直接透传 descriptor。
  if (typeof error === "object" && error !== null) {
    const messageKey = (error as {messageKey?: unknown}).messageKey;
    if (typeof messageKey === "string" && KNOWN_KEYS.has(messageKey)) {
      const params = (error as {messageParams?: unknown}).messageParams;
      return {key: messageKey as CoreMessageKey, ...(typeof params === "object" && params !== null ? {params: params as CoreMessageDescriptor["params"]} : {})};
    }
  }

  let shape: VfsErrorLike | null;
  if (error instanceof VfsError) {
    shape = { code: error.code, message: error.message, path: error.path };
  } else if (isAppError(error)) {
    const code = APP_ERROR_TO_VFS_CODE[error.key];
    shape = code == null ? null : { code, message: error.message, path: typeof error.details?.path === "string" ? error.details.path : undefined };
    if (shape == null) {
      return operationFailed(error.message);
    }
  } else if (isVfsError(error)) {
    shape = { code: (error as VfsError).code, message: (error as VfsError).message, path: (error as VfsError).path };
  } else if (typeof error === "object" && error !== null && "code" in error && "message" in error && typeof (error as IpcLikeError).code === "string" && typeof (error as IpcLikeError).message === "string") {
    // IPC 边界只留下 code/message：复用旧 VfsError 构造后再走同一张文案表。
    return vfsUserMessage(new VfsError((error as IpcLikeError).code as VfsErrorCode, (error as IpcLikeError).message, { path: undefined }), _scope);
  } else if (error instanceof Error) {
    return operationFailed(error.message);
  } else {
    return operationFailed(String(error));
  }

  switch (shape.code) {
    case "REPLACE_NOT_FOUND":
      return {key: "error.vfs.replace_not_found"};
    case "NOT_FOUND":
      return {key: "error.vfs.not_found"};
    case "ALREADY_EXISTS":
      // 重名是用户高频可自行纠正的错误，双端（desktop/mobile）统一收敛到本表，
      // 不再在调用侧各自补映射
      return {key: "error.vfs.already_exists"};
    case "INVALID_NAME":
      // message 就是 validateVfsEntryName 的 reason（迁移后为 key 原文）；
      // translator 对未知 key 原样回显，与旧的中文透传语义一致
      return {key: shape.message as CoreMessageKey};
    default: {
      // entry_id 化后 path 就是逻辑路径；scope 参数保留兼容签名，不再用于转换。
      const pathHint = shape.path ?? stripKnownPhysicalPrefixes(shape.message);
      const reason = stripKnownPhysicalPrefixes(shape.message);
      return operationFailed(pathHint.length > 0 && pathHint !== reason ? pathHint : reason);
    }
  }
}
