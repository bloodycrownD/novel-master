/**
 * Restores a logical path to a specific revision (forward restore).
 *
 * entry_id 化后 revision 按 `entryId` 寻址；`vfs` / entryRepo 都吃纯逻辑路径。
 * 走 resetHead 语义（不 append 新 revision），revision 表行数不回滚不增长。
 *
 * entry 缺失（物理删除）分支已放宽：调用方传入 checkpoint 记录的旧 entryId
 * 时走 revive-deleted-entry 原位复活（rollback-restore-deleted-entry）。
 *
 * @module domain/message-checkpoint/logic/restore-path
 */

import { scopeKey, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { sessionFsRestoreRevisionMissing } from "@/errors/session-fs-errors.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { VfsRestorePort } from "@/domain/vfs/ports/vfs-restore.port.js";
import type { VfsRevisionPointerMeta } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import type { VfsContentStore } from "@/domain/vfs/content-store/vfs-content-store.port.js";
import { backfillMissingRevisionIfNeeded } from "./backfill-missing-revision.js";
import { reviveDeletedEntryForRestore } from "./revive-deleted-entry.js";
import { ensureDirectoryChain } from "./ensure-directory-chain.js";
import type {
  RestorePathOutcome,
  RestorePathPrefetch,
} from "./restore-path-model.js";

export { ensureDirectoryChain } from "./ensure-directory-chain.js";
export type {
  RestorePathOutcome,
  RestorePathPrefetch,
} from "./restore-path-model.js";

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

/** 解析 checkpoint 记录的旧 entryId：prefetch 优先，其次显式参数。 */
function resolveCheckpointEntryId(
  logicalPath: string,
  prefetch: RestorePathPrefetch | undefined,
  checkpointEntryId: number | null | undefined
): number | null {
  if (prefetch?.checkpointEntryIdByPath != null) {
    return prefetch.checkpointEntryIdByPath.get(logicalPath) ?? null;
  }
  return checkpointEntryId ?? null;
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
 * Restores one logical path to the content/status of a stored revision.
 *
 * @remarks
 * - live head version 已等于目标 version → 直接跳过
 * - version 不等但 live `content_hash` 与目标 revision 相同 → 跳过解压与 write（T-RB1 允许 live version 高于锚点）
 * - 传入 `entryRepo` 时才启用 hash 短路；未传则退化为全量 find + write
 * - entry 行已被物理删除但调用方给了 checkpoint 旧 entryId（显式参数或
 *   `prefetch.checkpointEntryIdByPath`）时，走 revive-deleted-entry 复活
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
  checkpointEntryId?: number | null,
  contentStore?: VfsContentStore
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
    // entry 已被物理删除（deleteWithRevision）。携带 checkpoint 旧 entryId 时
    // 原位复活 entry（rollback-restore-deleted-entry）；无上下文（老 checkpoint
    // 无 path 快照、或调用方未传）维持降级：抛 restore-missing。
    const cpEntryId = resolveCheckpointEntryId(
      logicalPath,
      prefetch,
      checkpointEntryId
    );
    if (entryRepo != null && cpEntryId != null) {
      return reviveDeletedEntryForRestore(
        { vfs, entryRepo, revisionRepo, contentStore },
        scope,
        logicalPath,
        cpEntryId,
        version
      );
    }
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
  prefetch?: RestorePathPrefetch,
  checkpointEntryId?: number | null
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
  const cpEntryId = resolveCheckpointEntryId(
    logicalPath,
    prefetch,
    checkpointEntryId
  );
  const contentStore = new SqliteVfsContentStore(tx);
  // backfill 寻址：live entry 优先，entry 已删时用 checkpoint 旧 entryId——
  // 旧 entryId 的 revision 行在（纯删除场景）则回补 no-op，restore 走复活；
  // 行真缺（如手工删行）时按旧 entryId 回补墓碑，restore 走 deleted 降级。
  const backfillEntryId = entryId ?? cpEntryId;
  const backfilled = await backfillMissingRevisionIfNeeded(
    { revisionRepo, entryRepo, contentStore },
    scopeKeyStr,
    logicalPath,
    backfillEntryId,
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
    prefetch,
    checkpointEntryId,
    contentStore
  );
  return { backfilled, outcome };
}
