/**
 * Deep-copies vfs_entry rows under a path prefix.
 *
 * @module domain/vfs/vfs-tree-copy
 */

import type { VfsEntryRepository } from "../repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "../repositories/vfs-revision.port.js";
import {
  decrementLiveRefsUnderPrefix,
  deleteUnreferencedUnderPrefix,
} from "./revision-ref-count.js";
import { seedLiveHeadRevisionsUnderPrefix } from "./seed-live-head-revisions.js";

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

export type CopyVfsTreeOptions = {
  mapPath?: (relative: string) => string;
};

export type ReplaceVfsSubtreeOptions = CopyVfsTreeOptions & {
  /**
   * 传入时：删除前释放 live ref + GC，拷贝后为 live head 补种 revision。
   * fork/copy 仍走 seedForkCopyParity，不要传此字段以免双重播种。
   */
  revisions?: VfsRevisionRepository;
};

/**
 * Copies all vfs entries under `fromPrefix` to `toPrefix`.
 *
 * 文件行优先复制 `content_hash`（共享 blob）；无 hash 时再 put 同源明文一次。
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
  options?: CopyVfsTreeOptions,
): Promise<void> {
  const dirPaths = await repo.listDirectoryPathsUnderPrefix(fromPrefix);
  for (const dirPath of dirPaths) {
    const relative = relativeUnderPrefix(dirPath, fromPrefix);
    if (relative.length === 0) {
      continue;
    }
    const mapped = options?.mapPath ? options.mapPath(relative) : relative;
    const targetPath = joinPhysical(toPrefix, mapped);
    const existing = await repo.findByPath(targetPath);
    if (existing == null) {
      await repo.insertDirectory(targetPath);
    }
  }

  const rows = await repo.scanContents(fromPrefix);
  for (const row of rows) {
    const relative = relativeUnderPrefix(row.path, fromPrefix);
    if (relative.length === 0) {
      continue;
    }
    const mapped = options?.mapPath ? options.mapPath(relative) : relative;
    const targetPath = joinPhysical(toPrefix, mapped);
    const existing = await repo.findByPath(targetPath);
    const contentHash = await repo.findContentHash(row.path);
    if (contentHash != null) {
      if (existing == null) {
        await repo.insertWithContentHash(targetPath, contentHash);
      } else {
        await repo.updateWithContentHash(targetPath, contentHash, {
          versionCheck: false,
        });
      }
      continue;
    }
    if (existing == null) {
      await repo.insert(targetPath, row.content);
    } else {
      await repo.update(targetPath, row.content, { versionCheck: false });
    }
  }
}

/**
 * Replaces the target VFS subtree: delete `toPrefix` then copy from `fromPrefix`.
 */
export async function replaceVfsSubtree(
  repo: VfsEntryRepository,
  fromPrefix: string,
  toPrefix: string,
  options?: ReplaceVfsSubtreeOptions,
): Promise<void> {
  if (options?.revisions != null) {
    await releaseAndDeleteVfsPrefix(repo, options.revisions, toPrefix);
  } else {
    await deleteVfsPrefix(repo, toPrefix);
  }
  await copyVfsTree(repo, fromPrefix, toPrefix, options);
  if (options?.revisions != null) {
    await seedLiveHeadRevisionsUnderPrefix(repo, options.revisions, toPrefix);
  }
}

/**
 * 释放前缀下 live head 引用 → 删 entry → GC 无引用 revision。
 */
export async function releaseAndDeleteVfsPrefix(
  repo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  physicalPrefix: string,
): Promise<void> {
  await decrementLiveRefsUnderPrefix(revisionRepo, repo, physicalPrefix);
  await deleteVfsPrefix(repo, physicalPrefix);
  await deleteUnreferencedUnderPrefix(revisionRepo, physicalPrefix);
}

/**
 * Deletes all vfs entries under a physical prefix.
 */
export async function deleteVfsPrefix(
  repo: VfsEntryRepository,
  prefix: string,
): Promise<void> {
  const base = normalizePrefix(prefix);
  const entries = await repo.listEntriesUnderPrefix(base);
  const sorted = [...entries].sort((a, b) => b.path.length - a.path.length);
  for (const entry of sorted) {
    await repo.delete(entry.path, { recursive: false });
  }
}
