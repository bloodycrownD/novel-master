/**
 * 用 live head 回补缺失的 checkpoint revision 行。
 *
 * entry_id 化后按 entryId 探测 / append；entry 不存在（已 hardDelete）时无法回补，
 * 直接返回 false（无 entry_id 可挂 revision 行）。
 *
 * @module domain/message-checkpoint/logic/backfill-missing-revision
 */

import type { VfsContentStore } from "@/domain/vfs/content-store/vfs-content-store.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { RevisionRefCount } from "@/domain/vfs/logic/revision-ref-count.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/** `BackfillMissingRevision.backfillIfNeeded` 依赖。 */
export type BackfillRevisionDeps = {
  readonly revisionRepo: VfsRevisionRepository;
  readonly entryRepo: VfsEntryRepository;
  /** 可选 content store：共享 blob 回补前执行 ensureBlob。 */
  readonly contentStore?: VfsContentStore;
};

export const BackfillMissingRevision = {
  /**
   * checkpoint 目标 revision 缺失时，用 live head 追加 placeholder 行，使 restore 可继续。
   *
   * @returns Result.ok 是否写入了回补行
   * @remarks 不 bump live entry 版本，仅补历史 revision 行；只落 content_hash，不 put 明文副本。
   */
  async backfillIfNeeded(deps: BackfillRevisionDeps, scopeKey: string, logicalPath: string, entryId: number | null, targetVersion: number): Promise<Result<boolean, AppError>> {
    if (entryId == null) {
      // entry 已不存在（hardDelete）：无 entry_id 可挂 revision，无法回补。
      return Result.ok(false);
    }

    const exists = await deps.revisionRepo.existsByEntryAndVersion(entryId, targetVersion);
    if (exists) {
      return Result.ok(false);
    }

    const entry = await deps.entryRepo.findByPath(scopeKey, logicalPath);
    if (!entry.ok) return Result.err(entry.error);
    const mtimeMs = Date.now();

    if (entry.value != null && entry.value.entryKind === "file") {
      const hash = await deps.entryRepo.findContentHash(scopeKey, logicalPath);
      if (!hash.ok) return Result.err(hash.error);
      const contentHash = hash.value;
      if (contentHash != null && deps.contentStore != null) {
        await deps.contentStore.ensureBlob(contentHash, null);
      }
      await deps.revisionRepo.append({
        entryId,
        version: targetVersion,
        content: null,
        contentHash,
        status: "active",
        mtimeMs,
      });
      await RevisionRefCount.adjust(deps.revisionRepo, entryId, targetVersion, +1);
      return Result.ok(true);
    }

    await deps.revisionRepo.append({
      entryId,
      version: targetVersion,
      content: null,
      status: "deleted",
      mtimeMs,
    });
    await RevisionRefCount.adjust(deps.revisionRepo, entryId, targetVersion, +1);
    return Result.ok(true);
  },
} as const;
