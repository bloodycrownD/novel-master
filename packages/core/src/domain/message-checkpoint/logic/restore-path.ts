/**
 * Restores a logical path to a specific revision (forward restore).
 *
 * @module domain/message-checkpoint/logic/restore-path
 */

import { mkdirIgnoreExistingDirectory } from "@/domain/vfs/logic/vfs-move.js";
import { parentDir } from "@/domain/vfs/logic/parent-dir.js";
import {
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { sessionFsRestoreRevisionMissing } from "@/errors/session-fs-errors.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { VfsRestorePort } from "@/domain/vfs/ports/vfs-restore.port.js";
import type { VfsRevisionPointerMeta } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";
import { backfillMissingRevisionIfNeeded } from "./backfill-missing-revision.js";

/** restore 单路径结果（供 reconcile 统计短路次数）。 */
export type RestorePathOutcome =
  | "skipped_same_version"
  | "skipped_same_content_hash"
  | "restored"
  | "deleted";

/** reconcile 批量预取的 revision meta 与 live hash（内存比对，减 N 次 SQL）。 */
export type RestorePathPrefetch = {
  readonly revisionMetaByKey?: ReadonlyMap<string, VfsRevisionPointerMeta>;
  readonly liveHashByPath?: ReadonlyMap<string, string | null>;
};

async function resolveRevisionMeta(
  revisionRepo: VfsRevisionRepository,
  physical: string,
  version: number,
  prefetch?: RestorePathPrefetch,
): Promise<VfsRevisionPointerMeta | null> {
  const key = revisionPairKey(physical, version);
  if (prefetch?.revisionMetaByKey != null) {
    return prefetch.revisionMetaByKey.get(key) ?? null;
  }
  return revisionRepo.findMetaByPathAndVersion(physical, version);
}

async function resolveLiveHash(
  entryRepo: VfsEntryRepository,
  physical: string,
  prefetch?: RestorePathPrefetch,
): Promise<string | null> {
  if (prefetch?.liveHashByPath != null) {
    return prefetch.liveHashByPath.get(physical) ?? null;
  }
  return entryRepo.findContentHash(physical);
}

/**
 * Creates parent directories from root down (idempotent mkdir).
 */
export async function ensureDirectoryChain(
  vfs: VfsRestorePort,
  logicalPath: string,
): Promise<void> {
  const normalized = normalizePath(logicalPath);
  const dirs: string[] = [];
  let current = parentDir(normalized);
  while (current !== "/") {
    dirs.unshift(current);
    current = parentDir(current);
  }
  for (const dir of dirs) {
    await mkdirIgnoreExistingDirectory(vfs, dir);
  }
}

/**
 * Restores one logical path to the content/status of a stored revision.
 *
 * @remarks
 * - live head version 已等于目标 version → 直接跳过
 * - version 不等但 live `content_hash` 与目标 revision 相同 → 跳过解压与 write（T-RB1 允许 live version 高于锚点）
 * - 传入 `entryRepo` 时才启用 hash 短路；未传则退化为全量 find + write
 */
export async function restorePathToRevision(
  vfs: VfsRestorePort,
  revisionRepo: VfsRevisionRepository,
  scope: VfsScope,
  logicalPath: string,
  version: number,
  liveHeadByPath?: ReadonlyMap<string, number>,
  entryRepo?: VfsEntryRepository,
  prefetch?: RestorePathPrefetch,
): Promise<RestorePathOutcome> {
  // live head 已与 checkpoint 目标 version 对齐时，正文无需再 restore。
  if (liveHeadByPath?.get(logicalPath) === version) {
    return "skipped_same_version";
  }

  const physical = toPhysicalPath(scope, logicalPath);

  // 轻量 meta：先判 deleted / 再比 content_hash，避免无谓解压。
  if (entryRepo != null) {
    const meta = await resolveRevisionMeta(
      revisionRepo,
      physical,
      version,
      prefetch,
    );
    if (meta == null) {
      throw sessionFsRestoreRevisionMissing(logicalPath, version);
    }
    if (meta.status === "deleted") {
      try {
        await vfs.delete(logicalPath);
      } catch (error) {
        if (!isVfsError(error, "NOT_FOUND")) {
          throw error;
        }
      }
      return "deleted";
    }
    if (meta.contentHash != null && meta.contentHash.length > 0) {
      const liveHash = await resolveLiveHash(entryRepo, physical, prefetch);
      if (liveHash != null && liveHash === meta.contentHash) {
        return "skipped_same_content_hash";
      }
    }
  }

  const rev = await revisionRepo.findByPathAndVersion(physical, version);
  if (rev == null) {
    throw sessionFsRestoreRevisionMissing(logicalPath, version);
  }

  if (rev.status === "deleted") {
    try {
      await vfs.delete(logicalPath);
    } catch (error) {
      if (!isVfsError(error, "NOT_FOUND")) {
        throw error;
      }
    }
    return "deleted";
  }

  await ensureDirectoryChain(vfs, logicalPath);
  // find* 已按 ContentStore 解出明文；禁止再用 ?? "" 把未解 NULL 当空串。
  if (rev.content == null) {
    throw sessionFsRestoreRevisionMissing(logicalPath, version);
  }
  await vfs.write(logicalPath, rev.content, { versionCheck: false });
  return "restored";
}

/**
 * 缺失 revision 时先回补 placeholder，再执行严格 restore。
 *
 * @returns 是否对该 path 执行了 head 回补，以及 restore 结局
 */
export async function restorePathToRevisionWithBackfill(
  vfs: VfsRestorePort,
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  scope: VfsScope,
  logicalPath: string,
  version: number,
  liveHeadByPath?: ReadonlyMap<string, number>,
  prefetch?: RestorePathPrefetch,
): Promise<{ backfilled: boolean; outcome: RestorePathOutcome }> {
  if (liveHeadByPath?.get(logicalPath) === version) {
    return { backfilled: false, outcome: "skipped_same_version" };
  }

  const physical = toPhysicalPath(scope, logicalPath);
  const backfilled = await backfillMissingRevisionIfNeeded(
    { revisionRepo, entryRepo },
    physical,
    version,
  );
  const outcome = await restorePathToRevision(
    vfs,
    revisionRepo,
    scope,
    logicalPath,
    version,
    liveHeadByPath,
    entryRepo,
    prefetch,
  );
  return { backfilled, outcome };
}
