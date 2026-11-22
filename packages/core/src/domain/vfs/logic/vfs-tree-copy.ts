/**
 * Deep-copies vfs_entry rows under a (scope, path-prefix) pair.
 *
 * entry_id 化后入参从物理 `fromPrefix/toPrefix` 重构成
 * `(fromScope, fromPathPrefix) → (toScope, toPathPrefix)`：源侧扫描用 fromScope.scopeKey，
 * 目标侧变更用 toScope.scopeKey。path 列直接存纯逻辑路径，无需物理前缀拼接。
 *
 * @module domain/vfs/vfs-tree-copy
 */

import { assert } from "@/common/assert.js";
import type { LongTaskHooks } from "@/domain/abort/model/abort-scope.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { Interrupt, Outcome } from "@/errors/outcome.js";
import type { VfsContentStore } from "../content-store/vfs-content-store.port.js";
import type { VfsEntryRepository } from "../repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "../repositories/vfs-revision.port.js";
import { Path } from "@/common/path.js";
import { RevisionRefCount } from "./revision-ref-count.js";
import { LiveHeadRevisionSeeder } from "./seed-live-head-revisions.js";
import { VfsExcludePrefixes } from "./vfs-exclude-prefixes.js";

/** 轻量 scope 引用（只需 scopeKey 字符串）。 */
interface VfsCopyScope {
    readonly scopeKey: string;
}

type CopyVfsTreeOptions = {
    mapPath?: (relative: string) => string;

    /** content store：共享 blob 写入前执行 ensureBlob / findExistingBlobHashes。 */
    readonly contentStore: VfsContentStore;

    /**
   * 隔离豁免：拷贝源时跳过这些逻辑路径前缀（如 `meta/skills`），
   * 默认空数组 = 现行为完全不变。前缀可带或不带前导 `/`。
   */
    readonly excludePrefixes?: string[];

    /**
   * 可选 revision repo：仅在目标 entry 已存在、需要 update 落 head 时使用，
   * 按 `max(head_version, MAX(version)) + 1` 发号（统一语义防边角）。
   * 不传时（fork/copy 直调场景）维持 head + 1 现状，行为不变。
   */
    readonly revisions?: VfsRevisionRepository;

    /**
   * 长任务注入钩子（可选）：每个文件边界 `checkpoint()` 同步判停，命中即
   * 返回 `Outcome.cancelled` / `Outcome.replaced`，已复制的文件保持完整
   * （单文件 / 单批次原子）；每累计 20 个文件调一次 `onProgress` 让路。
   *
   * 调用方注入形态：`{ checkpoint: () => scope.checkpoint(), onProgress: () => { void scope.yieldToUi(); } }`
   * （`yieldToUi()` 返回 `Promise<Interrupt | null>`，不能直接赋给 `() => void`）。
   */
    readonly hooks?: LongTaskHooks;
};

type ReplaceVfsSubtreeOptions = CopyVfsTreeOptions & {
    /**
   * 传入时：删除前释放 live ref + GC，拷贝后为 live head 补种 revision。
   * fork/copy 仍走 seedForkCopyParity，不要传此字段以免双重播种。
   */
    revisions?: VfsRevisionRepository;
};

/**
 * 文件边界：先同步判停，通过后按累计文件数每 20 个让路一次。
 *
 * `hooks?.checkpoint?.()` 未注入时得到 `undefined`，判空必须用宽松的
 * `hit != null`——写成 `hit !== null` 会把 undefined 误判为命中，随后取
 * `.reason` 直接崩。累计文件数 / 让路阈值是跨文件边界的节流游标，
 * 由 progress 槽对象承载（调用方持同一引用，跨调用累计）。
 */
const checkpointFiles = async (progress: { files: number; nextYieldAt: number }, hooks: LongTaskHooks | undefined, fileCount = 1): Promise<Interrupt | null> => {
    const hit = hooks?.checkpoint?.();
    if (hit != null) return hit;
    progress.files += fileCount;
    if (progress.files >= progress.nextYieldAt) {
        progress.nextYieldAt = progress.files + 20;
        await hooks?.onProgress?.();
    }
    return null;
};

