/**
 * Maps ZIP entry names to VFS logical paths and back.
 *
 * @module domain/vfs/logic/vfs-zip-path
 */

import { vfsZipError } from "@/errors/vfs-zip-errors.js";
import { normalizePath } from "../repositories/impl/normalize-path.js";

/**
 * ZIP entry name from a domain logical path (strips leading `/`).
 */
export function zipEntryNameFromLogical(logical: string): string {
  const normalized = normalizePath(logical);
  if (normalized === "/") {
    throw vfsZipError("INVALID_PATH", "cannot export root as a ZIP entry");
  }
  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

/**
 * Restores a logical path from a ZIP entry name.
 */
export function logicalFromZipEntryName(entryName: string): string {
  const trimmed = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (trimmed.length === 0) {
    throw vfsZipError("INVALID_PATH", "empty ZIP entry name");
  }
  return normalizePath(`/${trimmed}`);
}
