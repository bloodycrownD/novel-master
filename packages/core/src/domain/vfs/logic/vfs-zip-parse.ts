/**
 * 将 ZIP 字节解析为条目名 → 原始字节映射（含 `dir/` 目录标记）。
 *
 * @module domain/vfs/logic/vfs-zip-parse
 */

import { vfsZipError, VfsZipError } from "@/errors/vfs-zip-errors.js";
import { parseZipCentralDirectory } from "./vfs-zip-central-dir.js";

/**
 * @throws {VfsZipError} `INVALID_ZIP` 当归档无法读取
 */
export function parseVfsZip(zipBytes: Uint8Array): Map<string, Uint8Array> {
  try {
    const parsed = parseZipCentralDirectory(zipBytes);
    const entries = new Map<string, Uint8Array>();
    for (const entry of parsed) {
      entries.set(entry.entryName, entry.data);
    }
    return entries;
  } catch (error) {
    if (error instanceof VfsZipError) {
      throw error;
    }
    throw vfsZipError("INVALID_ZIP", "failed to read ZIP archive");
  }
}
