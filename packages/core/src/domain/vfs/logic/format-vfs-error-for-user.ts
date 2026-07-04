/**
 * 终端用户可见的 VFS 相关中文错误文案。
 *
 * @module domain/vfs/logic/format-vfs-error-for-user
 */

import { ToolError } from "@/errors/tool-errors.js";
import { VfsError, isVfsError } from "@/errors/vfs-errors.js";
import { stripKnownPhysicalPrefixes } from "./strip-known-physical-prefixes.js";
import { type VfsScope, toLogicalPath } from "./vfs-path-mapper.js";

type IpcLikeError = {
  readonly code: string;
  readonly message: string;
};

function isIpcLikeError(error: unknown): error is IpcLikeError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as IpcLikeError).code === "string" &&
    typeof (error as IpcLikeError).message === "string"
  );
}

function resolveDisplayPath(vfsError: VfsError, scope?: VfsScope): string {
  if (vfsError.path == null) {
    return stripKnownPhysicalPrefixes(vfsError.message);
  }
  if (scope == null) {
    return stripKnownPhysicalPrefixes(vfsError.path);
  }
  try {
    return toLogicalPath(scope, vfsError.path);
  } catch {
    return stripKnownPhysicalPrefixes(vfsError.path);
  }
}

function formatVfsErrorCodeMessage(
  vfsError: VfsError,
  scope?: VfsScope,
): string {
  switch (vfsError.code) {
    case "REPLACE_NOT_FOUND":
      return "文件内容已变更，无法应用本次修改。请刷新文件后重新编辑。";
    case "CONFLICT":
      return "文件版本冲突，请刷新后重试。";
    case "NOT_FOUND":
      return "文件不存在或已被删除。";
    default: {
      const pathHint = resolveDisplayPath(vfsError, scope);
      const reason = stripKnownPhysicalPrefixes(vfsError.message);
      return pathHint.length > 0 && pathHint !== reason
        ? `操作失败：${pathHint}`
        : `操作失败：${reason}`;
    }
  }
}

function ipcPayloadToVfsError(payload: IpcLikeError): VfsError {
  return new VfsError(
    payload.code as VfsError["code"],
    payload.message,
    { path: undefined },
  );
}

/**
 * 终端用户可见中文文案；与 {@link formatVfsErrorForLlm} 分离。
 */
export function formatVfsErrorForUser(
  error: unknown,
  scope?: VfsScope,
): string {
  if (error instanceof ToolError && error.cause != null) {
    return formatVfsErrorForUser(error.cause, scope);
  }
  if (error instanceof VfsError) {
    return formatVfsErrorCodeMessage(error, scope);
  }
  if (isVfsError(error)) {
    return formatVfsErrorCodeMessage(error as VfsError, scope);
  }
  if (isIpcLikeError(error)) {
    return formatVfsErrorForUser(ipcPayloadToVfsError(error), scope);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
