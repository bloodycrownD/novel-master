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
  if (heads.length === 0) {
    return 0;
  }

  // 批量检查哪些 (entryId, version) 的 revision 已存在
  const existingKeys = await revisionRepo.findExistingEntryVersionKeys(
    heads.map((h) => ({ entryId: h.entryId, version: h.headVersion })),
  );
  const needsSeed = heads.filter(
    (h) => !existingKeys.has(`${h.entryId}:${h.headVersion}`),
  );
  if (needsSeed.length === 0) {
    return 0;
  }

  // 批量取每个待种文件的 content_hash（不解明文）
  const hashMap = await entryRepo.findContentHashesByPaths(
    scopeKey,
    needsSeed.map((h) => h.path),
  );

  // 批量确保 blob 存在（同库时全部已存在）
  const allHashes = [
    ...new Set(
      needsSeed
        .map((h) => hashMap.get(h.path) ?? null)
        .filter((h): h is string => h != null),
    ),
  ];
  if (allHashes.length > 0 && contentStore != null) {
    const existingBlobs =
      await contentStore.findExistingBlobHashes(allHashes);
    const missingHashes = allHashes.filter((h) => !existingBlobs.has(h));
    // blob 缺失时逐个 ensureBlob（回退路径；同库复制不会走到）
    for (const hash of missingHashes) {
      await contentStore.ensureBlob(hash, null);
    }
  }

  // 批量 INSERT revision（ref_count = 1，省掉逐条 adjustRefCount）
  const items = needsSeed.map((h) => {
    const contentHash = hashMap.get(h.path) ?? null;
    // file entry 理应有 hash；遇 null 视为受损数据，以 deleted 兜底，防止脏 revision 污染 head
    const status = contentHash != null ? "active" : "deleted";
    return {
      entryId: h.entryId,
      version: h.headVersion,
      contentHash,
      status,
      // 用 entry.mtimeMs 保留“文件真实修改时间”，避免漂移成种子时刻
      mtimeMs: h.mtimeMs,
      refCount: 1,
    };
  });
  await revisionRepo.batchAppendWithRefCount(items);
  return needsSeed.length;
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
