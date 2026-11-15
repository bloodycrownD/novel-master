/**
 * VFS 错误的结构守卫与 legacy 短码类型。
 *
 * `VfsError` 类已退役（统一 `new AppError("VFS_*", params)` 构造），本文件保留三样：
 * - {@link VfsErrorCode} 字符串短码联合：legacy-vfs-error mapper 手搓旧形态对象、
 *   apps/CLI 的 `name + code` 消费仍走它；与 AppError 的 `VFS_*` key 是两套，不合并。
 * - {@link VfsReplaceNotFoundDetails}：edit REPLACE_NOT_FOUND 的 LCS 诊断字段类型。
 * - {@link isVfsError} 双形态守卫：AppError（`name` 以 `VFS_` 开头且 `code` 为数字）
 *   与 legacy 手搓对象（`name === "VfsError"` + 字符串短码）都能判中，沿 cause 链
 *   回溯。带短码实参时两种形态都精确匹配（AppError 按 `VFS_<短码>` 对 name——
 *   `this.name = key`；legacy 按字符串 code），与 {@link isSessionFsError} 同构。
 *
 * @module errors/vfs-errors
 */

/** VFS 域字符串短码（legacy mapper 形态与结构守卫的实参用，非 AppError key）。 */
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

/** {@link isVfsError} 判中后的结构形状；AppError 形态下 `path` 缺省在 `details.path`。 */
export type LegacyVfsError = Error & {
  readonly code: VfsErrorCode;
  readonly path?: string;
  readonly details?: unknown;
};

/** 双形态结构守卫（src/dist 双模块实例下 instanceof 会 false negative，不走 instanceof）。 */
export function isVfsError(
  error: unknown,
  code?: VfsErrorCode
): error is LegacyVfsError {
  if (matchesVfsError(error, code)) {
    return true;
  }
  if (typeof error === "object" && error !== null && "cause" in error) {
    return matchesVfsError((error as { cause: unknown }).cause, code);
  }
  return false;
}

/** 从 {@link isVfsError} 判中的错误里读 VFS 短码：AppError 形态由 name（= key）去 `VFS_` 前缀反推，legacy 形态读字符串 `code`；非 VFS 错误返回 undefined。 */
export function vfsErrorCodeOf(error: unknown): VfsErrorCode | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  if (typeof candidate.name === "string" && candidate.name.startsWith("VFS_") && typeof candidate.code === "number") {
    return candidate.name.slice("VFS_".length) as VfsErrorCode;
  }
  if (candidate.name === "VfsError" && typeof candidate.code === "string") {
    return candidate.code as VfsErrorCode;
  }
  return undefined;
}

function matchesVfsError(
  error: unknown,
  code?: VfsErrorCode
): error is LegacyVfsError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  const modern = typeof candidate.name === "string" && candidate.name.startsWith("VFS_") && typeof candidate.code === "number";
  if (modern) {
    return code === undefined || candidate.name === `VFS_${code}`;
  }
  return candidate.name === "VfsError" && typeof candidate.code === "string" && (code === undefined || candidate.code === code);
}
