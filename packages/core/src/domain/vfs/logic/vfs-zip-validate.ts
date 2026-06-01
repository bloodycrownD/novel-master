/**
 * Pure validation for VFS ZIP import payloads.
 *
 * @module domain/vfs/logic/vfs-zip-validate
 */

import { vfsZipError } from "@/errors/vfs-zip-errors.js";
import type { VfsScope } from "./vfs-path-mapper.js";
import { assertLogicalPathAllowed } from "./vfs-path-mapper.js";
import { logicalFromZipEntryName } from "./vfs-zip-path.js";

export const VFS_ZIP_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const VFS_ZIP_MAX_ENTRY_COUNT = 5_000;
export const VFS_ZIP_MAX_ENTRY_PATH_LEN = 512;

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

function assertZipEntryNameAllowed(entryName: string): void {
  if (entryName.length === 0 || entryName.endsWith("/")) {
    return;
  }
  if (entryName.length > VFS_ZIP_MAX_ENTRY_PATH_LEN) {
    throw vfsZipError(
      "PAYLOAD_TOO_LARGE",
      `ZIP entry path exceeds ${VFS_ZIP_MAX_ENTRY_PATH_LEN} characters: ${entryName}`,
    );
  }
  if (entryName.includes("\\")) {
    throw vfsZipError("INVALID_PATH", `backslash in ZIP entry: ${entryName}`);
  }
  if (entryName.includes("..")) {
    throw vfsZipError("INVALID_PATH", `parent segment in ZIP entry: ${entryName}`);
  }
  if (WINDOWS_DRIVE_PATH.test(entryName)) {
    throw vfsZipError("INVALID_PATH", `absolute Windows path in ZIP: ${entryName}`);
  }
  const lower = entryName.toLowerCase();
  if (lower.startsWith("projects/") || lower.startsWith("/projects/")) {
    throw vfsZipError(
      "INVALID_PATH",
      `cross-domain path prefix in ZIP entry: ${entryName}`,
    );
  }
}

/** Decodes bytes as UTF-8 text; rejects invalid sequences. */
export function decodeUtf8Entry(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw vfsZipError("INVALID_UTF8", "ZIP entry is not valid UTF-8 text");
  }
}

/**
 * Validates raw ZIP entries and returns logical path → content for import.
 * Does not touch the database.
 */
export function validateVfsZipEntries(
  scope: VfsScope,
  entries: ReadonlyMap<string, Uint8Array>,
): Map<string, string> {
  const fileEntries: Array<{ entryName: string; bytes: Uint8Array }> = [];
  let totalBytes = 0;

  for (const [entryName, bytes] of entries) {
    if (entryName.endsWith("/") || entryName.length === 0) {
      continue;
    }
    assertZipEntryNameAllowed(entryName);
    totalBytes += bytes.byteLength;
    fileEntries.push({ entryName, bytes });
  }

  if (fileEntries.length > VFS_ZIP_MAX_ENTRY_COUNT) {
    throw vfsZipError(
      "PAYLOAD_TOO_LARGE",
      `ZIP exceeds ${VFS_ZIP_MAX_ENTRY_COUNT} file entries`,
    );
  }
  if (totalBytes > VFS_ZIP_MAX_UNCOMPRESSED_BYTES) {
    throw vfsZipError(
      "PAYLOAD_TOO_LARGE",
      `ZIP uncompressed payload exceeds ${VFS_ZIP_MAX_UNCOMPRESSED_BYTES} bytes`,
    );
  }

  const result = new Map<string, string>();
  for (const { entryName, bytes } of fileEntries) {
    const logical = logicalFromZipEntryName(entryName);
    if (result.has(logical)) {
      throw vfsZipError("DUPLICATE_PATH", `duplicate logical path: ${logical}`);
    }
    try {
      assertLogicalPathAllowed(scope, logical);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "path not allowed for scope";
      throw vfsZipError("INVALID_PATH", message);
    }
    const content = decodeUtf8Entry(bytes);
    result.set(logical, content);
  }

  return result;
}
