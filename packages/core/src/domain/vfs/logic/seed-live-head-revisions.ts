/**
 * 批量写入（角色卡 / ZIP / 树拷贝）后补种 live head 的 vfs_revision。
 *
 * entry_id 化后按 `(scopeKey, pathPrefix)` 扫描 live head，revision append / adjustRef
 * 全部吃 entryId。
 *
 * @module domain/vfs/logic/seed-live-head-revisions
 */

import { adjustRef } from "@/domain/vfs/logic/revision-ref-count.js";
import type { VfsContentStore } from "@/domain/vfs/content-store/vfs-content-store.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/**
 * 为 scope + 前缀下每个 live file head 补种缺失的 revision 行，并 +1 live ref。
 *
 * @returns 新写入的 revision 行数
 * @remarks 已存在的 (entryId, version) 跳过（不二次 +1）。
 */
export async function seedLiveHeadRevisionsUnderPrefix(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  pathPrefix: string,
  contentStore?: VfsContentStore,
): Promise<number> {
  const heads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, pathPrefix);
  let seeded = 0;
  for (const head of heads) {
    const exists = await revisionRepo.existsByEntryAndVersion(
      head.entryId,
      head.headVersion,
    );
    if (exists) {
      continue;
    }
    const entry = await entryRepo.findByPath(scopeKey, head.path);
    if (entry == null || entry.entryKind !== "file") {
      await revisionRepo.append({
        entryId: head.entryId,
        version: head.headVersion,
        content: null,
        status: "deleted",
        mtimeMs: Date.now(),
      });
      await adjustRef(revisionRepo, head.entryId, head.headVersion, +1);
      seeded++;
      continue;
    }
    const contentHash = await entryRepo.findContentHash(scopeKey, head.path);
    if (contentHash != null && contentStore != null) {
      await contentStore.ensureBlob(contentHash, null);
    }
    await revisionRepo.append({
      entryId: head.entryId,
      version: head.headVersion,
      content: null,
      contentHash,
      status: "active",
      mtimeMs: entry.mtimeMs,
    });
    await adjustRef(revisionRepo, head.entryId, head.headVersion, +1);
    seeded++;
  }
  return seeded;
}

/**
 * 插入文件并立即种 revision（对齐 RevisionAwareVfsService 新建路径）。
 * 若路径上仍有历史 revision（如 checkpoint 仍钉旧版），版本取 max+1。
 */
export async function insertFileSeedingRevision(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  logicalPath: string,
  content: string,
): Promise<{ version: number }> {
  const entry = await entryRepo.findByPath(scopeKey, logicalPath);
  const entryId = entry?.entryId;
  let version: number;
  if (entryId != null) {
    const maxRevision = await revisionRepo.findMaxVersionForEntry(entryId);
    if (maxRevision != null) {
      await entryRepo.insertAtVersion(scopeKey, logicalPath, content, maxRevision + 1);
      version = maxRevision + 1;
    } else {
      const inserted = await entryRepo.insert(scopeKey, logicalPath, content);
      version = inserted.version;
    }
  } else {
    const inserted = await entryRepo.insert(scopeKey, logicalPath, content);
    version = inserted.version;
  }
  const after = await entryRepo.findByPath(scopeKey, logicalPath);
  const contentHash = await entryRepo.findContentHash(scopeKey, logicalPath);
  await revisionRepo.append({
    entryId: after!.entryId,
    version,
    content: null,
    contentHash,
    status: "active",
    mtimeMs: after?.mtimeMs ?? Date.now(),
  });
  await adjustRef(revisionRepo, after!.entryId, version, +1);
  return { version };
}
