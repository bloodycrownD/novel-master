/**
 * 将 ZIP 字节解析为条目名 → 原始字节映射（含 `dir/` 目录标记）。
 *
 * @module domain/vfs/logic/vfs-zip-parse
 */

import { unzipSync } from "fflate";
import { vfsZipError, VfsZipError } from "@/errors/vfs-zip-errors.js";
import { parseZipCentralDirectory } from "./vfs-zip-central-dir.js";
import {
  DEFAULT_VFS_ZIP_LIMITS,
  type VfsZipLimits,
} from "./vfs-zip-limits.js";

function parseVfsZipViaCentralDirectory(
  zipBytes: Uint8Array,
  limits: VfsZipLimits
): Map<string, Uint8Array> {
  const parsed = parseZipCentralDirectory(zipBytes, limits);
  const entries = new Map<string, Uint8Array>();
  for (const entry of parsed) {
    entries.set(entry.entryName, entry.data);
  }
  return entries;
}

/**
 * 事后判限：key 数 + 总体积。
 *
 * 这条路径**无法增量闸**（`unzipSync` 一次解完整包），所以只能在事后判；
 * 至少不让超限结果**进入**上层（进而落库）。
 *
 * ⚠️ 判限的抛点必须在 `try` 块**之外**：它外层那个 `catch` 会把所有异常
 * 改写成 `INVALID_ZIP` ⇒ 写进 try 里的话，闸门在最需要它的回退路径上完全失效。
 */
function assertFallbackWithinLimits(
  raw: Record<string, Uint8Array>,
  limits: VfsZipLimits
): void {
  const names = Object.keys(raw);
  if (names.length > limits.maxEntryCount) {
    throw vfsZipError(
      "PAYLOAD_TOO_LARGE",
      `ZIP entry count ${names.length} exceeds limit ${limits.maxEntryCount}`
    );
  }
  let totalBytes = 0;
  for (const name of names) {
    totalBytes += raw[name]!.length;
    if (totalBytes > limits.maxUncompressedBytes) {
      throw vfsZipError(
        "PAYLOAD_TOO_LARGE",
        `ZIP uncompressed size ${totalBytes} exceeds limit ${limits.maxUncompressedBytes}`
      );
    }
  }
}

/** 中央目录解析失败时回退 fflate，兼容原生 zip 等边缘格式。 */
function parseVfsZipViaUnzipSync(
  zipBytes: Uint8Array,
  limits: VfsZipLimits
): Map<string, Uint8Array> {
  // `unzipSync` 与 Map 构造在 try 内；判限与抛在 try 外。
  let raw: Record<string, Uint8Array>;
  let entries: Map<string, Uint8Array>;
  try {
    raw = unzipSync(zipBytes);
    entries = new Map<string, Uint8Array>();
    for (const [name, content] of Object.entries(raw)) {
      entries.set(name, content);
    }
  } catch {
    throw vfsZipError("INVALID_ZIP", "failed to read ZIP archive");
  }
  assertFallbackWithinLimits(raw, limits);
  return entries;
}

/**
 * @throws {VfsZipError} `PAYLOAD_TOO_LARGE` 条数或解压后总体积越限
 * @throws {VfsZipError} `INVALID_ZIP` 当归档无法读取
 */
export function parseVfsZip(
  zipBytes: Uint8Array,
  limits: VfsZipLimits = DEFAULT_VFS_ZIP_LIMITS
): Map<string, Uint8Array> {
  try {
    return parseVfsZipViaCentralDirectory(zipBytes, limits);
  } catch (centralDirError) {
    // 闸门命中**绝不回退**：中央目录分支抛的 PAYLOAD_TOO_LARGE 若被当成
    // 「中央目录解析失败」而回退 fflate，闸门就被完全绕过，且 `unzipSync`
    // 仍会把整包解出来 ⇒ OOM 照旧。
    if (
      centralDirError instanceof VfsZipError &&
      centralDirError.code === "PAYLOAD_TOO_LARGE"
    ) {
      throw centralDirError;
    }
    try {
      return parseVfsZipViaUnzipSync(zipBytes, limits);
    } catch (fallbackError) {
      if (fallbackError instanceof VfsZipError) {
        throw fallbackError;
      }
      if (centralDirError instanceof VfsZipError) {
        throw centralDirError;
      }
      throw vfsZipError("INVALID_ZIP", "failed to read ZIP archive");
    }
  }
}