export const VfsTreeCopy = {
    relativeUnderPrefix(fullPath: string, prefix: string): string {
        const base = Path.stripTrailingSlash(prefix);
        if (fullPath === base) {
            return "";
        }
        const slashSuffix = base === "/" ? base : `${base}/`;
        assert(fullPath.startsWith(slashSuffix), `[invariant] Path ${fullPath} is not under prefix ${prefix}`);
        return fullPath.slice(slashSuffix.length);
    },

    joinLogical(prefix: string, relative: string): string {
        const base = Path.stripTrailingSlash(prefix);
        if (relative.length === 0) {
            return base;
        }
        return `${base}/${relative}`;
    },

    /**
   * 计算 update 落 head 的目标版本号：`max(head_version, MAX(version)) + 1`。
   *
   * `revisions` 未提供时（fork/copy 直调场景，目标 entry 无 revision 语义）
   * 退回 head + 1，与既有行为等价；`known` 传 null 时内部补一次 findByPath。
   */
    async nextUpdateVersion(repo: VfsEntryRepository, revisions: VfsRevisionRepository | undefined, scopeKey: string, path: string, known: { entryId: number; version: number } | null): Promise<Result<number, AppError>> {
        const found = known != null ? Result.ok(known) : await repo.findByPath(scopeKey, path);
        if (!found.ok) return Result.err(found.error);
        const entry = found.value;
        if (entry == null || revisions == null) {
            return Result.ok((entry?.version ?? 0) + 1);
        }
        const maxStored = await revisions.findMaxVersionForEntry(entry.entryId);
        return Result.ok(Math.max(entry.version, maxStored ?? 0) + 1);
    },

    /**
   * 用 scanContents 解出 scope+prefix 下所有文件的明文，返回 path→content 映射。
   *
   * @remarks 仅在回退路径（blob 缺失或无 hash）调用；快路径不触发。
   */
    async resolvePlainContentMap(repo: VfsEntryRepository, scopeKey: string, pathPrefix: string): Promise<Result<Map<string, string>, AppError>> {
        const rows = await repo.scanContents(scopeKey, pathPrefix);
        if (!rows.ok) return Result.err(rows.error);
        const map = new Map<string, string>();
        for (const row of rows.value) {
            map.set(row.path, row.content);
        }
        return Result.ok(map);
    },

    /** 供三侧（拷贝/删除/seed）统一取排除前缀，缺省为空数组。 */
    resolveExcludePrefixes(excludePrefixes: readonly string[] | undefined): readonly string[] {
        return excludePrefixes ?? [];
    },

    /**
   * Copies all vfs entries under `(fromScope, fromPathPrefix)` to `(toScope, toPathPrefix)`。
   *
   * 文件行优先复制 `content_hash`（共享 blob）；无 hash 时再 put 同源明文一次。
   *
   * 长任务注入（`options.hooks`）：每个文件边界 `checkpoint()` 同步判停，命中即
   * 返回 `Outcome.cancelled` / `Outcome.replaced`（中断不是错误），已复制的文件
   * 保持完整（单文件 / 单批次原子）；每累计 20 个文件让路一次。
   */
    async copyTree(repo: VfsEntryRepository, fromScope: VfsCopyScope, fromPathPrefix: string, toScope: VfsCopyScope, toPathPrefix: string, options?: CopyVfsTreeOptions): Promise<Outcome<void>> {
        const excludePrefixes = VfsTreeCopy.resolveExcludePrefixes(options?.excludePrefixes);
        const hooks = options?.hooks;
        // 累计文件数 / 下次让路阈值（每 20 个文件让路一次的节流游标）。
        const progress = { files: 0, nextYieldAt: 20 };

        // --- 目录：批量检查存在 + 批量 INSERT ---
        const dirPaths = await repo.listDirectoryPathsUnderPrefix(fromScope.scopeKey, fromPathPrefix);
        const targetDirPaths: string[] = [];
        for (const dirPath of dirPaths) {
            if (VfsExcludePrefixes.isPathExcluded(dirPath, excludePrefixes)) {
                continue;
            }
            // 排除前缀的祖先目录不镜像到目标，避免残留空目录链（如只排除 meta/skills
            // 时，源里单独为它存在的 /meta 不该出现在目标）。
            if (excludePrefixes.length > 0 && VfsExcludePrefixes.isPathAncestorOfExcluded(dirPath, excludePrefixes)) {
                continue;
            }
            const relative = VfsTreeCopy.relativeUnderPrefix(dirPath, fromPathPrefix);
            if (relative.length === 0) {
                continue;
            }
            const mapped = options?.mapPath ? options.mapPath(relative) : relative;
            targetDirPaths.push(VfsTreeCopy.joinLogical(toPathPrefix, mapped));
        }
        if (targetDirPaths.length > 0) {
            const existingDirs = await repo.findExistingPaths(toScope.scopeKey, targetDirPaths);
            if (!existingDirs.ok) return { kind: "failed", error: existingDirs.error };
            const newDirs = targetDirPaths.filter((p) => !existingDirs.value.has(p));
            if (newDirs.length > 0) {
                const inserted = await repo.batchInsertDirectoryEntries(toScope.scopeKey, newDirs);
                if (!inserted.ok) return { kind: "failed", error: inserted.error };
            }
        }

        // --- 文件：scanFileEntriesWithMeta 一次 SELECT 拿全部元数据（不解明文）---
        const scannedFiles = await repo.scanFileEntriesWithMeta(fromScope.scopeKey, fromPathPrefix);
        if (!scannedFiles.ok) return { kind: "failed", error: scannedFiles.error };
        const fileEntries = scannedFiles.value;
        const mappedFiles: Array<{
            sourcePath: string;
            targetPath: string;
            contentHash: string | null;
            mtimeMs: number;
        }> = [];
        for (const entry of fileEntries) {
            if (VfsExcludePrefixes.isPathExcluded(entry.path, excludePrefixes)) {
                continue;
            }
            const relative = VfsTreeCopy.relativeUnderPrefix(entry.path, fromPathPrefix);
            if (relative.length === 0) {
                continue;
            }
            const mapped = options?.mapPath ? options.mapPath(relative) : relative;
            mappedFiles.push({
                sourcePath: entry.path,
                targetPath: VfsTreeCopy.joinLogical(toPathPrefix, mapped),
                contentHash: entry.contentHash,
                mtimeMs: entry.mtimeMs,
            });
        }

        const blobFiles = mappedFiles.filter((f) => f.contentHash != null);
        const plainFiles = mappedFiles.filter((f) => f.contentHash == null);

        // --- blob 共享文件：批量路径（同库复制时全部 blob 已存在）---
        if (blobFiles.length > 0) {
            const hashes = [...new Set(blobFiles.map((f) => f.contentHash!))];
            let allBlobsExist = true;
            if (options != null) {
                const existingBlobs = await options.contentStore.findExistingBlobHashes(hashes);
                allBlobsExist = hashes.every((h) => existingBlobs.has(h));
            }

            if (allBlobsExist) {
                // 快路径：批量检查目标存在 + 批量 INSERT
                const targetPaths = blobFiles.map((f) => f.targetPath);
                const existingTargets = await repo.findExistingPaths(toScope.scopeKey, targetPaths);
                if (!existingTargets.ok) return { kind: "failed", error: existingTargets.error };
                const newEntries = blobFiles
                    .filter((f) => !existingTargets.value.has(f.targetPath))
                    .map((f) => ({
                        path: f.targetPath,
                        contentHash: f.contentHash!,
                        mtimeMs: f.mtimeMs,
                    }));
                // 批量 INSERT 是单个原子段：入口判一次停，按批量文件数记账让路。
                const batchInterrupted = await checkpointFiles(progress, hooks, newEntries.length);
                if (batchInterrupted != null) return batchInterrupted;
                if (newEntries.length > 0) {
                    const inserted = await repo.batchInsertFileEntriesWithHash(toScope.scopeKey, newEntries);
                    if (!inserted.ok) return { kind: "failed", error: inserted.error };
                }
                // 已存在的目标用逐条 update（tree-copy 到清空 scope 时不会走到）
                for (const f of blobFiles.filter((f) => existingTargets.value.has(f.targetPath))) {
                    const interrupted = await checkpointFiles(progress, hooks);
                    if (interrupted != null) return interrupted;
                    const nextVersion = await VfsTreeCopy.nextUpdateVersion(repo, options?.revisions, toScope.scopeKey, f.targetPath, null);
                    if (!nextVersion.ok) return { kind: "failed", error: nextVersion.error };
                    const updated = await repo.updateWithContentHash(toScope.scopeKey, f.targetPath, f.contentHash!, nextVersion.value);
                    if (!updated.ok) return { kind: "failed", error: updated.error };
                }
            } else {
                // 慢路径：部分 blob 缺失，回退逐条处理
                const plainMap = await VfsTreeCopy.resolvePlainContentMap(repo, fromScope.scopeKey, fromPathPrefix);
                if (!plainMap.ok) return { kind: "failed", error: plainMap.error };
                for (const f of blobFiles) {
                    const interrupted = await checkpointFiles(progress, hooks);
                    if (interrupted != null) return interrupted;
                    if (options != null) {
                        await options.contentStore.ensureBlob(f.contentHash!, plainMap.value.get(f.sourcePath) ?? null);
                    }
                    const existing = await repo.findByPath(toScope.scopeKey, f.targetPath);
                    if (!existing.ok) return { kind: "failed", error: existing.error };
                    if (existing.value == null) {
                        const inserted = await repo.insertWithContentHash(toScope.scopeKey, f.targetPath, f.contentHash!);
                        if (!inserted.ok) return { kind: "failed", error: inserted.error };
                    } else {
                        const nextVersion = await VfsTreeCopy.nextUpdateVersion(repo, options?.revisions, toScope.scopeKey, f.targetPath, { entryId: existing.value.entryId, version: existing.value.version });
                        if (!nextVersion.ok) return { kind: "failed", error: nextVersion.error };
                        const updated = await repo.updateWithContentHash(toScope.scopeKey, f.targetPath, f.contentHash!, nextVersion.value);
                        if (!updated.ok) return { kind: "failed", error: updated.error };
                    }
                }
            }
        }

        // --- 无 hash 文件：回退 scanContents 取明文逐条写入 ---
        if (plainFiles.length > 0) {
            const plainMap = await VfsTreeCopy.resolvePlainContentMap(repo, fromScope.scopeKey, fromPathPrefix);
            if (!plainMap.ok) return { kind: "failed", error: plainMap.error };
            for (const f of plainFiles) {
                const interrupted = await checkpointFiles(progress, hooks);
                if (interrupted != null) return interrupted;
                const content = plainMap.value.get(f.sourcePath);
                if (content == null) {
                    continue;
                }
                const existing = await repo.findByPath(toScope.scopeKey, f.targetPath);
                if (!existing.ok) return { kind: "failed", error: existing.error };
                if (existing.value == null) {
                    const inserted = await repo.insert(toScope.scopeKey, f.targetPath, content);
                    if (!inserted.ok) return { kind: "failed", error: inserted.error };
                } else {
                    const nextVersion = await VfsTreeCopy.nextUpdateVersion(repo, options?.revisions, toScope.scopeKey, f.targetPath, { entryId: existing.value.entryId, version: existing.value.version });
                    if (!nextVersion.ok) return { kind: "failed", error: nextVersion.error };
                    const updated = await repo.update(toScope.scopeKey, f.targetPath, content, nextVersion.value);
                    if (!updated.ok) return { kind: "failed", error: updated.error };
                }
            }
        }
        return { kind: "completed", value: undefined };
    },

    /**
   * Replaces the target VFS subtree: delete `(toScope, toPathPrefix)` then copy from source。
   *
   * `options.hooks` 透传给 {@link VfsTreeCopy.copyTree}：中断沿 `Outcome.cancelled` /
   * `Outcome.replaced` 返回，调用方事务边界转 `createAbortError()` 触发回滚。
   */
    async replaceSubtree(repo: VfsEntryRepository, fromScope: VfsCopyScope, fromPathPrefix: string, toScope: VfsCopyScope, toPathPrefix: string, options?: ReplaceVfsSubtreeOptions): Promise<Outcome<void>> {
        const excludePrefixes = VfsTreeCopy.resolveExcludePrefixes(options?.excludePrefixes);
        if (options?.revisions != null) {
            const swept = await VfsTreeCopy.sweepRevisionsUnderScope(repo, options.revisions, toScope.scopeKey, toPathPrefix, excludePrefixes);
            if (!swept.ok) return { kind: "failed", error: swept.error };
        } else {
            const deleted = await VfsTreeCopy.deletePrefix(repo, toScope.scopeKey, toPathPrefix, excludePrefixes);
            if (!deleted.ok) return { kind: "failed", error: deleted.error };
        }
        const copied = await VfsTreeCopy.copyTree(repo, fromScope, fromPathPrefix, toScope, toPathPrefix, options);
        if (copied.kind !== "completed") return copied;
        if (options?.revisions != null) {
            const seeded = await LiveHeadRevisionSeeder.seedUnderPrefix(repo, options.revisions, toScope.scopeKey, toPathPrefix, undefined, excludePrefixes);
            if (!seeded.ok) return { kind: "failed", error: seeded.error };
        }
        return { kind: "completed", value: undefined };
    },

    /**
   * 泛化 sweep：释放 scope+前缀下 live head 引用 → GC 无引用 revision → 删 entry。
   *
   * 三 scope（project/session/template）通用。`excludePrefixes` 非空时，
   * 排除前缀下的 entry 不删、live ref 不减、revision 不 GC（隔离豁免，
   * 如 project 域 `meta/skills/` 已有技能不随模板替换被清掉）。
   *
   * @remarks 顺序不可调换：scoped GC（`RevisionRefCount.deleteUnreferencedUnderScope`）靠
   * `JOIN vfs_entry` 圈定范围，必须在 entry 还在时跑；放到 `VfsTreeCopy.deletePrefix`
   * 之后会恒命中 0 行、成为死语句（本顺序与 `revision-gc.ts` 的 session 侧同源）。
   *
   * **为什么必须留在同一事务内**（HEAD 真实机理，别再按旧版本注释理解）：
   * Wave C 的 `c667be0f`（CS-06/CS-07）把 `vfs_content_blob` 的 DELETE 触发器换成了
   * 带守卫的 v2（`bootstrap/vfs/vfs-revision-schema.ts`）：
   *
   * ```sql
   * DELETE FROM vfs_content_blob
   *  WHERE content_hash = OLD.content_hash AND ref_count <= 0
   *    AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
   * ```
   *
   * 所以 GC 删 revision 时 entry 还在 ⇒ **blob 行不会被回收**，旧注释描述的
   * 「entry 指向已回收 blob」数据丢失窗口已被该 DDL 关闭（这是好事）。留下的是
   * 另一面：那条 `UPDATE … ref_count = ref_count - 1` 照跑（无守卫），计数落到 0、
   * 行留着；紧接着的 `VfsTreeCopy.deletePrefix` 删 entry **没有配套触发器**
   * （`vfs_entry` 上零触发器）⇒ 本函数跑完后会留下一批 `ref_count = 0` 的
   * `vfs_content_blob` 行待 gc。
   *
   * 三步同事务这条约束**继续有效**：守卫只挡 DELETE、不挡 −1，那个 ref_count=0 的
   * 中间态仍然存在，必须不外泄到事务外让别的读看到「有 ref 却没有 revision」的
   * scope。所有调用方都以 tx 构造 revision 仓储，拆事务会开出这个窗口。
   *
   * ⚠️ 残留的 blob 行只能靠 `DeferredBlobGc.run` 收（全库算 entry ∪ revision 引用集）。
   * zip 导入 / 角色卡导入 / 技能整目录删除这三条链**从不调它**，见
   * `vfs-gc-trigger.test.ts` 里对应三条链的 blob 口径用例。
   */
    async sweepRevisionsUnderScope(repo: VfsEntryRepository, revisionRepo: VfsRevisionRepository, scopeKey: string, pathPrefix: string, excludePrefixes?: readonly string[]): Promise<Result<void, AppError>> {
        await RevisionRefCount.decrementLiveUnderScope(revisionRepo, repo, scopeKey, pathPrefix, excludePrefixes);
        await RevisionRefCount.deleteUnreferencedUnderScope(revisionRepo, scopeKey, pathPrefix, excludePrefixes);
        return VfsTreeCopy.deletePrefix(repo, scopeKey, pathPrefix, excludePrefixes);
    },

    /**
   * 释放 scope+前缀下 live head 引用 → GC 无引用 revision → 删 entry。
   *
   * @deprecated 使用 {@link VfsTreeCopy.sweepRevisionsUnderScope} 替代，语义相同。
   *
   * nm-style: keep-public — 三个 service 事务调用点（character-card-import ×2、
   * vfs-zip-io ×1）仍走该 @deprecated 别名，内联需改 service 目录（本轮范围外）。
   */
    async releaseAndDeletePrefix(repo: VfsEntryRepository, revisionRepo: VfsRevisionRepository, scopeKey: string, pathPrefix: string): Promise<Result<void, AppError>> {
        return VfsTreeCopy.sweepRevisionsUnderScope(repo, revisionRepo, scopeKey, pathPrefix);
    },

    /**
   * Deletes all vfs entries under a scope + logical path prefix.
   *
   * @remarks 走 {@link VfsEntryRepository.deleteRecursiveIfAny}：先用 listEntriesUnderPrefix
   * 探测，空 prefix 静默返回（不抛 vfsNotFound），非空则一条批量 DELETE...LIKE 清掉整棵子树。
   * `excludePrefixes` 非空时跳过排除前缀下的条目（隔离豁免），退回逐条删除路径。
   */
    async deletePrefix(repo: VfsEntryRepository, scopeKey: string, prefix: string, excludePrefixes?: readonly string[]): Promise<Result<void, AppError>> {
        const excludes = excludePrefixes ?? [];
        const base = Path.stripTrailingSlash(prefix);
        if (excludes.length === 0) {
            // 无排除前缀时走批量快路径（一条 DELETE...LIKE 清整棵子树）。
            const deleted = await repo.deleteRecursiveIfAny(scopeKey, base);
            return deleted.map(() => undefined);
        }
        const entries = await repo.listEntriesUnderPrefix(scopeKey, base);
        const sorted = [...entries].sort((a, b) => b.path.length - a.path.length);
        for (const entry of sorted) {
            if (VfsExcludePrefixes.isPathExcluded(entry.path, excludes)) {
                continue;
            }
            // 祖先目录也保留：排除子树里的 entry 不删，承载它的目录层级不能删，
            // 否则会因「目录非空」失败。
            if (excludes.length > 0 && VfsExcludePrefixes.isPathAncestorOfExcluded(entry.path, excludes)) {
                continue;
            }
            const deleted = await repo.delete(scopeKey, entry.path, { recursive: false });
            if (!deleted.ok) return Result.err(deleted.error);
        }
        return Result.ok(undefined);
    },
} as const;
