/**
 * 批量写入（角色卡 / ZIP / 树拷贝）后补种 live head 的 vfs_revision。
 *
 * entry_id 化后按 `(scopeKey, pathPrefix)` 扫描 live head，revision append / adjustRef
 * 全部吃 entryId。
 *
 * @module domain/vfs/logic/seed-live-head-revisions
 */

import { RevisionRefCount } from "@/domain/vfs/logic/revision-ref-count.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsContentStore } from "@/domain/vfs/content-store/vfs-content-store.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { VfsExcludePrefixes } from "./vfs-exclude-prefixes.js";

export const LiveHeadRevisionSeeder = {
    /**
   * 为 scope + 前缀下每个 live file head 补种缺失的 revision 行，并 +1 live ref。
   *
   * @returns Result.ok 新写入的 revision 行数
   * @remarks 已存在的 (entryId, version) 跳过（不二次 +1）。
   * `excludePrefixes` 非空时跳过排除前缀下的 head（隔离豁免，与 replaceVfsSubtree
   * 三侧对齐；防御性——排除前缀下本就不该被本次拷贝触碰）。
   */
    async seedUnderPrefix(p: { entryRepo: VfsEntryRepository; revisionRepo: VfsRevisionRepository; scopeKey: string; pathPrefix: string; contentStore?: VfsContentStore; excludePrefixes?: readonly string[] }): Promise<Result<number, AppError>> {
        const excludes = p.excludePrefixes ?? [];
        const heads = (await p.entryRepo.listFileHeadsUnderPrefix(p.scopeKey, p.pathPrefix)).filter((h) => !VfsExcludePrefixes.isPathExcluded(h.path, excludes));
        if (heads.length === 0) {
            return Result.ok(0);
        }

        // 批量检查哪些 (entryId, version) 的 revision 已存在
        const existingKeys = await p.revisionRepo.findExistingEntryVersionKeys(heads.map((h) => ({ entryId: h.entryId, version: h.headVersion })));
        const needsSeed = heads.filter((h) => !existingKeys.has(`${h.entryId}:${h.headVersion}`));
        if (needsSeed.length === 0) {
            return Result.ok(0);
        }

        // 批量取每个待种文件的 content_hash（不解明文）
        const hashes = await p.entryRepo.findContentHashesByPaths(p.scopeKey, needsSeed.map((h) => h.path));
        if (!hashes.ok) return Result.err(hashes.error);
        const hashMap = hashes.value;

        // 批量确保 blob 存在（同库时全部已存在）
        const allHashes = [...new Set(needsSeed.map((h) => hashMap.get(h.path) ?? null).filter((h): h is string => h != null))];
        if (allHashes.length > 0 && p.contentStore != null) {
            const existingBlobs = await p.contentStore.findExistingBlobHashes(allHashes);
            const missingHashes = allHashes.filter((h) => !existingBlobs.has(h));
            // blob 缺失时逐个 ensureBlob（回退路径；同库复制不会走到）
            for (const hash of missingHashes) {
                await p.contentStore.ensureBlob(hash, null);
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
        await p.revisionRepo.batchAppendWithRefCount(items);
        return Result.ok(needsSeed.length);
    },

    /**
   * 插入文件并立即种 revision（对齐 RevisionAwareVfsService 新建路径）。
   * 若路径上仍有历史 revision（如 checkpoint 仍钉旧版），版本取 max+1。
   */
    async insertFileSeeding(p: { entryRepo: VfsEntryRepository; revisionRepo: VfsRevisionRepository; scopeKey: string; logicalPath: string; content: string }): Promise<Result<{ version: number }, AppError>> {
        const found = await p.entryRepo.findByPath(p.scopeKey, p.logicalPath);
        if (!found.ok) return Result.err(found.error);
        const entryId = found.value?.entryId;
        let version: number;
        if (entryId != null) {
            const maxRevision = await p.revisionRepo.findMaxVersionForEntry(entryId);
            if (maxRevision != null) {
                const insertedAt = await p.entryRepo.insertAtVersion(p.scopeKey, p.logicalPath, p.content, maxRevision + 1);
                if (!insertedAt.ok) return Result.err(insertedAt.error);
                version = maxRevision + 1;
            } else {
                const inserted = await p.entryRepo.insert(p.scopeKey, p.logicalPath, p.content);
                if (!inserted.ok) return Result.err(inserted.error);
                version = inserted.value.version;
            }
        } else {
            const inserted = await p.entryRepo.insert(p.scopeKey, p.logicalPath, p.content);
            if (!inserted.ok) return Result.err(inserted.error);
            version = inserted.value.version;
        }
        const after = await p.entryRepo.findByPath(p.scopeKey, p.logicalPath);
        if (!after.ok) return Result.err(after.error);
        const contentHash = await p.entryRepo.findContentHash(p.scopeKey, p.logicalPath);
        if (!contentHash.ok) return Result.err(contentHash.error);
        await p.revisionRepo.append({
            entryId: after.value!.entryId,
            version,
            content: null,
            contentHash: contentHash.value,
            status: "active",
            mtimeMs: after.value?.mtimeMs ?? Date.now(),
        });
        await RevisionRefCount.adjust(p.revisionRepo, after.value!.entryId, version, +1);
        return Result.ok({ version });
    },
} as const;
