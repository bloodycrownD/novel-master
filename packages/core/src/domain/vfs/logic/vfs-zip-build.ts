/**
 * Builds a ZIP archive from logical-path file map (entry names without leading `/`).
 *
 * @module domain/vfs/logic/vfs-zip-build
 */

import { strToU8, zipSync } from "fflate";

/**
 * @param files - Map of ZIP entry name → UTF-8 text content
 */
export function buildVfsZip(files: ReadonlyMap<string, string>): Uint8Array {
  const payload: Record<string, Uint8Array> = {};
  for (const [entryName, content] of files) {
    payload[entryName] = strToU8(content);
  }
  return zipSync(payload);
}
