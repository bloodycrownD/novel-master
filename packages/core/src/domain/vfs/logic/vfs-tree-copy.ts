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
import {
  isVfsPathAncestorOfExcluded,
  isVfsPathExcluded,
} from "./vfs-exclude-prefixes.js";

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

  /**
   * 隔离豁免：拷贝源时跳过这些逻辑路径前缀（如 `meta/skills`），
   * 默认空数组 = 现行为完全不变。前缀可带或不带前导 `/`。
   */
  readonly excludePrefixes?: string[];
};

export type ReplaceVfsSubtreeOptions = CopyVfsTreeOptions & {
  /**
   * 传入时：删除前释放 live ref + GC，拷贝后为 live head 补种 revision。
   * fork/copy 仍走 seedForkCopyParity，不要传此字段以免双重播种。
   */
  revisions?: VfsRevisionRepository;
};

/** 供三侧（拷贝/删除/seed）统一取排除前缀，缺省为空数组。 */
function resolveExcludePrefixes(
  excludePrefixes: readonly string[] | undefined,
): string[] {
  return excludePrefixes ?? [];
}

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
  const excludePrefixes = resolveExcludePrefixes(options?.excludePrefixes);
  // --- 目录：批量检查存在 + 批量 INSERT ---
  const dirPaths = await repo.listDirectoryPathsUnderPrefix(
    fromScope.scopeKey,
    fromPathPrefix,
  );
  const targetDirPaths: string[] = [];
  for (const dirPath of dirPaths) {
    if (isVfsPathExcluded(dirPath, excludePrefixes)) {
      continue;
    }
    // 排除前缀的祖先目录不镜像到目标，避免残留空目录链（如只排除 meta/skills
    // 时，源里单独为它存在的 /meta 不该出现在目标）。
    if (
      excludePrefixes.length > 0 &&
      isVfsPathAncestorOfExcluded(dirPath, excludePrefixes)
    ) {
      continue;
    }
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
    if (isVfsPathExcluded(entry.path, excludePrefixes)) {
      continue;
    }
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
  const excludePrefixes = resolveExcludePrefixes(options?.excludePrefixes);
  if (options?.revisions != null) {
    await sweepRevisionsUnderScope(
      repo,
      options.revisions,
      toScope.scopeKey,
      toPathPrefix,
      excludePrefixes,
    );
  } else {
    await deleteVfsPrefix(repo, toScope.scopeKey, toPathPrefix, excludePrefixes);
  }
  await copyVfsTree(repo, fromScope, fromPathPrefix, toScope, toPathPrefix, options);
  if (options?.revisions != null) {
    await seedLiveHeadRevisionsUnderPrefix(
      repo,
      options.revisions,
      toScope.scopeKey,
      toPathPrefix,
      undefined,
      excludePrefixes,
    );
  }
}

/**
 * 泛化 sweep：释放 scope+前缀下 live head 引用 → 删 entry → GC 无引用 revision。
 *
 * 三 scope（project/session/template）通用。`excludePrefixes` 非空时，
 * 排除前缀下的 entry 不删、live ref 不减、revision 不 GC（隔离豁免，
 * 如 project 域 `meta/skills/` 已有技能不随模板替换被清掉）。
 */
export async function sweepRevisionsUnderScope(
  repo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  pathPrefix: string,
  excludePrefixes?: readonly string[],
): Promise<void> {
  await decrementLiveRefsUnderScope(
    revisionRepo,
    repo,
    scopeKey,
    pathPrefix,
    excludePrefixes,
  );
  await deleteVfsPrefix(repo, scopeKey, pathPrefix, excludePrefixes);
  await deleteUnreferencedUnderScope(
    revisionRepo,
    scopeKey,
    pathPrefix,
    excludePrefixes,
  );
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
 * `excludePrefixes` 非空时跳过排除前缀下的条目（隔离豁免）。
 */
export async function deleteVfsPrefix(
  repo: VfsEntryRepository,
  scopeKey: string,
  prefix: string,
  excludePrefixes?: readonly string[],
): Promise<void> {
  const excludes = excludePrefixes ?? [];
  const base = normalizePrefix(prefix);
  const entries = await repo.listEntriesUnderPrefix(scopeKey, base);
  const sorted = [...entries].sort((a, b) => b.path.length - a.path.length);
  for (const entry of sorted) {
    if (isVfsPathExcluded(entry.path, excludes)) {
      continue;
    }
    // 祖先目录也保留：排除子树里的 entry 不删，承载它的目录层级不能删，
    // 否则会因「目录非空」失败。
    if (excludes.length > 0 && isVfsPathAncestorOfExcluded(entry.path, excludes)) {
      continue;
    }
    await repo.delete(scopeKey, entry.path, { recursive: false });
  }
}
