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

import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import { assertValidVfsEntryName } from "@/domain/vfs/logic/validate-entry-name.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { computeReplaceResult } from "@/domain/vfs/logic/compute-replace-result.js";
import {
  adjustRef,
  transferLiveRef,
  deleteUnreferencedUnderScope,
} from "@/domain/vfs/logic/revision-ref-count.js";
import {
  renameVfsEntry,
  renameVfsDirectory,
} from "@/domain/vfs/logic/vfs-rename-primitive.js";
// WHY 反向 import：writeWithRevision / nextVersionFor / resolveMaxRevision 已下沉到
// domain 层（批量 ingest 复用同一条写路径，见 domain/vfs/logic/write-with-revision.ts），
// 本文件的删除路径（appendDeletedRevision → nextVersionFor）必须跟着引用共享实现。
import {
  nextVersionFor,
  writeWithRevision,
} from "@/domain/vfs/logic/write-with-revision.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import {
  VfsError,
  vfsInvalidPath,
  vfsNotFound,
} from "@/errors/vfs-errors.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { TdbcError } from "@/infra/tdbc/index.js";
import type {
  VfsGrepMatch,
  VfsGrepOptions,
  VfsListEntry,
  VfsReadResult,
  VfsContentSize,
} from "../internal-vfs.port.js";
import type { InternalVfsService } from "../internal-vfs.port.js";

/**
 * Decorates an inner {@link InternalVfsService} so file mutations append revision history.
 *
 * @remarks Directory mkdir/delete bypass revision storage (checkpoint captures files only).
 */
export class RevisionAwareVfsService implements InternalVfsService {
  constructor(
    private readonly conn: TdbcConnection,
    private readonly inner: InternalVfsService
  ) {}

