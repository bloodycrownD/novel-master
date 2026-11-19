/**
 * 回滚复活已被物理删除的 entry（rollback-restore-deleted-entry）。
 *
 * 删除文件走 deleteWithRevision：写 status='deleted' 墓碑 revision 后物理
 * DELETE vfs_entry 行。回滚到「entry 尚在」的 checkpoint 时，按 checkpoint
 * 记录的旧 entry_id 原位重建 entry 行，使 revision 历史 (entry_id, version)
 * 重新挂回 live head——语义按「回滚后工作区正文 = 目标检查点完成态」拍板。
 *
 * 领域失败（revision / 正文 / blob 缺失）一律返回 `Result`，不在函数体内
 * throw；`VfsRestorePort` 的异常按 phase 1 端口约定原样透传。
 *
 * @module domain/message-checkpoint/logic/revive-deleted-entry
 */

// legacy-port: VfsRestorePort — phase 2

import { RevisionRefCount } from "@/domain/vfs/logic/revision-ref-count.js";
import { LogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { DirectoryChain } from "./ensure-directory-chain.js";
import type { RestorePathDeps, RestorePathError, RestorePathOutcome, RestorePathParams } from "./restore-path-model.js";

/** `DeletedEntry.revive` 依赖：restore 底座里 revive 必需的三项 + 必填 entryRepo。 */
export type ReviveDeletedEntryDeps = Pick<RestorePathDeps, "vfs" | "revisionRepo" | "contentStore"> & {
  readonly entryRepo: VfsEntryRepository;
};

/** `DeletedEntry.revive` 定位参数：checkpoint 旧 entryId 必填。 */
export type ReviveDeletedEntryParams = Pick<RestorePathParams, "scope" | "logicalPath" | "version"> & {
  /** checkpoint 记录的旧 entryId（复活分支的寻址依据）。 */
  readonly checkpointEntryId: number;
};

export const DeletedEntry = {
  /**
   * 按 checkpoint 旧 entryId 复活已删 entry 并把 live head 拨回目标 version。
   *
   * 步骤：
   * 1. 按旧 entryId 查目标 revision；行缺失 → 返回 restore-missing（真缺，降级）；
   * 2. 目标 revision 是 deleted 态（backfill 回补的墓碑等）→ 按删除语义处理；
   * 3. 路径被新 entry 占用（删除后同路径重建场景）→ 先墓碑删掉新 entry，
   *    tail 期新建的同路径文件被回退；
   * 4. put 幂等保 blob → 重建父目录链 → 显式 entry_id 重建 entry 行 →
   *    RevisionRefCount.adjust(+1)（对齐 resetHeadToVersion 的 oldVersion==null 分支：
   *    复活行此前没有 live ref）。
   *
   * @remarks 占用探测直查 DB（不信 prefetch）：prefetch 的 entryIdByPath 来自
   *          live heads 快照，复活场景本就不在快照内；直查还能兜住快照过时的边界。
   */
  async revive(deps: ReviveDeletedEntryDeps, params: ReviveDeletedEntryParams): Promise<Result<RestorePathOutcome, RestorePathError>> {
    const { vfs, entryRepo, revisionRepo, contentStore } = deps;
    const { scope, logicalPath, checkpointEntryId, version } = params;
    const scopeKeyStr = LogicalPath.scopeKey(scope);

    const meta = await revisionRepo.findMetaByEntryAndVersion(checkpointEntryId, version);
    if (meta == null) {
      // revision 真缺（非 entry 缺）：维持降级语义。
      return Result.err(new AppError("SESSION_FS_RESTORE_REVISION_MISSING", { descriptor: { key: "error.session_fs.restore_revision_missing", params: { logical_path: logicalPath, revision_version: version } }, logicalPath, revisionVersion: version }));
    }
    if (meta.status === "deleted") {
      // 防御：checkpoint 只 capture live head，正常不指向 deleted 态；
      // revisionHeadBackfill 对 entry 已删场景回补的 deleted 墓碑会落到这里——
      // 目标即删除态，路径上不留文件。
      const removed = await vfs.delete(logicalPath);
      if (!removed.ok && !isAppError(removed.error, "VFS_NOT_FOUND")) {
        return Result.err(removed.error);
      }
      return Result.ok("deleted");
    }

    const rev = await revisionRepo.findByEntryAndVersion(checkpointEntryId, version);
    if (!rev.ok) return Result.err(rev.error);
    if (rev.value == null || rev.value.content == null) {
      // 与 RestorePath.restoreToRevision 正常分支同口径：active 行无正文无法恢复。
      return Result.err(new AppError("SESSION_FS_RESTORE_REVISION_MISSING", { descriptor: { key: "error.session_fs.restore_revision_missing", params: { logical_path: logicalPath, revision_version: version } }, logicalPath, revisionVersion: version }));
    }

    // 路径被新 entry 占用（删除后同路径重建）：先墓碑删掉新 entry。
    // 按「回滚后工作区正文 = 目标检查点完成态」拍板——旧内容回来、tail 期
    // 新建的同路径文件被回退；新 entry 的 revision 历史保留在其 entryId 下。
    const occupied = await entryRepo.findByPath(scopeKeyStr, logicalPath);
    if (!occupied.ok) return Result.err(occupied.error);
    if (occupied.value != null) {
      const removed = await vfs.delete(logicalPath);
      if (!removed.ok && !isAppError(removed.error, "VFS_NOT_FOUND")) {
        return Result.err(removed.error);
      }
    }

    // put 幂等：blob 正常由 revision 触发器维护在位，这里确保复活 entry 的
    // content_hash 有 blob 可解，并回取权威 hash（对齐 resetHeadToVersion）。
    const contentHash = contentStore ? await contentStore.put(rev.value.content) : meta.contentHash;
    if (contentHash == null || contentHash.length === 0) {
      return Result.err(new AppError("SESSION_FS_RESTORE_REVISION_MISSING", { descriptor: { key: "error.session_fs.restore_revision_missing", params: { logical_path: logicalPath, revision_version: version } }, logicalPath, revisionVersion: version }));
    }

    const ensured = await DirectoryChain.ensure(vfs, logicalPath);
    if (!ensured.ok) {
      return Result.err(ensured.error);
    }
    await entryRepo.reviveEntryAtVersion({
      entryId: checkpointEntryId,
      scopeKey: scopeKeyStr,
      path: logicalPath,
      contentHash,
      headVersion: version,
      mtimeMs: rev.value.mtimeMs,
    });
    await RevisionRefCount.adjust(revisionRepo, checkpointEntryId, version, +1);
    return Result.ok("restored");
  },
} as const;
