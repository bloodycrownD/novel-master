/**
 * 将 ZIP 字节解析为条目名 → 原始字节映射（含 `dir/` 目录标记）。
 *
 * @module domain/vfs/logic/vfs-zip-parse
 */

import { unzipSync } from "fflate";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { parseZipCentralDirectory } from "./vfs-zip-central-dir.js";
import { DEFAULT_VFS_ZIP_LIMITS, type VfsZipLimits } from "./vfs-zip-limits.js";

/** parseVfsZip 的失败载荷。 */
type VfsZipParseError = AppError<"VFS_ZIP_INVALID_ARCHIVE" | "VFS_ZIP_INVALID_UTF8" | "VFS_ZIP_PAYLOAD_TOO_LARGE">;

export function parseVfsZip(zipBytes: Uint8Array, limits: VfsZipLimits = DEFAULT_VFS_ZIP_LIMITS): Result<Map<string, Uint8Array>, VfsZipParseError> {
  const central = parseZipCentralDirectory(zipBytes, limits);
  if (central.ok) {
    return Result.ok(new Map(central.value.map((entry) => [entry.entryName, entry.data])));
  }
  // 闸门命中**绝不回退**：中央目录分支返回的 PAYLOAD_TOO_LARGE 若被当成
  // 「中央目录解析失败」而回退 fflate，闸门就被完全绕过，且 `unzipSync`
  // 仍会把整包解出来 ⇒ OOM 照旧。
  if (central.error.key === "VFS_ZIP_PAYLOAD_TOO_LARGE") return Result.err(central.error);

  // 中央目录解析失败时回退 fflate，兼容原生 zip 等边缘格式。
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zipBytes);
  } catch {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", "failed to read ZIP archive"));
  }

  // 事后判限：key 数 + 总体积。这条路径**无法增量闸**（`unzipSync` 一次解完整包），
  // 所以只能在事后判；至少不让超限结果**进入**上层（进而落库）。
  const names = Object.keys(raw);
  if (names.length > limits.maxEntryCount) {
    return Result.err(new AppError("VFS_ZIP_PAYLOAD_TOO_LARGE", `ZIP entry count ${names.length} exceeds limit ${limits.maxEntryCount}`));
  }
  let totalBytes = 0;
  for (const name of names) {
    totalBytes += raw[name]!.length;
    if (totalBytes > limits.maxUncompressedBytes) {
      return Result.err(new AppError("VFS_ZIP_PAYLOAD_TOO_LARGE", `ZIP uncompressed size ${totalBytes} exceeds limit ${limits.maxUncompressedBytes}`));
    }
  }
  return Result.ok(new Map(Object.entries(raw)));
}
