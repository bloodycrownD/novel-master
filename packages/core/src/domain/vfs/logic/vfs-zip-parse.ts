/**
 * Parses ZIP bytes into entry name → raw bytes (skips directory-only entries).
 *
 * @module domain/vfs/logic/vfs-zip-parse
 */

import { unzipSync } from "fflate";
import { vfsZipError } from "@/errors/vfs-zip-errors.js";

/**
 * @throws {VfsZipError} `INVALID_ZIP` when the archive cannot be read
 */
export function parseVfsZip(zipBytes: Uint8Array): Map<string, Uint8Array> {
  try {
    const raw = unzipSync(zipBytes);
    const entries = new Map<string, Uint8Array>();
    for (const [name, content] of Object.entries(raw)) {
      if (name.endsWith("/")) {
        continue;
      }
      entries.set(name, content);
    }
    return entries;
  } catch {
    throw vfsZipError("INVALID_ZIP", "failed to read ZIP archive");
  }
}
