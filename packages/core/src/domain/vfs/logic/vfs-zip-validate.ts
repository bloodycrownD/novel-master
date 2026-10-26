/**
 * Pure validation for VFS ZIP import payloads.
 *
 * @module domain/vfs/logic/vfs-zip-validate
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsScope } from "./vfs-path-mapper.js";
import { assertLogicalPathAllowed } from "./vfs-path-mapper.js";
import { assertZipEntriesNotDomainRootPrefixed, logicalFromZipDirectoryEntryRelativeToDirectory, logicalFromZipEntryRelativeToDirectory, resolveZipDirectoryPath } from "./vfs-zip-path.js";

// 闸门常量搬到 vfs-zip-limits.ts（解析器也要用同一组值，独立成模块才能避免
// 解析器 ←→ 校验器的循环依赖）。这里 import + 再导出，保持既有 import 面不变。
import { VFS_ZIP_MAX_UNCOMPRESSED_BYTES, VFS_ZIP_MAX_ENTRY_COUNT, VFS_ZIP_MAX_ENTRY_PATH_LEN } from "./vfs-zip-limits.js";

export { VFS_ZIP_MAX_UNCOMPRESSED_BYTES, VFS_ZIP_MAX_ENTRY_COUNT, VFS_ZIP_MAX_ENTRY_PATH_LEN };

/** Validated ZIP payload ready for DB import. */
interface VfsZipValidatedPayload {
  readonly files: ReadonlyMap<string, string>;
  /** Logical directory paths (e.g. `/empty-dir`), shallow paths first. */
  readonly directories: readonly string[];
}

/** validateVfsZipEntries 的失败载荷。 */
type VfsZipValidateError = AppError<"VFS_ZIP_INVALID_ARCHIVE" | "VFS_ZIP_INVALID_PATH" | "VFS_ZIP_INVALID_UTF8" | "VFS_ZIP_DUPLICATE_PATH" | "VFS_ZIP_PAYLOAD_TOO_LARGE">;

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

function assertZipEntryNameAllowed(entryName: string): VfsZipValidateError | null {
  if (entryName.length === 0) {
    return null;
  }
  if (entryName.length > VFS_ZIP_MAX_ENTRY_PATH_LEN) {
    return new AppError("VFS_ZIP_PAYLOAD_TOO_LARGE", `ZIP entry path exceeds ${VFS_ZIP_MAX_ENTRY_PATH_LEN} characters: ${entryName}`);
  }
  if (entryName.includes("\\")) {
    return new AppError("VFS_ZIP_INVALID_PATH", `backslash in ZIP entry: ${entryName}`);
  }
  if (entryName.includes("..")) {
    return new AppError("VFS_ZIP_INVALID_PATH", `parent segment in ZIP entry: ${entryName}`);
  }
  if (WINDOWS_DRIVE_PATH.test(entryName)) {
    return new AppError("VFS_ZIP_INVALID_PATH", `absolute Windows path in ZIP: ${entryName}`);
  }
  const lower = entryName.toLowerCase();
  if (lower.startsWith("projects/") || lower.startsWith("/projects/")) {
    return new AppError("VFS_ZIP_INVALID_PATH", `cross-domain path prefix in ZIP entry: ${entryName}`);
  }
  return null;
}

/**
 * Decodes bytes as UTF-8 text; rejects invalid sequences.
 * Uses round-trip encoding (not `fatal: true`) so Hermes matches Node behavior.
 */
export function decodeUtf8Entry(bytes: Uint8Array, entryName: string): Result<string, AppError<"VFS_ZIP_INVALID_UTF8">> {
  // 去掉 UTF-8 BOM 再解码；round-trip 比对覆盖 BOM 之后的每个字节。
  const payload = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  const decoded = new TextDecoder("utf-8").decode(payload);
  const roundTrip = new TextEncoder().encode(decoded);
  let same = payload.length === roundTrip.length;
  for (let i = 0; same && i < payload.length; i++) {
    same = payload[i] === roundTrip[i];
  }
  if (!same) {
    return Result.err(new AppError("VFS_ZIP_INVALID_UTF8", `ZIP entry "${entryName}" is not valid UTF-8 text (${bytes.byteLength} bytes)`));
  }
  return Result.ok(decoded);
}

function assertLogicalAllowed(scope: VfsScope, logical: string, entryName: string): AppError<"VFS_ZIP_INVALID_PATH"> | null {
  try {
    assertLogicalPathAllowed(scope, logical);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "path not allowed for scope";
    return new AppError("VFS_ZIP_INVALID_PATH", `ZIP entry "${entryName}" → logical "${logical}": ${message}`);
  }
}

