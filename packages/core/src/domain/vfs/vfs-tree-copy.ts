/**
 * Deep-copies vfs_entry rows under a path prefix.
 *
 * @module domain/vfs/vfs-tree-copy
 */

import type { VfsEntryRepository } from "./repositories/vfs-entry.port.js";

function normalizePrefix(prefix: string): string {
  if (prefix === "/") {
    return prefix;
  }
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

function relativeUnderPrefix(fullPath: string, prefix: string): string {
  const base = normalizePrefix(prefix);
  if (fullPath === base) {
    return "";
  }
  const withSlash = `${base}/`;
  if (!fullPath.startsWith(withSlash)) {
    throw new Error(`Path ${fullPath} is not under prefix ${prefix}`);
  }
  return fullPath.slice(withSlash.length);
}

function joinPhysical(prefix: string, relative: string): string {
  const base = normalizePrefix(prefix);
  if (relative.length === 0) {
    return base;
  }
  return `${base}/${relative}`;
}

/**
 * Copies all vfs entries under `fromPrefix` to `toPrefix`.
 *
 * @param repo - Vfs entry repository
 * @param fromPrefix - Source physical prefix
 * @param toPrefix - Target physical prefix
 * @param options.mapPath - Optional relative path transform (e.g. strip template segment)
 */
export async function copyVfsTree(
  repo: VfsEntryRepository,
  fromPrefix: string,
  toPrefix: string,
  options?: { mapPath?: (relative: string) => string },
): Promise<void> {
  const rows = await repo.scanContents(fromPrefix);
  for (const row of rows) {
    const relative = relativeUnderPrefix(row.path, fromPrefix);
    const mapped = options?.mapPath ? options.mapPath(relative) : relative;
    const targetPath = joinPhysical(toPrefix, mapped);
    const existing = await repo.findByPath(targetPath);
    if (existing == null) {
      await repo.insert(targetPath, row.content);
    } else {
      await repo.update(targetPath, row.content, { versionCheck: false });
    }
  }
}

/**
 * Deletes all vfs entries under a physical prefix.
 */
export async function deleteVfsPrefix(
  repo: VfsEntryRepository,
  prefix: string,
): Promise<void> {
  const base = normalizePrefix(prefix);
  try {
    await repo.delete(base, { recursive: true });
  } catch {
    // prefix may be a directory without its own row
  }
  const rows = await repo.scanContents(base);
  for (const row of rows) {
    if (row.path !== base) {
      await repo.delete(row.path, { recursive: false });
    }
  }
}
