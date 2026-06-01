/**
 * Pure validation for VFS ZIP import payloads.
 *
 * @module domain/vfs/logic/vfs-zip-validate
 */

import { vfsZipError } from "@/errors/vfs-zip-errors.js";
import type { VfsScope } from "./vfs-path-mapper.js";
import { assertLogicalPathAllowed } from "./vfs-path-mapper.js";
import {
  logicalFromZipDirectoryEntryName,
  logicalFromZipEntryName,
} from "./vfs-zip-path.js";

export const VFS_ZIP_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const VFS_ZIP_MAX_ENTRY_COUNT = 5_000;
export const VFS_ZIP_MAX_ENTRY_PATH_LEN = 512;

/** Validated ZIP payload ready for DB import. */
export interface VfsZipValidatedPayload {
  readonly files: ReadonlyMap<string, string>;
  /** Logical directory paths (e.g. `/empty-dir`), shallow paths first. */
  readonly directories: readonly string[];
}

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

/** macOS / archiver noise — skipped on import, not mapped to logical paths. */
function isZipJunkEntry(entryName: string): boolean {
  const lower = entryName.toLowerCase();
  if (lower === "__macosx" || lower.startsWith("__macosx/")) {
    return true;
  }
  if (lower === ".ds_store" || lower.endsWith("/.ds_store")) {
    return true;
  }
  return false;
}

function assertZipEntryNameAllowed(entryName: string): void {
  if (entryName.length === 0) {
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

function stripUtf8Bom(bytes: Uint8Array): Uint8Array {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return bytes.subarray(3);
  }
  return bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Decodes bytes as UTF-8 text; rejects invalid sequences.
 * Uses round-trip encoding (not `fatal: true`) so Hermes matches Node behavior.
 */
export function decodeUtf8Entry(bytes: Uint8Array, entryName: string): string {
  const payload = stripUtf8Bom(bytes);
  const decoded = new TextDecoder("utf-8").decode(payload);
  const roundTrip = new TextEncoder().encode(decoded);
  if (!bytesEqual(payload, roundTrip)) {
    throw vfsZipError(
      "INVALID_UTF8",
      `ZIP entry "${entryName}" is not valid UTF-8 text (${bytes.byteLength} bytes)`,
    );
  }
  return decoded;
}

function assertLogicalAllowed(
  scope: VfsScope,
  logical: string,
  entryName: string,
): void {
  try {
    assertLogicalPathAllowed(scope, logical);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "path not allowed for scope";
    throw vfsZipError(
      "INVALID_PATH",
      `ZIP entry "${entryName}" → logical "${logical}": ${message}`,
    );
  }
}

/**
 * Validates raw ZIP entries and returns files + explicit empty directories.
 * Does not touch the database.
 */
export function validateVfsZipEntries(
  scope: VfsScope,
  entries: ReadonlyMap<string, Uint8Array>,
): VfsZipValidatedPayload {
  const fileEntries: Array<{ entryName: string; bytes: Uint8Array }> = [];
  const directoryLogicals: string[] = [];
  let totalBytes = 0;

  for (const [entryName, bytes] of entries) {
    if (isZipJunkEntry(entryName)) {
      continue;
    }
    if (entryName.endsWith("/")) {
      const dirKey = entryName.replace(/\/+$/, "");
      assertZipEntryNameAllowed(dirKey);
      if (bytes.byteLength > 0) {
        throw vfsZipError(
          "INVALID_ZIP",
          `ZIP directory entry "${entryName}" must be empty (${bytes.byteLength} bytes)`,
        );
      }
      const logical = logicalFromZipDirectoryEntryName(entryName);
      assertLogicalAllowed(scope, logical, entryName);
      if (!directoryLogicals.includes(logical)) {
        directoryLogicals.push(logical);
      }
      continue;
    }
    if (entryName.length === 0) {
      continue;
    }
    assertZipEntryNameAllowed(entryName);
    totalBytes += bytes.byteLength;
    fileEntries.push({ entryName, bytes });
  }

  const entryCount = fileEntries.length + directoryLogicals.length;
  if (entryCount > VFS_ZIP_MAX_ENTRY_COUNT) {
    throw vfsZipError(
      "PAYLOAD_TOO_LARGE",
      `ZIP exceeds ${VFS_ZIP_MAX_ENTRY_COUNT} entries`,
    );
  }
  if (totalBytes > VFS_ZIP_MAX_UNCOMPRESSED_BYTES) {
    throw vfsZipError(
      "PAYLOAD_TOO_LARGE",
      `ZIP uncompressed payload exceeds ${VFS_ZIP_MAX_UNCOMPRESSED_BYTES} bytes`,
    );
  }

  const files = new Map<string, string>();
  for (const { entryName, bytes } of fileEntries) {
    const logical = logicalFromZipEntryName(entryName);
    if (files.has(logical) || directoryLogicals.includes(logical)) {
      throw vfsZipError("DUPLICATE_PATH", `duplicate logical path: ${logical}`);
    }
    assertLogicalAllowed(scope, logical, entryName);
    const content = decodeUtf8Entry(bytes, entryName);
    files.set(logical, content);
  }

  directoryLogicals.sort((a, b) => a.length - b.length);

  return { files, directories: directoryLogicals };
}
