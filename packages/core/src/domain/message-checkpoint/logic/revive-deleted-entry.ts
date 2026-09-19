/**
 * 回滚复活已被物理删除的 entry（rollback-restore-deleted-entry）。
 *
 * 删除文件走 deleteWithRevision：写 status='deleted' 墓碑 revision 后物理
 * DELETE vfs_entry 行。回滚到「entry 尚在」的 checkpoint 时，按 checkpoint
 * 记录的旧 entry_id 原位重建 entry 行，使 revision 历史 (entry_id, version)
 * 重新挂回 live head——语义按「回滚后工作区正文 = 目标检查点完成态」拍板。
 *
 * @module domain/message-checkpoint/logic/revive-deleted-entry
 */

import { adjustRef } from "@/domain/vfs/logic/revision-ref-count.js";
import { scopeKey, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsContentStore } from "@/domain/vfs/content-store/vfs-content-store.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { sessionFsRestoreRevisionMissing } from "@/errors/session-fs-errors.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import type { VfsRestorePort } from "@/domain/vfs/ports/vfs-restore.port.js";
import { ensureDirectoryChain } from "./ensure-directory-chain.js";
import type { RestorePathOutcome } from "./restore-path-model.js";

/** {@link reviveDeletedEntryForRestore} 依赖集合。 */
export type ReviveDeletedEntryDeps = {
  /** 回滚作用域 VFS（墓碑删占用、重建父目录链）。 */
  readonly vfs: VfsRestorePort;
  readonly entryRepo: VfsEntryRepository;
  readonly revisionRepo: VfsRevisionRepository;
  /** 可选 content store：put 幂等确保目标 blob 在位并回取 content_hash。 */
  readonly contentStore?: VfsContentStore;
};

/**
 * 按 checkpoint 旧 entryId 复活已删 entry 并把 live head 拨回目标 version。
 *
 * 步骤：
 * 1. 按旧 entryId 查目标 revision；行缺失 → 抛 restore-missing（真缺，降级）；
 * 2. 目标 revision 是 deleted 态（backfill 回补的墓碑等）→ 按删除语义处理；
 * 3. 路径被新 entry 占用（删除后同路径重建场景）→ 先墓碑删掉新 entry，
 *    tail 期新建的同路径文件被回退；
 * 4. put 幂等保 blob → 重建父目录链 → 显式 entry_id 重建 entry 行 →
 *    adjustRef(+1)（对齐 resetHeadToVersion 的 oldVersion==null 分支：
 *    复活行此前没有 live ref）。
 *
 * @remarks 占用探测直查 DB（不信 prefetch）：prefetch 的 entryIdByPath 来自
 *          live heads 快照，复活场景本就不在快照内；直查还能兜住快照过时的边界。
 */
export async function reviveDeletedEntryForRestore(
  deps: ReviveDeletedEntryDeps,
  scope: VfsScope,
  logicalPath: string,
  checkpointEntryId: number,
  version: number
): Promise<RestorePathOutcome> {
  const { vfs, entryRepo, revisionRepo, contentStore } = deps;
  const scopeKeyStr = scopeKey(scope);

  const meta = await revisionRepo.findMetaByEntryAndVersion(
    checkpointEntryId,
    version
  );
  if (meta == null) {
    // revision 真缺（非 entry 缺）：维持降级语义。
    throw sessionFsRestoreRevisionMissing(logicalPath, version);
  }
  if (meta.status === "deleted") {
    // 防御：checkpoint 只 capture live head，正常不指向 deleted 态；
    // revisionHeadBackfill 对 entry 已删场景回补的 deleted 墓碑会落到这里——
    // 目标即删除态，路径上不留文件。
    try {
      await vfs.delete(logicalPath);
    } catch (error) {
      if (!isVfsError(error, "NOT_FOUND")) {
        throw error;
      }
    }
    return "deleted";
  }

  const rev = await revisionRepo.findByEntryAndVersion(
    checkpointEntryId,
    version
  );
  if (rev == null || rev.content == null) {
    // 与 restorePathToRevision 正常分支同口径：active 行无正文无法恢复。
    throw sessionFsRestoreRevisionMissing(logicalPath, version);
  }

  // 路径被新 entry 占用（删除后同路径重建）：先墓碑删掉新 entry。
  // 按「回滚后工作区正文 = 目标检查点完成态」拍板——旧内容回来、tail 期
  // 新建的同路径文件被回退；新 entry 的 revision 历史保留在其 entryId 下。
  const occupied = await entryRepo.findByPath(scopeKeyStr, logicalPath);
  if (occupied != null) {
    try {
      await vfs.delete(logicalPath);
    } catch (error) {
      if (!isVfsError(error, "NOT_FOUND")) {
        throw error;
      }
    }
  }

  // put 幂等：blob 正常由 revision 触发器维护在位，这里确保复活 entry 的
  // content_hash 有 blob 可解，并回取权威 hash（对齐 resetHeadToVersion）。
  const contentHash = contentStore
    ? await contentStore.put(rev.content)
    : meta.contentHash;
  if (contentHash == null || contentHash.length === 0) {
    throw sessionFsRestoreRevisionMissing(logicalPath, version);
  }

  await ensureDirectoryChain(vfs, logicalPath);
  await entryRepo.reviveEntryAtVersion({
    entryId: checkpointEntryId,
    scopeKey: scopeKeyStr,
    path: logicalPath,
    contentHash,
    headVersion: version,
    mtimeMs: rev.mtimeMs,
  });
  await adjustRef(revisionRepo, checkpointEntryId, version, +1);
  return "restored";
}
