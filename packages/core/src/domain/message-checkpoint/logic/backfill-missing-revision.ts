/**
 * 用 live head 回补缺失的 checkpoint revision 行。
 *
 * @module domain/message-checkpoint/logic/backfill-missing-revision
 */

import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { adjustRef } from "@/domain/vfs/logic/revision-ref-count.js";

/** {@link backfillMissingRevisionIfNeeded} 依赖。 */
export type BackfillRevisionDeps = {
  readonly revisionRepo: VfsRevisionRepository;
  readonly entryRepo: VfsEntryRepository;
};

/**
 * checkpoint 目标 revision 缺失时，用 live head 追加 placeholder 行，使 restore 可继续。
 *
 * @returns 是否写入了回补行
 * @remarks 不 bump live entry 版本，仅补历史 revision 行；只落 content_hash，不 put 明文副本。
 */
export async function backfillMissingRevisionIfNeeded(
  deps: BackfillRevisionDeps,
  physicalPath: string,
  targetVersion: number,
): Promise<boolean> {
  const exists = await deps.revisionRepo.existsByPathAndVersion(
    physicalPath,
    targetVersion,
  );
  if (exists) {
    return false;
  }

  const entry = await deps.entryRepo.findByPath(physicalPath);
  const mtimeMs = Date.now();

  if (entry != null && entry.entryKind === "file") {
    const contentHash = await deps.entryRepo.findContentHash(physicalPath);
    await deps.revisionRepo.append({
      path: physicalPath,
      version: targetVersion,
      content: null,
      contentHash,
      status: "active",
      mtimeMs,
      storageKind: entry.storageKind,
    });
    await adjustRef(deps.revisionRepo, physicalPath, targetVersion, +1);
    return true;
  }

  await deps.revisionRepo.append({
    path: physicalPath,
    version: targetVersion,
    content: null,
    status: "deleted",
    mtimeMs,
    storageKind: "inline",
  });
  await adjustRef(deps.revisionRepo, physicalPath, targetVersion, +1);
  return true;
}
