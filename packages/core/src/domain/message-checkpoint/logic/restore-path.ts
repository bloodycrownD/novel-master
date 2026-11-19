/**
 * Restores a logical path to a specific revision (forward restore).
 *
 * entry_id 化后 revision 按 `entryId` 寻址；`vfs` / entryRepo 都吃纯逻辑路径。
 * 走 resetHead 语义（不 append 新 revision），revision 表行数不回滚不增长。
 *
 * entry 缺失（物理删除）分支已放宽：调用方传入 checkpoint 记录的旧 entryId
 * 时走 revive-deleted-entry 原位复活（rollback-restore-deleted-entry）。
 *
 * 领域失败（revision / 正文缺失）一律返回 `Result`，不在函数体内 throw；
 * `VfsRestorePort` 的异常按 phase 1 端口约定原样透传。
 *
 * @module domain/message-checkpoint/logic/restore-path
 */

// legacy-port: VfsRestorePort — phase 2

import { LogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { RevisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { BackfillMissingRevision } from "./backfill-missing-revision.js";
import { DeletedEntry } from "./revive-deleted-entry.js";
import { DirectoryChain } from "./ensure-directory-chain.js";
import type { RestorePathDeps, RestorePathError, RestorePathOutcome, RestorePathParams, RestorePathPrefetch } from "./restore-path-model.js";

export type { RestorePathDeps, RestorePathOutcome, RestorePathParams, RestorePathPrefetch } from "./restore-path-model.js";

/** `RestorePath.restoreToRevisionWithBackfill` 依赖：restore 底座 + 必填 entryRepo + 事务连接。 */
export type RestorePathWithBackfillDeps = Pick<RestorePathDeps, "vfs" | "revisionRepo"> & {
  readonly entryRepo: VfsEntryRepository;
  /** 事务连接：回补段用它现造 content store（调用方必须已在 conn.transaction 内）。 */
  readonly tx: TdbcConnection;
};

export const RestorePath = {
  async resolveEntryId(entryRepo: VfsEntryRepository, scopeKeyStr: string, logicalPath: string, prefetch?: RestorePathPrefetch): Promise<Result<number | null, AppError>> {
    if (prefetch?.entryIdByPath != null) {
      return Result.ok(prefetch.entryIdByPath.get(logicalPath) ?? null);
    }
    const entry = await entryRepo.findByPath(scopeKeyStr, logicalPath);
    if (!entry.ok) return Result.err(entry.error);
    return Result.ok(entry.value?.entryId ?? null);
  },

  /** 解析 checkpoint 记录的旧 entryId：prefetch 优先，其次显式参数。 */
  resolveCheckpointEntryId(logicalPath: string, prefetch: RestorePathPrefetch | undefined, checkpointEntryId: number | null | undefined): number | null {
    if (prefetch?.checkpointEntryIdByPath != null) {
      return prefetch.checkpointEntryIdByPath.get(logicalPath) ?? null;
    }
    return checkpointEntryId ?? null;
  },

  /**
   * Restores one logical path to the content/status of a stored revision.
   *
   * @remarks
   * - live head version 已等于目标 version → 直接跳过
   * - version 不等但 live `content_hash` 与目标 revision 相同 → 跳过解压与 write（T-RB1 允许 live version 高于锚点）
   * - 传入 `deps.entryRepo` 时才启用 hash 短路；未传则退化为全量 find + write
   * - entry 行已被物理删除但调用方给了 checkpoint 旧 entryId（显式参数或
   *   `prefetch.checkpointEntryIdByPath`）时，走 revive-deleted-entry 复活
   */
  async restoreToRevision(deps: RestorePathDeps, params: RestorePathParams): Promise<Result<RestorePathOutcome, RestorePathError>> {
    const { vfs, revisionRepo, entryRepo, contentStore } = deps;
    const { scope, logicalPath, version, liveHeadByPath, prefetch, checkpointEntryId } = params;
    // checkpoint 旧 entryId 上下文提前解析：live entry 与指针不同源（删除后
    // 同路径重建）时版本空间各自独立，所有 version/hash 短路都不可信。
    const cpEntryId = RestorePath.resolveCheckpointEntryId(logicalPath, prefetch, checkpointEntryId);
    const scopeKeyStr = LogicalPath.scopeKey(scope);

    // entry_id 解析：prefetch 优先，退化为 entryRepo 探测。
    let entryId: number | null = null;
    if (entryRepo != null) {
      const resolved = await RestorePath.resolveEntryId(entryRepo, scopeKeyStr, logicalPath, prefetch);
      if (!resolved.ok) return Result.err(resolved.error);
      entryId = resolved.value;
    }

    if (entryRepo != null && cpEntryId != null && entryId != null && cpEntryId !== entryId) {
      // 同路径异 entry：live 上是 tail 期新建的 entry，checkpoint 指向被删的
      // 旧 entry。按「回滚后工作区正文 = 目标检查点完成态」拍板——墓碑新
      // entry、复活旧 entry（revive 内含占用清除）。
      return DeletedEntry.revive({ vfs, entryRepo, revisionRepo, contentStore }, { scope, logicalPath, checkpointEntryId: cpEntryId, version });
    }

    // live head 已与 checkpoint 目标 version 对齐时，正文无需再 restore。
    if (liveHeadByPath?.get(logicalPath) === version) {
      return Result.ok("skipped_same_version");
    }

    // 轻量 meta：先判 deleted / 再比 content_hash，避免无谓解压。
    if (entryRepo != null && entryId != null) {
      const meta = prefetch?.revisionMetaByKey != null ? prefetch.revisionMetaByKey.get(RevisionPairKey.build(entryId, version)) ?? null : await revisionRepo.findMetaByEntryAndVersion(entryId, version);
      if (meta == null) {
        return Result.err(new AppError("SESSION_FS_RESTORE_REVISION_MISSING", { descriptor: { key: "error.session_fs.restore_revision_missing", params: { logical_path: logicalPath, revision_version: version } }, logicalPath, revisionVersion: version }));
      }
      if (meta.status === "deleted") {
        const removed = await vfs.delete(logicalPath);
        if (!removed.ok && !isAppError(removed.error, "VFS_NOT_FOUND")) {
          return Result.err(removed.error);
        }
        return Result.ok("deleted");
      }
      if (meta.contentHash != null && meta.contentHash.length > 0) {
        let liveHash: string | null = prefetch?.liveHashByPath?.get(logicalPath) ?? null;
        if (prefetch?.liveHashByPath == null) {
          const hash = await entryRepo.findContentHash(scopeKeyStr, logicalPath);
          if (!hash.ok) return Result.err(hash.error);
          liveHash = hash.value;
        }
        if (liveHash != null && liveHash === meta.contentHash) {
          return Result.ok("skipped_same_content_hash");
        }
      }
    }

    if (entryId == null) {
      // entry 已被物理删除（deleteWithRevision）。携带 checkpoint 旧 entryId 时
      // 原位复活 entry（rollback-restore-deleted-entry）；无上下文（老 checkpoint
      // 无 path 快照、或调用方未传）维持降级：返回 restore-missing。
      if (entryRepo != null && cpEntryId != null) {
        return DeletedEntry.revive({ vfs, entryRepo, revisionRepo, contentStore }, { scope, logicalPath, checkpointEntryId: cpEntryId, version });
      }
      return Result.err(new AppError("SESSION_FS_RESTORE_REVISION_MISSING", { descriptor: { key: "error.session_fs.restore_revision_missing", params: { logical_path: logicalPath, revision_version: version } }, logicalPath, revisionVersion: version }));
    }

    const rev = await revisionRepo.findByEntryAndVersion(entryId, version);
    if (!rev.ok) return Result.err(rev.error);
    if (rev.value == null) {
      return Result.err(new AppError("SESSION_FS_RESTORE_REVISION_MISSING", { descriptor: { key: "error.session_fs.restore_revision_missing", params: { logical_path: logicalPath, revision_version: version } }, logicalPath, revisionVersion: version }));
    }

    if (rev.value.status === "deleted") {
      const removed = await vfs.delete(logicalPath);
      if (!removed.ok && !isAppError(removed.error, "VFS_NOT_FOUND")) {
        return Result.err(removed.error);
      }
      return Result.ok("deleted");
    }

    const ensured = await DirectoryChain.ensure(vfs, logicalPath);
    if (!ensured.ok) {
      return Result.err(ensured.error);
    }
    // find* 已按 ContentStore 解出明文；禁止再用 ?? "" 把未解 NULL 当空串。
    if (rev.value.content == null) {
      return Result.err(new AppError("SESSION_FS_RESTORE_REVISION_MISSING", { descriptor: { key: "error.session_fs.restore_revision_missing", params: { logical_path: logicalPath, revision_version: version } }, logicalPath, revisionVersion: version }));
    }
    const reset = await vfs.resetHeadToVersion(logicalPath, version);
    if (!reset.ok) return Result.err(reset.error);
    return Result.ok("restored");
  },

  /**
   * 缺失 revision 时先回补 placeholder，再执行严格 restore。
   *
   * @returns 是否对该 path 执行了 head 回补，以及 restore 结局
   */
  async restoreToRevisionWithBackfill(deps: RestorePathWithBackfillDeps, params: RestorePathParams): Promise<Result<{ backfilled: boolean; outcome: RestorePathOutcome }, RestorePathError>> {
    const { vfs, revisionRepo, entryRepo, tx } = deps;
    const { scope, logicalPath, version, liveHeadByPath, prefetch, checkpointEntryId } = params;
    // 同路径异 entry（删除后同路径重建）时 live head 与目标 version 分属两个
    // 版本空间，same_version 短路失效——交给 RestorePath.restoreToRevision 走墓碑+复活。
    const cpEntryIdEarly = RestorePath.resolveCheckpointEntryId(logicalPath, prefetch, checkpointEntryId);
    const liveEntryIdEarly = prefetch?.entryIdByPath?.get(logicalPath) ?? null;
    const divergedEarly = cpEntryIdEarly != null && liveEntryIdEarly != null && cpEntryIdEarly !== liveEntryIdEarly;
    if (!divergedEarly && liveHeadByPath?.get(logicalPath) === version) {
      return Result.ok({ backfilled: false, outcome: "skipped_same_version" });
    }

    const scopeKeyStr = LogicalPath.scopeKey(scope);
    const resolvedId = await RestorePath.resolveEntryId(entryRepo, scopeKeyStr, logicalPath, prefetch);
    if (!resolvedId.ok) return Result.err(resolvedId.error);
    const entryId = resolvedId.value;
    const cpEntryId = RestorePath.resolveCheckpointEntryId(logicalPath, prefetch, checkpointEntryId);
    const contentStore = new SqliteVfsContentStore(tx);
    // backfill 寻址：live entry 优先，entry 已删时用 checkpoint 旧 entryId——
    // 旧 entryId 的 revision 行在（纯删除场景）则回补 no-op，restore 走复活；
    // 行真缺（如手工删行）时按旧 entryId 回补墓碑，restore 走 deleted 降级。
    // 同路径异 entry（diverged）时 checkpoint 指针与 live head 分属两个版本
    // 空间，回补必须打在旧 entryId 上：行真缺时按旧 entryId 回补占位让
    // restore 走复活降级，不给 live 新 entry 伪造占位行。
    const diverged = cpEntryId != null && entryId != null && cpEntryId !== entryId;
    const backfillEntryId = diverged ? cpEntryId : entryId ?? cpEntryId;
    const backfilled = await BackfillMissingRevision.backfillIfNeeded({ revisionRepo, entryRepo, contentStore }, scopeKeyStr, logicalPath, backfillEntryId, version);
    if (!backfilled.ok) return Result.err(backfilled.error);
    const outcome = await RestorePath.restoreToRevision({ vfs, revisionRepo, entryRepo, contentStore }, { scope, logicalPath, version, liveHeadByPath, prefetch, checkpointEntryId });
    if (!outcome.ok) {
      return Result.err(outcome.error);
    }
    return Result.ok({ backfilled: backfilled.value, outcome: outcome.value });
  },
} as const;
