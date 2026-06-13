/**
 * 将 ZIP 字节解析为条目名 → 原始字节映射（含 `dir/` 目录标记）。
 *
 * @module domain/vfs/logic/vfs-zip-parse
 */

import { unzipSync } from "fflate";
import { vfsZipError, VfsZipError } from "@/errors/vfs-zip-errors.js";
import { parseZipCentralDirectory } from "./vfs-zip-central-dir.js";

function parseVfsZipViaCentralDirectory(
  zipBytes: Uint8Array,
): Map<string, Uint8Array> {
  const parsed = parseZipCentralDirectory(zipBytes);
  const entries = new Map<string, Uint8Array>();
  for (const entry of parsed) {
    entries.set(entry.entryName, entry.data);
  }
  return entries;
}

/** 中央目录解析失败时回退 fflate，兼容原生 zip 等边缘格式。 */
function parseVfsZipViaUnzipSync(zipBytes: Uint8Array): Map<string, Uint8Array> {
  try {
    const raw = unzipSync(zipBytes);
    const entries = new Map<string, Uint8Array>();
    for (const [name, content] of Object.entries(raw)) {
      entries.set(name, content);
    }
    return entries;
  } catch {
    throw vfsZipError("INVALID_ZIP", "failed to read ZIP archive");
  }
}

/**
 * @throws {VfsZipError} `INVALID_ZIP` 当归档无法读取
 */
export function parseVfsZip(zipBytes: Uint8Array): Map<string, Uint8Array> {
  try {
    return parseVfsZipViaCentralDirectory(zipBytes);
  } catch (centralDirError) {
    try {
      return parseVfsZipViaUnzipSync(zipBytes);
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