  list(
    scopeKey: string,
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number }
  ): Promise<VfsListEntry[]> {
    return this.inner.list(scopeKey, dir, options);
  }

  mkdir(scopeKey: string, path: string): Promise<void> {
    return this.inner.mkdir(scopeKey, path);
  }

  read(scopeKey: string, path: string): Promise<VfsReadResult> {
    return this.inner.read(scopeKey, path);
  }

  findContentSize(
    scopeKey: string,
    path: string
  ): Promise<VfsContentSize | null> {
    return this.inner.findContentSize(scopeKey, path);
  }

  async write(
    scopeKey: string,
    path: string,
    content: string
  ): Promise<{ version: number }> {
    return runInTransactionOrConn(this.conn, async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      const revisionRepo = new SqliteVfsRevisionRepository(tx);
      return writeWithRevision(
        entryRepo,
        revisionRepo,
        scopeKey,
        path,
        content
      );
    });
  }

  async replace(
    scopeKey: string,
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean }
  ): Promise<{ version: number; replacements: number }> {
    const current = await this.read(scopeKey, path);
    const { nextContent, replacements } = computeReplaceResult(
      path,
      current.content,
      oldString,
      newString,
      options
    );

    const result = await this.write(scopeKey, path, nextContent);
    return { version: result.version, replacements };
  }

  glob(
    scopeKey: string,
    pattern: string,
    options?: { cwd?: string }
  ): Promise<string[]> {
    return this.inner.glob(scopeKey, pattern, options);
  }

  grep(
    scopeKey: string,
    pattern: string,
    options?: VfsGrepOptions
  ): Promise<VfsGrepMatch[]> {
    return this.inner.grep(scopeKey, pattern, options);
  }

  async delete(
    scopeKey: string,
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    const normalized = normalizePath(path);
    if (normalized === "/") {
      throw vfsInvalidPath(path, "cannot delete root");
    }

    await runInTransactionOrConn(this.conn, async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      const revisionRepo = new SqliteVfsRevisionRepository(tx);
      await deleteWithRevision(
        entryRepo,
        revisionRepo,
        scopeKey,
        normalized,
        options?.recursive === true
      );
    });
  }

  async resetHeadToVersion(
    scopeKey: string,
    path: string,
    version: number
  ): Promise<void> {
    const normalized = normalizePath(path);
    await runInTransactionOrConn(this.conn, async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      const revisionRepo = new SqliteVfsRevisionRepository(tx);
      const contentStore = new SqliteVfsContentStore(tx);

      // entry 缺失（已被 hardDelete 且 revision 无 entry 可挂）时直接抛 NOT_FOUND。
      const existing = await entryRepo.findByPath(scopeKey, normalized);
      if (existing == null) {
        throw new VfsError(
          "NOT_FOUND",
          `cannot resetHeadToVersion: entry missing for ${normalized}`,
          { path: normalized }
        );
      }
      const entryId = existing.entryId;

      const rev = await revisionRepo.findByEntryAndVersion(entryId, version);
      if (rev == null || rev.status === "deleted") {
        throw new VfsError(
          "NOT_FOUND",
          `cannot resetHeadToVersion: revision missing or deleted for ${normalized}@${version}`,
          { path: normalized }
        );
      }
      if (rev.content == null) {
        throw new VfsError(
          "NOT_FOUND",
          `cannot resetHeadToVersion: active revision has no content for ${normalized}@${version}`,
          { path: normalized }
        );
      }

      // put 幂等：复用既有 blob，拿到与 revision 行一致的 content_hash
      const contentHash = await contentStore.put(rev.content);
      await ensureParentDirectories(entryRepo, scopeKey, normalized);
      const oldVersion =
        existing?.entryKind === "file" ? existing.version : null;
      await entryRepo.setHeadContentHash(scopeKey, normalized, {
        version: rev.version,
        contentHash,
        mtimeMs: rev.mtimeMs,
      });
      if (oldVersion != null && oldVersion !== rev.version) {
        await transferLiveRef(revisionRepo, entryId, oldVersion, rev.version);
      } else if (oldVersion == null) {
        await adjustRef(revisionRepo, entryId, rev.version, +1);
      }
    });
  }

  async hardDelete(
    scopeKey: string,
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    const normalized = normalizePath(path);
    if (normalized === "/") {
      throw vfsInvalidPath(path, "cannot hardDelete root");
    }

    await runInTransactionOrConn(this.conn, async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      const revisionRepo = new SqliteVfsRevisionRepository(tx);
      if (options?.recursive === true) {
        // B-1 修复保留：recursive hardDelete 仍要先 adjustRef 释放 live head。
        const heads = await entryRepo.listFileHeadsUnderPrefix(
          scopeKey,
          normalized
        );
        for (const head of heads) {
          await adjustRef(revisionRepo, head.entryId, head.headVersion, -1);
        }
        // 删 entry 前先 sweep ref_count<=0 的 revision（此时 entry 仍在可 JOIN）
        await deleteUnreferencedUnderScope(revisionRepo, scopeKey, normalized);
      } else {
        const entry = await entryRepo.findByPath(scopeKey, normalized);
        if (entry != null && entry.entryKind === "file") {
          await adjustRef(revisionRepo, entry.entryId, entry.version, -1);
          // 删 entry 前先 sweep ref_count<=0 的 revision（此时 entry 仍在可 JOIN）
          await deleteUnreferencedUnderScope(
            revisionRepo,
            scopeKey,
            normalized
          );
        }
      }
      // 物理删 entry，故意不走 deleteWithRevision（禁止注水墓碑）
      await entryRepo.delete(scopeKey, normalized, {
        recursive: options?.recursive === true,
      });
    });
  }

  async renamePath(
    scopeKey: string,
    fromLogical: string,
    toLogical: string,
    _options?: { overwrite?: boolean }
  ): Promise<void> {
    const normalizedFrom = normalizePath(fromLogical);
    const normalizedTo = normalizePath(toLogical);
    assertValidVfsEntryName(normalizedTo);
    return runInTransactionOrConn(this.conn, async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      await renameVfsEntry(
        tx,
        entryRepo,
        scopeKey,
        normalizedFrom,
        normalizedTo
      );
    });
  }

  async renamePrefix(
    scopeKey: string,
    oldDirLogical: string,
    newDirLogical: string
  ): Promise<void> {
    const normalizedOld = normalizePath(oldDirLogical);
    const normalizedNew = normalizePath(newDirLogical);
    assertValidVfsEntryName(normalizedNew);
    return runInTransactionOrConn(this.conn, async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      await renameVfsDirectory(
        tx,
        entryRepo,
        scopeKey,
        normalizedOld,
        normalizedNew
      );
    });
  }
}

/**
 * Opens a transaction when none is active; reuses `conn` when already in one.
 */
async function runInTransactionOrConn<T>(
  conn: TdbcConnection,
  fn: (tx: TdbcConnection) => Promise<T>
): Promise<T> {
  try {
    return await conn.transaction(fn);
  } catch (error) {
    // Boundary: session-fs execute already holds an outer transaction.
    if (error instanceof TdbcError && error.code === "NESTED_TRANSACTION") {
      return fn(conn);
    }
    throw error;
  }
}

