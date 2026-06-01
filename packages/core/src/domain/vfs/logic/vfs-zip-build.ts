/**
 * Builds a ZIP archive from logical-path file map (entry names without leading `/`).
 *
 * @module domain/vfs/logic/vfs-zip-build
 */

import { strToU8, zipSync } from "fflate";

/**
 * @param files - Map of ZIP entry name → UTF-8 text content
 * @param directoryEntryNames - ZIP directory markers (`name/` → empty payload)
 */
export function buildVfsZip(
  files: ReadonlyMap<string, string>,
  directoryEntryNames: readonly string[] = [],
): Uint8Array {
  const payload: Record<string, Uint8Array> = {};
  for (const dirName of directoryEntryNames) {
    const entryName = dirName.endsWith("/") ? dirName : `${dirName}/`;
    payload[entryName] = new Uint8Array(0);
  }
  for (const [entryName, content] of files) {
    payload[entryName] = strToU8(content);
  }
  return zipSync(payload);
}
