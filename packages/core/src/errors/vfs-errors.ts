/**
 * VFS domain errors: typed codes for path and replace failures.
 *
 * message 通道放宽为 `string | CoreMessageDescriptor`（spec §5 G1.2）：descriptor
 * 时 `Error.message` 取 key 原文，`messageKey`/`messageParams` 供边界
 * `userMessageOf` + translator 翻译。
 *
 * @module errors/vfs-errors
 */

import type { MessageParams } from "@/common/i18n.js";
import type { CoreMessageDescriptor, CoreMessageKey } from "@/i18n/keys.js";
import { resolveLocalizedMessage } from "@/i18n/localized-message.js";

/**
 * edit REPLACE_NOT_FOUND 时的 LCS 诊断字段。
 *
 * oldStringPreview / fileHintPreview 是双方前 100 字符的**原始文本**预览，
 * 由 formatter 以 JSON 转义形态展示——中文引号、HTML entity、换行/制表
 * 这类「肉眼看着一样或看不见」的差异会直接显形（`“` vs `"` vs `&ldquo;`、
 * `\n`/`\t`），且 LLM 可直接照抄修正 oldString（hex 码点无法反向消费，已退役）。
 * 设为可选，老的对象字面量构造路径不强制要求。
 */
export type VfsReplaceNotFoundDetails = {
  readonly oldStringLength: number;
  readonly longestCommonSubstring: string;
  readonly lcsLength: number;
  readonly lcsOccurrences: number;
  readonly oldStringPreview?: string;
  readonly fileHintPreview?: string;
};

/** Discriminant codes for {@link VfsError}. */
export type VfsErrorCode =
  | "NOT_FOUND"
  | "REPLACE_NOT_FOUND"
  | "DIRECTORY_NOT_EMPTY"
  | "INVALID_PATH"
  | "INVALID_NAME"
  | "IS_DIRECTORY"
  | "ALREADY_EXISTS"
  | "NOT_A_DIRECTORY"
  | "PARENT_NOT_FOUND";

/**
 * Unified error for VFS service and repository operations.
 */
export class VfsError extends Error {
  readonly code: VfsErrorCode;
  readonly path?: string;
  readonly details?: unknown;
  readonly messageKey?: CoreMessageKey;
  readonly messageParams?: MessageParams;

  constructor(
    code: VfsErrorCode,
    message: string | CoreMessageDescriptor,
    options?: {
      path?: string;
      details?: unknown;
    }
  ) {
    const localized = resolveLocalizedMessage(message);
    super(localized.text);
    this.name = "VfsError";
    this.code = code;
    this.path = options?.path;
    this.details = options?.details;
    this.messageKey = localized.messageKey;
    this.messageParams = localized.messageParams;
  }
}

/** Type guard that works across duplicate module instances (e.g. src vs dist in tests). */
export function isVfsError(
  error: unknown,
  code?: VfsErrorCode
): error is VfsError {
  if (matchesVfsError(error, code)) {
    return true;
  }
  if (typeof error === "object" && error !== null && "cause" in error) {
    return matchesVfsError((error as { cause: unknown }).cause, code);
  }
  return false;
}

function matchesVfsError(
  error: unknown,
  code?: VfsErrorCode
): error is VfsError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== "VfsError" || typeof candidate.code !== "string") {
    return false;
  }
  return code === undefined || candidate.code === code;
}

/** Path does not exist. */
export function vfsNotFound(path: string): VfsError {
  return new VfsError("NOT_FOUND", `Path not found: ${path}`, { path });
}

/** Replace oldString not found in content. */
export function vfsReplaceNotFound(
  path: string,
  details?: VfsReplaceNotFoundDetails
): VfsError {
  return new VfsError(
    "REPLACE_NOT_FOUND",
    `Replace string not found in ${path}`,
    { path, ...(details != null ? { details } : {}) }
  );
}

/** Non-recursive delete blocked by child paths. */
export function vfsDirectoryNotEmpty(path: string): VfsError {
  return new VfsError("DIRECTORY_NOT_EMPTY", `Directory not empty: ${path}`, {
    path,
  });
}

/** Invalid or non-normalizable path（reason 可为 descriptor，如 legacy /template 拒绝）。 */
export function vfsInvalidPath(path: string, reason: string | CoreMessageDescriptor): VfsError {
  return new VfsError("INVALID_PATH", typeof reason === "string" ? `Invalid path ${path}: ${reason}` : reason, {
    path,
  });
}

/**
 * Entry name rejected by {@link validateVfsEntryName}（创建/重命名入口拦截）。
 *
 * message 传中文 reason 或 descriptor（invalid_name.* 子段）；LLM 面由
 * format-vfs-error-for-llm 包装 `[INVALID_NAME]` 前缀与路径。
 */
export function vfsInvalidName(name: string, reason: string | CoreMessageDescriptor): VfsError {
  return new VfsError("INVALID_NAME", reason, { path: name });
}

/** Path is a directory row; read/write/replace are not allowed. */
export function vfsIsDirectory(path: string): VfsError {
  return new VfsError("IS_DIRECTORY", `Path is a directory: ${path}`, { path });
}

/** mkdir target already exists. */
export function vfsAlreadyExists(path: string): VfsError {
  return new VfsError("ALREADY_EXISTS", `Path already exists: ${path}`, {
    path,
  });
}

/** Parent path exists as a file row. */
export function vfsNotADirectory(path: string): VfsError {
  return new VfsError("NOT_A_DIRECTORY", `Not a directory: ${path}`, { path });
}

/** mkdir parent path does not exist. */
export function vfsParentNotFound(path: string): VfsError {
  return new VfsError("PARENT_NOT_FOUND", `Parent not found: ${path}`, {
    path,
  });
}
