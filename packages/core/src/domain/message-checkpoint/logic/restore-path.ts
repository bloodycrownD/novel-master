/**
 * Restores a logical path to a specific revision (forward restore).
 *
 * entry_id 化后 revision 按 `entryId` 寻址；`vfs` / entryRepo 都吃纯逻辑路径。
 * 走 resetHead 语义（不 append 新 revision），revision 表行数不回滚不增长。
 *
 * @module domain/message-checkpoint/logic/restore-path
 */

import { mkdirIgnoreExistingDirectory } from "@/domain/vfs/logic/vfs-move.js";
import { parentDir } from "@/domain/vfs/logic/parent-dir.js";
import { scopeKey, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { sessionFsRestoreRevisionMissing } from "@/errors/session-fs-errors.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { VfsRestorePort } from "@/domain/vfs/ports/vfs-restore.port.js";
import type { VfsRevisionPointerMeta } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { backfillMissingRevisionIfNeeded } from "./backfill-missing-revision.js";

/** restore 单路径结果（供 reconcile 统计短路次数）。 */
export type RestorePathOutcome =
  | "skipped_same_version"
  | "skipped_same_content_hash"
  | "restored"
  | "deleted";

/** reconcile 批量预取的 entryId / revision meta / live hash（内存比对，减 N 次 SQL）。 */
export type RestorePathPrefetch = {
  readonly entryIdByPath?: ReadonlyMap<string, number>;
  readonly revisionMetaByKey?: ReadonlyMap<string, VfsRevisionPointerMeta>;
  readonly liveHashByPath?: ReadonlyMap<string, string | null>;
};

async function resolveEntryId(
  entryRepo: VfsEntryRepository,
  scopeKeyStr: string,
  logicalPath: string,
  prefetch?: RestorePathPrefetch
): Promise<number | null> {
  if (prefetch?.entryIdByPath != null) {
    return prefetch.entryIdByPath.get(logicalPath) ?? null;
  }
  const entry = await entryRepo.findByPath(scopeKeyStr, logicalPath);
  return entry?.entryId ?? null;
}

async function resolveRevisionMeta(
  revisionRepo: VfsRevisionRepository,
  entryId: number,
  version: number,
  prefetch?: RestorePathPrefetch
): Promise<VfsRevisionPointerMeta | null> {
  const key = revisionPairKey(entryId, version);
  if (prefetch?.revisionMetaByKey != null) {
    return prefetch.revisionMetaByKey.get(key) ?? null;
  }
  return revisionRepo.findMetaByEntryAndVersion(entryId, version);
}

async function resolveLiveHash(
  entryRepo: VfsEntryRepository,
  scopeKeyStr: string,
  logicalPath: string,
  prefetch?: RestorePathPrefetch
): Promise<string | null> {
  if (prefetch?.liveHashByPath != null) {
    return prefetch.liveHashByPath.get(logicalPath) ?? null;
  }
  return entryRepo.findContentHash(scopeKeyStr, logicalPath);
}

/**
 * Creates parent directories from root down (idempotent mkdir).
 */
export async function ensureDirectoryChain(
  vfs: VfsRestorePort,
  logicalPath: string
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
  prefetch?: RestorePathPrefetch
): Promise<RestorePathOutcome> {
  // live head 已与 checkpoint 目标 version 对齐时，正文无需再 restore。
  if (liveHeadByPath?.get(logicalPath) === version) {
    return "skipped_same_version";
  }

  const scopeKeyStr = scopeKey(scope);

  // entry_id 解析：prefetch 优先，退化为 entryRepo 探测。
  let entryId: number | null = null;
  if (entryRepo != null) {
    entryId = await resolveEntryId(
      entryRepo,
      scopeKeyStr,
      logicalPath,
      prefetch
    );
  }

  // 轻量 meta：先判 deleted / 再比 content_hash，避免无谓解压。
  if (entryRepo != null && entryId != null) {
    const meta = await resolveRevisionMeta(
      revisionRepo,
      entryId,
      version,
      prefetch
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
      const liveHash = await resolveLiveHash(
        entryRepo,
        scopeKeyStr,
        logicalPath,
        prefetch
      );
      if (liveHash != null && liveHash === meta.contentHash) {
        return "skipped_same_content_hash";
      }
    }
  }

  if (entryId == null) {
    // entry 已 hardDelete（物理删除），revision 无 entry 可挂载，无法恢复，直接抛 restore-missing。
    throw sessionFsRestoreRevisionMissing(logicalPath, version);
  }

  const rev = await revisionRepo.findByEntryAndVersion(entryId, version);
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
  await vfs.resetHeadToVersion(logicalPath, version);
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
  tx: TdbcConnection,
  scope: VfsScope,
  logicalPath: string,
  version: number,
  liveHeadByPath?: ReadonlyMap<string, number>,
  prefetch?: RestorePathPrefetch
): Promise<{ backfilled: boolean; outcome: RestorePathOutcome }> {
  if (liveHeadByPath?.get(logicalPath) === version) {
    return { backfilled: false, outcome: "skipped_same_version" };
  }

  const scopeKeyStr = scopeKey(scope);
  const entryId = await resolveEntryId(
    entryRepo,
    scopeKeyStr,
    logicalPath,
    prefetch
  );
  const backfilled = await backfillMissingRevisionIfNeeded(
    { revisionRepo, entryRepo, contentStore: new SqliteVfsContentStore(tx) },
    scopeKeyStr,
    logicalPath,
    entryId,
    version
  );
  const outcome = await restorePathToRevision(
    vfs,
    revisionRepo,
    scope,
    logicalPath,
    version,
    liveHeadByPath,
    entryRepo,
    prefetch
  );
  return { backfilled, outcome };
}