/**
 * Validates raw ZIP entries and returns files + explicit empty directories.
 * Does not touch the database.
 *
 * @param directoryPath - 导入目标目录（缺省 `/`）；entry 相对该目录。
 */
export function validateVfsZipEntries(scope: VfsScope, entries: ReadonlyMap<string, Uint8Array>, directoryPath?: string): Result<VfsZipValidatedPayload, VfsZipValidateError> {
  const targetDir = resolveZipDirectoryPath(directoryPath);
  const fileEntries: Array<{ entryName: string; bytes: Uint8Array }> = [];
  const directoryEntries: string[] = [];
  /** 用于「带域根前缀」判定的相对路径（已去 leading `/`、目录去 trailing `/`） */
  const relativeNamesForPrefixCheck: string[] = [];
  let totalBytes = 0;

  for (const [entryName, bytes] of entries) {
    // macOS / archiver noise — skipped on import, not mapped to logical paths.
    const lowerName = entryName.toLowerCase();
    if (lowerName === "__macosx" || lowerName.startsWith("__macosx/") || lowerName === ".ds_store" || lowerName.endsWith("/.ds_store")) {
      continue;
    }
    if (entryName.endsWith("/")) {
      const dirKey = entryName.replace(/\/+$/, "");
      const nameError = assertZipEntryNameAllowed(dirKey);
      if (nameError != null) return Result.err(nameError);
      if (bytes.byteLength > 0) {
        return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", `ZIP directory entry "${entryName}" must be empty (${bytes.byteLength} bytes)`));
      }
      if (dirKey.length > 0) {
        relativeNamesForPrefixCheck.push(dirKey);
      }
      directoryEntries.push(entryName);
      continue;
    }
    if (entryName.length === 0) {
      continue;
    }
    const nameError = assertZipEntryNameAllowed(entryName);
    if (nameError != null) return Result.err(nameError);
    relativeNamesForPrefixCheck.push(entryName);
    totalBytes += bytes.byteLength;
    fileEntries.push({ entryName, bytes });
  }

  // WHY: 带目标目录名错误嵌套必须在任何写库前硬失败，且不剥前缀。
  const prefixCheck = assertZipEntriesNotDomainRootPrefixed(targetDir, relativeNamesForPrefixCheck);
  if (!prefixCheck.ok) return Result.err(prefixCheck.error);

  const directoryLogicals: string[] = [];
  for (const entryName of directoryEntries) {
    const logical = logicalFromZipDirectoryEntryRelativeToDirectory(entryName, targetDir);
    if (!logical.ok) return Result.err(logical.error);
    const scopeError = assertLogicalAllowed(scope, logical.value, entryName);
    if (scopeError != null) return Result.err(scopeError);
    if (!directoryLogicals.includes(logical.value)) {
      directoryLogicals.push(logical.value);
    }
  }

  const entryCount = fileEntries.length + directoryLogicals.length;
  if (entryCount > VFS_ZIP_MAX_ENTRY_COUNT) {
    return Result.err(new AppError("VFS_ZIP_PAYLOAD_TOO_LARGE", `ZIP exceeds ${VFS_ZIP_MAX_ENTRY_COUNT} entries`));
  }
  if (totalBytes > VFS_ZIP_MAX_UNCOMPRESSED_BYTES) {
    return Result.err(new AppError("VFS_ZIP_PAYLOAD_TOO_LARGE", `ZIP uncompressed payload exceeds ${VFS_ZIP_MAX_UNCOMPRESSED_BYTES} bytes`));
  }

  const files = new Map<string, string>();
  for (const { entryName, bytes } of fileEntries) {
    const logical = logicalFromZipEntryRelativeToDirectory(entryName, targetDir);
    if (!logical.ok) return Result.err(logical.error);
    if (files.has(logical.value) || directoryLogicals.includes(logical.value)) {
      return Result.err(new AppError("VFS_ZIP_DUPLICATE_PATH", `duplicate logical path: ${logical.value}`));
    }
    const scopeError = assertLogicalAllowed(scope, logical.value, entryName);
    if (scopeError != null) return Result.err(scopeError);
    const content = decodeUtf8Entry(bytes, entryName);
    if (!content.ok) return Result.err(content.error);
    files.set(logical.value, content.value);
  }

  directoryLogicals.sort((a, b) => a.length - b.length);

  return Result.ok({ files, directories: directoryLogicals });
}
