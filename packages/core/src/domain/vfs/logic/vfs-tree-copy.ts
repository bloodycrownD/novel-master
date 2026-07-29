/**
 * Deep-copies vfs_entry rows under a (scope, path-prefix) pair.
 *
 * entry_id 化后入参从物理 `fromPrefix/toPrefix` 重构成
 * `(fromScope, fromPathPrefix) → (toScope, toPathPrefix)`：源侧扫描用 fromScope.scopeKey，
 * 目标侧变更用 toScope.scopeKey。path 列直接存纯逻辑路径，无需物理前缀拼接。
 *
 * @module domain/vfs/vfs-tree-copy
 */

import type { VfsEntryRepository } from "../repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "../repositories/vfs-revision.port.js";
import {
  decrementLiveRefsUnderScope,
  deleteUnreferencedUnderScope,
} from "./revision-ref-count.js";
import { seedLiveHeadRevisionsUnderPrefix } from "./seed-live-head-revisions.js";

/** 轻量 scope 引用（只需 scopeKey 字符串）。 */
export interface VfsCopyScope {
  readonly scopeKey: string;
}

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

function joinLogical(prefix: string, relative: string): string {
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
 * Copies all vfs entries under `(fromScope, fromPathPrefix)` to `(toScope, toPathPrefix)`。
 *
 * 文件行优先复制 `content_hash`（共享 blob）；无 hash 时再 put 同源明文一次。
 */
export async function copyVfsTree(
  repo: VfsEntryRepository,
  fromScope: VfsCopyScope,
  fromPathPrefix: string,
  toScope: VfsCopyScope,
  toPathPrefix: string,
  options?: CopyVfsTreeOptions,
): Promise<void> {
  const dirPaths = await repo.listDirectoryPathsUnderPrefix(
    fromScope.scopeKey,
    fromPathPrefix,
  );
  for (const dirPath of dirPaths) {
    const relative = relativeUnderPrefix(dirPath, fromPathPrefix);
    if (relative.length === 0) {
      continue;
    }
    const mapped = options?.mapPath ? options.mapPath(relative) : relative;
    const targetPath = joinLogical(toPathPrefix, mapped);
    const existing = await repo.findByPath(toScope.scopeKey, targetPath);
    if (existing == null) {
      await repo.insertDirectory(toScope.scopeKey, targetPath);
    }
  }

  const rows = await repo.scanContents(fromScope.scopeKey, fromPathPrefix);
  for (const row of rows) {
    const relative = relativeUnderPrefix(row.path, fromPathPrefix);
    if (relative.length === 0) {
      continue;
    }
    const mapped = options?.mapPath ? options.mapPath(relative) : relative;
    const targetPath = joinLogical(toPathPrefix, mapped);
    const existing = await repo.findByPath(toScope.scopeKey, targetPath);
    const contentHash = await repo.findContentHash(fromScope.scopeKey, row.path);
    if (contentHash != null) {
      // NOTE: Step 6 会在此处补 ensureBlob(contentHash) 承诺式调用，本节点保留位置。
      if (existing == null) {
        await repo.insertWithContentHash(toScope.scopeKey, targetPath, contentHash);
      } else {
        await repo.updateWithContentHash(
          toScope.scopeKey,
          targetPath,
          contentHash,
          { versionCheck: false },
        );
      }
      continue;
    }
    if (existing == null) {
      await repo.insert(toScope.scopeKey, targetPath, row.content);
    } else {
      await repo.update(toScope.scopeKey, targetPath, row.content, {
        versionCheck: false,
      });
    }
  }
}

/**
 * Replaces the target VFS subtree: delete `(toScope, toPathPrefix)` then copy from source。
 */
export async function replaceVfsSubtree(
  repo: VfsEntryRepository,
  fromScope: VfsCopyScope,
  fromPathPrefix: string,
  toScope: VfsCopyScope,
  toPathPrefix: string,
  options?: ReplaceVfsSubtreeOptions,
): Promise<void> {
  if (options?.revisions != null) {
    await releaseAndDeleteVfsPrefix(repo, options.revisions, toScope.scopeKey, toPathPrefix);
  } else {
    await deleteVfsPrefix(repo, toScope.scopeKey, toPathPrefix);
  }
  await copyVfsTree(repo, fromScope, fromPathPrefix, toScope, toPathPrefix, options);
  if (options?.revisions != null) {
    await seedLiveHeadRevisionsUnderPrefix(
      repo,
      options.revisions,
      toScope.scopeKey,
      toPathPrefix,
    );
  }
}

/**
 * 释放 scope+前缀下 live head 引用 → 删 entry → GC 无引用 revision。
 */
export async function releaseAndDeleteVfsPrefix(
  repo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  pathPrefix: string,
): Promise<void> {
  await decrementLiveRefsUnderScope(revisionRepo, repo, scopeKey, pathPrefix);
  await deleteVfsPrefix(repo, scopeKey, pathPrefix);
  await deleteUnreferencedUnderScope(revisionRepo, scopeKey, pathPrefix);
}

/**
 * Deletes all vfs entries under a scope + logical path prefix.
 */
export async function deleteVfsPrefix(
  repo: VfsEntryRepository,
  scopeKey: string,
  prefix: string,
): Promise<void> {
  const base = normalizePrefix(prefix);
  const entries = await repo.listEntriesUnderPrefix(scopeKey, base);
  const sorted = [...entries].sort((a, b) => b.path.length - a.path.length);
  for (const entry of sorted) {
    await repo.delete(scopeKey, entry.path, { recursive: false });
  }
}
