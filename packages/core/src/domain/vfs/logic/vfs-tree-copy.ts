/**
 * Deep-copies vfs_entry rows under a (scope, path-prefix) pair.
 *
 * entry_id 化后入参从物理 `fromPrefix/toPrefix` 重构成
 * `(fromScope, fromPathPrefix) → (toScope, toPathPrefix)`：源侧扫描用 fromScope.scopeKey，
 * 目标侧变更用 toScope.scopeKey。path 列直接存纯逻辑路径，无需物理前缀拼接。
 *
 * @module domain/vfs/vfs-tree-copy
 */

import type { VfsContentStore } from "../content-store/vfs-content-store.port.js";
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
  if (prefix === "/" || prefix === "") {
    return prefix;
  }
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

function withSlashSuffix(prefix: string): string {
  return prefix === "/" ? prefix : `${prefix}/`;
}

function relativeUnderPrefix(fullPath: string, prefix: string): string {
  const base = normalizePrefix(prefix);
  if (fullPath === base) {
    return "";
  }
  const slashSuffix = withSlashSuffix(base);
  if (!fullPath.startsWith(slashSuffix)) {
    throw new Error(`Path ${fullPath} is not under prefix ${prefix}`);
  }
  return fullPath.slice(slashSuffix.length);
}

function joinLogical(prefix: string, relative: string): string {
  const base = normalizePrefix(prefix);
  if (relative.length === 0) {
    return base;
  }
  return `${base}/${relative}`;
}

/**
 * 用 scanContents 解出 scope+prefix 下所有文件的明文，返回 path→content 映射。
 *
 * @remarks 仅在回退路径（blob 缺失或无 hash）调用；快路径不触发。
 */
async function resolvePlainContentMap(
  repo: VfsEntryRepository,
  scopeKey: string,
  pathPrefix: string,
): Promise<Map<string, string>> {
  const rows = await repo.scanContents(scopeKey, pathPrefix);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.path, row.content);
  }
  return map;
}

