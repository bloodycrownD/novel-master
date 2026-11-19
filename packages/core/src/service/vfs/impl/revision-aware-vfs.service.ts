/**
 * VFS service wrapper that appends vfs_revision rows on file write/delete.
 *
 * entry_id 化后实现 {@link InternalVfsService}（scopeKey + 纯逻辑路径）。每次
 * write/delete/resetHead/hardDelete/replace 先按 `(scopeKey, path)` 取出 entry_id，
 * 再交给 revision repo 的 entry_id 寻址方法。`runInTransactionOrConn` 事务模型不变；
 * `renamePath` / `renamePrefix` 走 Step 7 原语（单事务 UPDATE path）。
 *
 * @module service/vfs/impl/revision-aware-vfs.service
 */

import { ParentDirs } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import { EntryNameValidator } from "@/domain/vfs/logic/validate-entry-name.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { PathNormalizer } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { ReplaceResult } from "@/domain/vfs/logic/compute-replace-result.js";
import { RevisionRefCount } from "@/domain/vfs/logic/revision-ref-count.js";
import { VfsRenamePrimitive } from "@/domain/vfs/logic/vfs-rename-primitive.js";
// WHY 反向 import：WriteWithRevision.write / WriteWithRevision.nextVersionFor 已下沉到
// domain 层（批量 ingest 复用同一条写路径，见 domain/vfs/logic/write-with-revision.ts），
// 本文件的删除路径（appendDeletedRevision → WriteWithRevision.nextVersionFor）必须跟着引用共享实现。
import { WriteWithRevision } from "@/domain/vfs/logic/write-with-revision.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { AppError, AppErrorOps } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { TdbcTransaction } from "@/infra/tdbc/logic/transaction-helper.js";

/**
 * 事务回调内的域失败走「抛错回滚」通道，过驱动事务边界后 AppError 被包成
 * TdbcError（原 AppError 挂在 cause 上）。这里解出域错误本体，供调用方把
 * **可容忍**的域失败（VFS_NOT_FOUND）收进 Err；解不出原样上抛。
 */
function unwrapTxDomainError(cause: unknown): AppError | undefined {
  if (AppErrorOps.is(cause)) return cause;
  const inner = (cause as { cause?: unknown } | null)?.cause;
  return AppErrorOps.is(inner) ? inner : undefined;
}

import type { VfsGrepMatch, VfsGrepOptions, VfsListEntry, VfsReadResult, VfsContentSize } from "../internal-vfs.port.js";
import type { InternalVfsService } from "../internal-vfs.port.js";

/**
 * Decorates an inner {@link InternalVfsService} so file mutations append revision history.
 *
 * @remarks Directory mkdir/delete bypass revision storage (checkpoint captures files only).
 */
export class RevisionAwareVfsService implements InternalVfsService {
  constructor(private readonly conn: TdbcConnection, private readonly inner: InternalVfsService) {}

  list(scopeKey: string, dir: string, options?: { recursive?: boolean; maxDepth?: number }): Promise<Result<VfsListEntry[], AppError>> {
    return this.inner.list(scopeKey, dir, options);
  }

  mkdir(scopeKey: string, path: string): Promise<Result<void, AppError>> {
    return this.inner.mkdir(scopeKey, path);
  }

  read(scopeKey: string, path: string): Promise<Result<VfsReadResult, AppError>> {
    return this.inner.read(scopeKey, path);
  }

  findContentSize(scopeKey: string, path: string): Promise<Result<VfsContentSize | null, AppError>> {
    return this.inner.findContentSize(scopeKey, path);
  }

