/**
 * 批量写入（角色卡 / ZIP / 树拷贝）后补种 live head 的 vfs_revision。
 *
 * @module domain/vfs/logic/seed-live-head-revisions
 */

import { adjustRef } from "@/domain/vfs/logic/revision-ref-count.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/**
 * 为前缀下每个 live file head 补种缺失的 revision 行，并 +1 live ref。
 *
 * @returns 新写入的 revision 行数
 * @remarks 已存在的 (path, version) 跳过（不二次 +1）。
 */
export async function seedLiveHeadRevisionsUnderPrefix(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  physicalPrefix: string,
): Promise<number> {
  const heads = await entryRepo.listFileHeadsUnderPrefix(physicalPrefix);
  let seeded = 0;
  for (const head of heads) {
    const exists = await revisionRepo.existsByPathAndVersion(
      head.path,
      head.headVersion,
    );
    if (exists) {
      continue;
    }
    const entry = await entryRepo.findByPath(head.path);
    if (entry == null || entry.entryKind !== "file") {
      await revisionRepo.append({
        path: head.path,
        version: head.headVersion,
        content: null,
        status: "deleted",
        mtimeMs: Date.now(),
        storageKind: "inline",
      });
      await adjustRef(revisionRepo, head.path, head.headVersion, +1);
      seeded++;
      continue;
    }
    const contentHash = await entryRepo.findContentHash(head.path);
    await revisionRepo.append({
      path: head.path,
      version: head.headVersion,
      content: null,
      contentHash,
      status: "active",
      mtimeMs: entry.mtimeMs,
      storageKind: entry.storageKind,
    });
    await adjustRef(revisionRepo, head.path, head.headVersion, +1);
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
  physicalPath: string,
  content: string,
): Promise<{ version: number }> {
  const maxRevision = await revisionRepo.findMaxVersionForPath(physicalPath);
  let version: number;
  if (maxRevision != null) {
    await entryRepo.insertAtVersion(physicalPath, content, maxRevision + 1);
    version = maxRevision + 1;
  } else {
    const inserted = await entryRepo.insert(physicalPath, content);
    version = inserted.version;
  }
  const entry = await entryRepo.findByPath(physicalPath);
  const contentHash = await entryRepo.findContentHash(physicalPath);
  await revisionRepo.append({
    path: physicalPath,
    version,
    content: null,
    contentHash,
    status: "active",
    mtimeMs: entry?.mtimeMs ?? Date.now(),
    storageKind: entry?.storageKind ?? "inline",
  });
  await adjustRef(revisionRepo, physicalPath, version, +1);
  return { version };
}