export type CopyVfsTreeOptions = {
  mapPath?: (relative: string) => string;

  /** content store：共享 blob 写入前执行 ensureBlob / findExistingBlobHashes。 */
  readonly contentStore: VfsContentStore;
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
  // --- 目录：批量检查存在 + 批量 INSERT ---
  const dirPaths = await repo.listDirectoryPathsUnderPrefix(
    fromScope.scopeKey,
    fromPathPrefix,
  );
  const targetDirPaths: string[] = [];
  for (const dirPath of dirPaths) {
    const relative = relativeUnderPrefix(dirPath, fromPathPrefix);
    if (relative.length === 0) {
      continue;
    }
    const mapped = options?.mapPath ? options.mapPath(relative) : relative;
    targetDirPaths.push(joinLogical(toPathPrefix, mapped));
  }
  if (targetDirPaths.length > 0) {
    const existingDirs = await repo.findExistingPaths(
      toScope.scopeKey,
      targetDirPaths,
    );
    const newDirs = targetDirPaths.filter((p) => !existingDirs.has(p));
    if (newDirs.length > 0) {
      await repo.batchInsertDirectoryEntries(toScope.scopeKey, newDirs);
    }
  }

  // --- 文件：scanFileEntriesWithMeta 一次 SELECT 拿全部元数据（不解明文）---
  const fileEntries = await repo.scanFileEntriesWithMeta(
    fromScope.scopeKey,
    fromPathPrefix,
  );
  const mappedFiles: Array<{
    sourcePath: string;
    targetPath: string;
    contentHash: string | null;
    mtimeMs: number;
  }> = [];
  for (const entry of fileEntries) {
    const relative = relativeUnderPrefix(entry.path, fromPathPrefix);
    if (relative.length === 0) {
      continue;
    }
    const mapped = options?.mapPath ? options.mapPath(relative) : relative;
    mappedFiles.push({
      sourcePath: entry.path,
      targetPath: joinLogical(toPathPrefix, mapped),
      contentHash: entry.contentHash,
      mtimeMs: entry.mtimeMs,
    });
  }

  const blobFiles = mappedFiles.filter((f) => f.contentHash != null);
  const plainFiles = mappedFiles.filter((f) => f.contentHash == null);

  // --- blob 共享文件：批量路径（同库复制时全部 blob 已存在）---
  if (blobFiles.length > 0) {
    const hashes = [...new Set(blobFiles.map((f) => f.contentHash!))];
    let allBlobsExist = true;
    if (options != null) {
      const existingBlobs =
        await options.contentStore.findExistingBlobHashes(hashes);
      allBlobsExist = hashes.every((h) => existingBlobs.has(h));
    }

    if (allBlobsExist) {
      // 快路径：批量检查目标存在 + 批量 INSERT
      const targetPaths = blobFiles.map((f) => f.targetPath);
      const existingTargets = await repo.findExistingPaths(
        toScope.scopeKey,
        targetPaths,
      );
      const newEntries = blobFiles
        .filter((f) => !existingTargets.has(f.targetPath))
        .map((f) => ({
          path: f.targetPath,
          contentHash: f.contentHash!,
          mtimeMs: f.mtimeMs,
        }));
      if (newEntries.length > 0) {
        await repo.batchInsertFileEntriesWithHash(toScope.scopeKey, newEntries);
      }
      // 已存在的目标用逐条 update（tree-copy 到清空 scope 时不会走到）
      for (const f of blobFiles.filter((f) => existingTargets.has(f.targetPath))) {
        await repo.updateWithContentHash(
          toScope.scopeKey,
          f.targetPath,
          f.contentHash!,
          { versionCheck: false },
        );
      }
    } else {
      // 慢路径：部分 blob 缺失，回退逐条处理
      const plainMap = await resolvePlainContentMap(
        repo,
        fromScope.scopeKey,
        fromPathPrefix,
      );
      for (const f of blobFiles) {
        if (options != null) {
          await options.contentStore.ensureBlob(
            f.contentHash!,
            plainMap.get(f.sourcePath) ?? null,
          );
        }
        const existing = await repo.findByPath(toScope.scopeKey, f.targetPath);
        if (existing == null) {
          await repo.insertWithContentHash(
            toScope.scopeKey,
            f.targetPath,
            f.contentHash!,
          );
        } else {
          await repo.updateWithContentHash(
            toScope.scopeKey,
            f.targetPath,
            f.contentHash!,
            { versionCheck: false },
          );
        }
      }
    }
  }

  // --- 无 hash 文件：回退 scanContents 取明文逐条写入 ---
  if (plainFiles.length > 0) {
    const plainMap = await resolvePlainContentMap(
      repo,
      fromScope.scopeKey,
      fromPathPrefix,
    );
    for (const f of plainFiles) {
      const content = plainMap.get(f.sourcePath);
      if (content == null) {
        continue;
      }
      const existing = await repo.findByPath(toScope.scopeKey, f.targetPath);
      if (existing == null) {
        await repo.insert(toScope.scopeKey, f.targetPath, content);
      } else {
        await repo.update(toScope.scopeKey, f.targetPath, content, {
          versionCheck: false,
        });
      }
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
 * 泛化 sweep：释放 scope+前缀下 live head 引用 → 删 entry → GC 无引用 revision。
 *
 * 三 scope（project/session/template）通用。
 */
export async function sweepRevisionsUnderScope(
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
 * 释放 scope+前缀下 live head 引用 → 删 entry → GC 无引用 revision。
 *
 * @deprecated 使用 {@link sweepRevisionsUnderScope} 替代，语义相同。
 */
export async function releaseAndDeleteVfsPrefix(
  repo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  pathPrefix: string,
): Promise<void> {
  await sweepRevisionsUnderScope(repo, revisionRepo, scopeKey, pathPrefix);
}

/**
 * Deletes all vfs entries under a scope + logical path prefix.
 *
 * @remarks 走 {@link VfsEntryRepository.deleteRecursiveIfAny}：先用 listEntriesUnderPrefix
 * 探测，空 prefix 静默返回（不抛 vfsNotFound），非空则一条批量 DELETE...LIKE 清掉整棵子树。
 */
export async function deleteVfsPrefix(
  repo: VfsEntryRepository,
  scopeKey: string,
  prefix: string,
): Promise<void> {
  const base = normalizePrefix(prefix);
  await repo.deleteRecursiveIfAny(scopeKey, base);
}