  async write(scopeKey: string, path: string, content: string): Promise<Result<{ version: number }, AppError>> {
    return TdbcTransaction.runInTransactionOrConn(this.conn, async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      const revisionRepo = new SqliteVfsRevisionRepository(tx);
      return WriteWithRevision.write(entryRepo, revisionRepo, scopeKey, path, content);
    });
  }

  async replace(scopeKey: string, path: string, oldString: string, newString: string, options?: { replaceAll?: boolean }): Promise<Result<{ version: number; replacements: number }, AppError>> {
    const current = await this.read(scopeKey, path);
    if (!current.ok) return Result.err(current.error);
    const computed = ReplaceResult.compute(path, current.value.content, oldString, newString, options);
    if (!computed.ok) return Result.err(computed.error);
    const { nextContent, replacements } = computed.value;

    const written = await this.write(scopeKey, path, nextContent);
    if (!written.ok) return Result.err(written.error);
    return Result.ok({ version: written.value.version, replacements });
  }

  glob(scopeKey: string, pattern: string, options?: { cwd?: string }): Promise<string[]> {
    return this.inner.glob(scopeKey, pattern, options);
  }

  grep(scopeKey: string, pattern: string, options?: VfsGrepOptions): Promise<Result<VfsGrepMatch[], AppError>> {
    return this.inner.grep(scopeKey, pattern, options);
  }

  async delete(scopeKey: string, path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    if (normalized === "/") {
      return Result.err(new AppError("VFS_INVALID_PATH", { path, reason: "cannot delete root", detail: `Invalid path ${path}: cannot delete root` }));
    }

    // 事务回调内仍按「失败靠抛错回滚」抛；到本方法边界把**域失败**收进 Err——
    // 签名承诺 Result，调用方按 `!r.ok` 容忍 VFS_NOT_FOUND（四期迁移时实现侧
    // 漏改，裸 throw 会让 revive/restore 的容忍分支失效，RB4b 暴露）。
    // DIRECTORY_NOT_EMPTY 同为已知域失败（rmdir 非空目录），一并收 Err：
    // 域错误都按「已知的走返回值」处置，未识别的（非 AppError）保持 throw。
    try {
      await TdbcTransaction.runInTransactionOrConn(this.conn, async (tx) => {
        const entryRepo = new SqliteVfsEntryRepository(tx);
        const revisionRepo = new SqliteVfsRevisionRepository(tx);
        const recursive = options?.recursive === true;
        // 本回调内的 repo 解包走 unwrapOrRollback（事务回调，总纲 §五例外 2）：失败靠抛错回滚。
        const entry = TdbcTransaction.unwrapOrRollback(await entryRepo.findByPath(scopeKey, normalized));
        if (entry == null) {
          if (!recursive) {
            throw new AppError("VFS_NOT_FOUND", { path: normalized, detail: `Path not found: ${normalized}` });
          }
          // WHY: Worktree 可从子文件推断目录，但 vfs_entry 未必有 directory 行。
          const under = await entryRepo.listEntriesUnderPrefix(scopeKey, normalized);
          if (under.length === 0) {
            return;
          }
          await appendDeletedRevisionsForSubtree(entryRepo, revisionRepo, scopeKey, normalized);
          TdbcTransaction.unwrapOrRollback(await entryRepo.delete(scopeKey, normalized, { recursive: true }));
          return;
        }
        if (entry.entryKind === "file") {
          // 墓碑 revision：WriteWithRevision.nextVersionFor 避开 checkpoint 钉住的占号版本；append 后 +1、旧 head −1。
          const deletedVersion = await WriteWithRevision.nextVersionFor(revisionRepo, entry.entryId, entry.version);
          await revisionRepo.append({ entryId: entry.entryId, version: deletedVersion, content: null, status: "deleted", mtimeMs: Date.now() });
          await RevisionRefCount.adjust(revisionRepo, entry.entryId, deletedVersion, +1);
          await RevisionRefCount.adjust(revisionRepo, entry.entryId, entry.version, -1);
          TdbcTransaction.unwrapOrRollback(await entryRepo.delete(scopeKey, normalized, { recursive: false }));
          return;
        }
        if (recursive) {
          await appendDeletedRevisionsForSubtree(entryRepo, revisionRepo, scopeKey, normalized);
          TdbcTransaction.unwrapOrRollback(await entryRepo.delete(scopeKey, normalized, { recursive: true }));
          return;
        }
        TdbcTransaction.unwrapOrRollback(await entryRepo.delete(scopeKey, normalized, { recursive: false }));
      });
    } catch (cause) {
      const domain = unwrapTxDomainError(cause);
      if (domain != null) return Result.err(domain);
      throw cause;
    }
    return Result.ok(undefined);
  }

  async resetHeadToVersion(scopeKey: string, path: string, version: number): Promise<Result<void, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    // 事务回调内仍按「失败靠抛错回滚」抛；到本方法边界把**域失败**收进 Err——
    // 签名承诺 Result，restore 链（restore-path / restore-mutating-path-heads）按
    // `!reset.ok` 消费并把失败并进聚合（与 delete/hardDelete 的 RB4b 边界转码同款：
    // 裸 throw 会穿透 restore 的 Result 聚合）。
    try {
      await TdbcTransaction.runInTransactionOrConn(this.conn, async (tx) => {
        const entryRepo = new SqliteVfsEntryRepository(tx);
        const revisionRepo = new SqliteVfsRevisionRepository(tx);
        const contentStore = new SqliteVfsContentStore(tx);

        // 本回调内的 repo 解包走 unwrapOrRollback（事务回调，总纲 §五例外 2）：失败靠抛错回滚。
        const existing = TdbcTransaction.unwrapOrRollback(await entryRepo.findByPath(scopeKey, normalized));
        // entry 缺失（已被 hardDelete 且 revision 无 entry 可挂）时直接抛 NOT_FOUND。
        if (existing == null) {
          throw new AppError("VFS_NOT_FOUND", { path: normalized, detail: `cannot resetHeadToVersion: entry missing for ${normalized}` });
        }
        const entryId = existing.entryId;

        const rev = TdbcTransaction.unwrapOrRollback(await revisionRepo.findByEntryAndVersion(entryId, version));
        if (rev == null || rev.status === "deleted") {
          throw new AppError("VFS_NOT_FOUND", { path: normalized, detail: `cannot resetHeadToVersion: revision missing or deleted for ${normalized}@${version}` });
        }
        if (rev.content == null) {
          throw new AppError("VFS_NOT_FOUND", { path: normalized, detail: `cannot resetHeadToVersion: active revision has no content for ${normalized}@${version}` });
        }

        // put 幂等：复用既有 blob，拿到与 revision 行一致的 content_hash
        const contentHash = await contentStore.put(rev.content);
        TdbcTransaction.unwrapOrRollback(await ParentDirs.ensure(entryRepo, scopeKey, normalized));
        const oldVersion = existing.entryKind === "file" ? existing.version : null;
        TdbcTransaction.unwrapOrRollback(await entryRepo.setHeadContentHash(scopeKey, normalized, { version: rev.version, contentHash, mtimeMs: rev.mtimeMs }));
        if (oldVersion != null && oldVersion !== rev.version) {
          await RevisionRefCount.transferLive(revisionRepo, entryId, oldVersion, rev.version);
        } else if (oldVersion == null) {
          await RevisionRefCount.adjust(revisionRepo, entryId, rev.version, +1);
        }
      });
    } catch (cause) {
      const domain = unwrapTxDomainError(cause);
      if (domain != null && domain.key === "VFS_NOT_FOUND") return Result.err(domain);
      throw cause;
    }
    return Result.ok(undefined);
  }

  async hardDelete(scopeKey: string, path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    if (normalized === "/") {
      return Result.err(new AppError("VFS_INVALID_PATH", { path, reason: "cannot hardDelete root", detail: `Invalid path ${path}: cannot hardDelete root` }));
    }

    // 事务回调内仍按「失败靠抛错回滚」抛；到本方法边界把**域失败**收进 Err——
    // 签名承诺 Result，restore 的容忍分支按 `wiped.error.key === "VFS_NOT_FOUND"`
    // 容忍目标不存在（与上方 delete 的 RB4b 修复同款：四期迁移时实现侧漏改，
    // 裸 throw 会穿透调用方的容忍分支）。
    try {
      await TdbcTransaction.runInTransactionOrConn(this.conn, async (tx) => {
        const entryRepo = new SqliteVfsEntryRepository(tx);
        const revisionRepo = new SqliteVfsRevisionRepository(tx);
        // 本回调内的 repo 解包走 unwrapOrRollback（事务回调，总纲 §五例外 2）：失败靠抛错回滚。
        if (options?.recursive === true) {
          // B-1 修复保留：recursive hardDelete 仍要先 RevisionRefCount.adjust 释放 live head。
          const heads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, normalized);
          for (const head of heads) {
            await RevisionRefCount.adjust(revisionRepo, head.entryId, head.headVersion, -1);
          }
          // 删 entry 前先 sweep ref_count<=0 的 revision（此时 entry 仍在可 JOIN）
          await RevisionRefCount.deleteUnreferencedUnderScope(revisionRepo, scopeKey, normalized);
        } else {
          const entry = TdbcTransaction.unwrapOrRollback(await entryRepo.findByPath(scopeKey, normalized));
          if (entry != null && entry.entryKind === "file") {
            await RevisionRefCount.adjust(revisionRepo, entry.entryId, entry.version, -1);
            // 删 entry 前先 sweep ref_count<=0 的 revision（此时 entry 仍在可 JOIN）
            await RevisionRefCount.deleteUnreferencedUnderScope(revisionRepo, scopeKey, normalized);
          }
        }
        // 物理删 entry，故意不走 deleteWithRevision（禁止注水墓碑）
        TdbcTransaction.unwrapOrRollback(await entryRepo.delete(scopeKey, normalized, { recursive: options?.recursive === true }));
      });
    } catch (cause) {
      const domain = unwrapTxDomainError(cause);
      if (domain != null && domain.key === "VFS_NOT_FOUND") return Result.err(domain);
      throw cause;
    }
    return Result.ok(undefined);
  }

  async renamePath(scopeKey: string, fromLogical: string, toLogical: string, _options?: { overwrite?: boolean }): Promise<Result<void, AppError>> {
    const resolvedFrom = PathNormalizer.normalize(fromLogical);
    if (!resolvedFrom.ok) return Result.err(resolvedFrom.error);
    const normalizedFrom = resolvedFrom.value;
    const resolvedTo = PathNormalizer.normalize(toLogical);
    if (!resolvedTo.ok) return Result.err(resolvedTo.error);
    const normalizedTo = resolvedTo.value;
    const nameCheck = EntryNameValidator.assertValid(normalizedTo);
    if (!nameCheck.ok) return nameCheck;
    // 事务回调内失败靠抛错回滚（缺源路径由 repo 通道抛 VFS_NOT_FOUND）；到方法
    // 边界把域失败收进 Err（vfs-move / skills 的 rename 失败按 Result 消费，
    // 裸 throw 会穿透它们的 Result 通道）。
    try {
      await TdbcTransaction.runInTransactionOrConn(this.conn, async (tx) => {
        const entryRepo = new SqliteVfsEntryRepository(tx);
        await VfsRenamePrimitive.renameEntry(tx, entryRepo, scopeKey, normalizedFrom, normalizedTo);
      });
    } catch (cause) {
      const domain = unwrapTxDomainError(cause);
      if (domain != null && domain.key === "VFS_NOT_FOUND") return Result.err(domain);
      throw cause;
    }
    return Result.ok(undefined);
  }

  async renamePrefix(scopeKey: string, oldDirLogical: string, newDirLogical: string): Promise<Result<void, AppError>> {
    const resolvedOld = PathNormalizer.normalize(oldDirLogical);
    if (!resolvedOld.ok) return Result.err(resolvedOld.error);
    const normalizedOld = resolvedOld.value;
    const resolvedNew = PathNormalizer.normalize(newDirLogical);
    if (!resolvedNew.ok) return Result.err(resolvedNew.error);
    const normalizedNew = resolvedNew.value;
    const nameCheck = EntryNameValidator.assertValid(normalizedNew);
    if (!nameCheck.ok) return nameCheck;
    // 事务回调内失败靠抛错回滚（幽灵目录由 repo 抛 VFS_NOT_FOUND）；到方法边界
    // 把域失败收进 Err（同 renamePath：调用方按 Result 消费失败）。
    try {
      await TdbcTransaction.runInTransactionOrConn(this.conn, async (tx) => {
        const entryRepo = new SqliteVfsEntryRepository(tx);
        await VfsRenamePrimitive.renameDirectory(tx, entryRepo, scopeKey, normalizedOld, normalizedNew);
      });
    } catch (cause) {
      const domain = unwrapTxDomainError(cause);
      if (domain != null && domain.key === "VFS_NOT_FOUND") return Result.err(domain);
      throw cause;
    }
    return Result.ok(undefined);
  }
}