/**
 * 给子树里每个 live file head 追加一条 deleted revision（墓碑），并同步调整 ref_count。
 *
 * 实现走批量：先 {@link VfsEntryRepository.listFileHeadsUnderPrefix} 一次查出前缀下所有
 * live file head 的 `(entryId, headVersion)`，再用 `findMaxVersionsForEntries` 一次取齐
 * 各 entry 的 MAX(version)（逐 entry 计算 `max(headVersion, MAX) + 1`，避免 N+1），然后用
 * `batchAdjustRefCount` 一次性 −1 旧 head、`batchAppendWithRefCount` 一次性落 deleted 行。
 * 这样把原来「逐文件 findByPath + adjustRef + append + adjustRef」的 3N 次 SQL 压成
 * 4 条（分块 100，100 文件以内各一条）。
 *
 * 注意 deleted 行的 ref_count 直接以 `refCount=1` 落库——`batchAppendWithRefCount` 是
 * `INSERT ... ref_count = ?`，等价于「逐条 append(ref_count=0) + adjustRef(+1)」，
 * 所以不再额外发一轮 `batchAdjustRefCount +1`（语义完全一致，SQL 更少）。
 */
async function appendDeletedRevisionsForSubtree(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  path: string
): Promise<void> {
  // listFileHeadsUnderPrefix 只返回 file head（目录自身不在内），保险起见仍过滤掉 path 命中。
  const heads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, path);
  const liveHeads = heads.filter((h) => h.path !== path);
  if (liveHeads.length === 0) {
    return;
  }

  // 批量取齐各 entry 的 MAX(version)，逐 entry 按 max(head, MAX) + 1 发墓碑号，
  // 避开 head 回拨后被 checkpoint 钉住的占号版本。
  const maxVersionMap = await revisionRepo.findMaxVersionsForEntries(
    liveHeads.map((h) => h.entryId)
  );

  const oldPointers = liveHeads.map((h) => ({
    entryId: h.entryId,
    version: h.headVersion,
  }));
  await revisionRepo.batchAdjustRefCount(oldPointers, -1);

  const mtimeMs = Date.now();
  await revisionRepo.batchAppendWithRefCount(
    liveHeads.map((h) => ({
      entryId: h.entryId,
      version: Math.max(h.headVersion, maxVersionMap.get(h.entryId) ?? 0) + 1,
      contentHash: null,
      status: "deleted",
      mtimeMs,
      refCount: 1,
    }))
  );
}

async function deleteWithRevision(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  path: string,
  recursive: boolean
): Promise<void> {
  const entry = await entryRepo.findByPath(scopeKey, path);
  if (entry == null) {
    if (!recursive) {
      throw vfsNotFound(path);
    }
    // WHY: Worktree 可从子文件推断目录，但 vfs_entry 未必有 directory 行。
    const under = await entryRepo.listEntriesUnderPrefix(scopeKey, path);
    if (under.length === 0) {
      return;
    }
    await appendDeletedRevisionsForSubtree(
      entryRepo,
      revisionRepo,
      scopeKey,
      path
    );
    await entryRepo.delete(scopeKey, path, { recursive: true });
    return;
  }

  if (entry.entryKind === "file") {
    await appendDeletedRevision(revisionRepo, entry.entryId, entry.version);
    await adjustRef(revisionRepo, entry.entryId, entry.version, -1);
    await entryRepo.delete(scopeKey, path, { recursive: false });
    return;
  }

  if (recursive) {
    await appendDeletedRevisionsForSubtree(
      entryRepo,
      revisionRepo,
      scopeKey,
      path
    );
    await entryRepo.delete(scopeKey, path, { recursive: true });
    return;
  }

  await entryRepo.delete(scopeKey, path, { recursive: false });
}

async function appendDeletedRevision(
  revisionRepo: VfsRevisionRepository,
  entryId: number,
  currentHeadVersion: number
): Promise<void> {
  const deletedVersion = await nextVersionFor(
    revisionRepo,
    entryId,
    currentHeadVersion
  );
  await revisionRepo.append({
    entryId,
    version: deletedVersion,
    content: null,
    status: "deleted",
    mtimeMs: Date.now(),
  });
  await adjustRef(revisionRepo, entryId, deletedVersion, +1);
}