/**
 * 给子树里每个 live file head 追加一条 deleted revision（墓碑），并同步调整 ref_count。
 *
 * 实现走批量：先 {@link VfsEntryRepository.listFileHeadsUnderPrefix} 一次查出前缀下所有
 * live file head 的 `(entryId, headVersion)`，再用 `findMaxVersionsForEntries` 一次取齐
 * 各 entry 的 MAX(version)（逐 entry 计算 `max(headVersion, MAX) + 1`，避免 N+1），然后用
 * `batchAdjustRefCount` 一次性 −1 旧 head、`batchAppendWithRefCount` 一次性落 deleted 行。
 * 这样把原来「逐文件 findByPath + RevisionRefCount.adjust + append + RevisionRefCount.adjust」的 3N 次 SQL 压成
 * 4 条（分块 100，100 文件以内各一条）。
 *
 * 注意 deleted 行的 ref_count 直接以 `refCount=1` 落库——`batchAppendWithRefCount` 是
 * `INSERT ... ref_count = ?`，等价于「逐条 append(ref_count=0) + RevisionRefCount.adjust(+1)」，
 * 所以不再额外发一轮 `batchAdjustRefCount +1`（语义完全一致，SQL 更少）。
 */
async function appendDeletedRevisionsForSubtree(entryRepo: VfsEntryRepository, revisionRepo: VfsRevisionRepository, scopeKey: string, path: string): Promise<void> {
  // listFileHeadsUnderPrefix 只返回 file head（目录自身不在内），保险起见仍过滤掉 path 命中。
  const heads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, path);
  const liveHeads = heads.filter((h) => h.path !== path);
  if (liveHeads.length === 0) {
    return;
  }

  // 批量取齐各 entry 的 MAX(version)，逐 entry 按 max(head, MAX) + 1 发墓碑号，
  // 避开 head 回拨后被 checkpoint 钉住的占号版本。
  const maxVersionMap = await revisionRepo.findMaxVersionsForEntries(liveHeads.map((h) => h.entryId));

  const oldPointers = liveHeads.map((h) => ({
    entryId: h.entryId,
    version: h.headVersion,
  }));
  await revisionRepo.batchAdjustRefCount(oldPointers, -1);

  const mtimeMs = Date.now();
  const deletedRows = liveHeads.map((h) => ({
    entryId: h.entryId,
    version: Math.max(h.headVersion, maxVersionMap.get(h.entryId) ?? 0) + 1,
    contentHash: null,
    status: "deleted",
    mtimeMs,
    refCount: 1,
  }));
  await revisionRepo.batchAppendWithRefCount(deletedRows);
}
