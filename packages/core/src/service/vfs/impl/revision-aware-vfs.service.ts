/**
 * VFS service wrapper that appends vfs_revision rows on file write/delete.
 *
 * entry_id 化后实现 {@link InternalVfsService}（scopeKey + 纯逻辑路径）。每次
 * write/delete/resetHead/hardDelete/replace 先按 `(scopeKey, path)` 取出 entry_id，
 * 再交给 revision repo 的 entry_id 寻址方法。`runInTransactionOrConn` 事务模型不变；
 * `renamePath` / `renamePrefix` 本节点抛 unsupported（Step 7 接通原语）。
 *
 * @module service/vfs/impl/revision-aware-vfs.service
 */

import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { buildReplaceNotFoundError } from "@/domain/vfs/logic/compute-replace-not-found-error.js";
import {
  adjustRef,
  transferLiveRef,
} from "@/domain/vfs/logic/revision-ref-count.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import {
  VfsError,
  vfsConflict,
  vfsInvalidPath,
  vfsIsDirectory,
  vfsNotFound,
} from "@/errors/vfs-errors.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { TdbcError } from "@/infra/tdbc/index.js";
import type {
  VfsGrepMatch,
  VfsGrepOptions,
  VfsListEntry,
  VfsReadResult,
  WriteOptions,
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
    private readonly inner: InternalVfsService,
  ) {}

  list(
    scopeKey: string,
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number },
  ): Promise<VfsListEntry[]> {
    return this.inner.list(scopeKey, dir, options);
  }

  mkdir(scopeKey: string, path: string): Promise<void> {
    return this.inner.mkdir(scopeKey, path);
  }

  read(scopeKey: string, path: string): Promise<VfsReadResult> {
    return this.inner.read(scopeKey, path);
  }

  async write(
    scopeKey: string,
    path: string,
    content: string,
    options?: WriteOptions,
  ): Promise<{ version: number }> {
    return runInTransactionOrConn(this.conn, async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      const revisionRepo = new SqliteVfsRevisionRepository(tx);
      return writeWithRevision(
        entryRepo,
        revisionRepo,
        scopeKey,
        path,
        content,
        options,
      );
    });
  }

  async replace(
    scopeKey: string,
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean },
  ): Promise<{ version: number; replacements: number }> {
    const current = await this.read(scopeKey, path);
    let replacements = 0;
    let nextContent = current.content;

    if (options?.replaceAll) {
      if (!current.content.includes(oldString)) {
        throw buildReplaceNotFoundError(path, current.content, oldString);
      }
      const parts = current.content.split(oldString);
      replacements = parts.length - 1;
      nextContent = parts.join(newString);
    } else {
      const index = current.content.indexOf(oldString);
      if (index === -1) {
        throw buildReplaceNotFoundError(path, current.content, oldString);
      }
      replacements = 1;
      nextContent =
        current.content.slice(0, index) +
        newString +
        current.content.slice(index + oldString.length);
    }

    const result = await this.write(scopeKey, path, nextContent, {
      expectedVersion: current.version,
      versionCheck: true,
    });
    return { version: result.version, replacements };
  }

  glob(
    scopeKey: string,
    pattern: string,
    options?: { cwd?: string },
  ): Promise<string[]> {
    return this.inner.glob(scopeKey, pattern, options);
  }

  grep(
    scopeKey: string,
    pattern: string,
    options?: VfsGrepOptions,
  ): Promise<VfsGrepMatch[]> {
    return this.inner.grep(scopeKey, pattern, options);
  }

  async delete(
    scopeKey: string,
    path: string,
    options?: { recursive?: boolean },
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
        options?.recursive === true,
      );
    });
  }

  async resetHeadToVersion(
    scopeKey: string,
    path: string,
    version: number,
  ): Promise<void> {
    const normalized = normalizePath(path);
    await runInTransactionOrConn(this.conn, async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      const revisionRepo = new SqliteVfsRevisionRepository(tx);
      const contentStore = new SqliteVfsContentStore(tx);

      // entry_id 已知时直接寻址；entry 暂缺时先按 path 探测。
      let entryId: number | null = null;
      const existing = await entryRepo.findByPath(scopeKey, normalized);
      if (existing != null) {
        entryId = existing.entryId;
      }
      if (entryId == null) {
        // 历史可能仍存（entry 被删但 revision 保留）。按 path 反查一次 max version 探活。
        // entry_id 通道下若 entry 与 revision 都无，无法定位 → 报错。
        throw new VfsError(
          "NOT_FOUND",
          `cannot resetHeadToVersion: entry missing for ${normalized}`,
          { path: normalized },
        );
      }

      const rev = await revisionRepo.findByEntryAndVersion(entryId, version);
      if (rev == null || rev.status === "deleted") {
        throw new VfsError(
          "NOT_FOUND",
          `cannot resetHeadToVersion: revision missing or deleted for ${normalized}@${version}`,
          { path: normalized },
        );
      }
      if (rev.content == null) {
        throw new VfsError(
          "NOT_FOUND",
          `cannot resetHeadToVersion: active revision has no content for ${normalized}@${version}`,
          { path: normalized },
        );
      }

      // put 幂等：复用既有 blob，拿到与 revision 行一致的 content_hash
      const contentHash = await contentStore.put(rev.content);
      await ensureParentDirectories(entryRepo, scopeKey, normalized);
      const oldVersion = existing?.entryKind === "file" ? existing.version : null;
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
    options?: { recursive?: boolean },
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
        const heads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, normalized);
        for (const head of heads) {
          await adjustRef(revisionRepo, head.entryId, head.headVersion, -1);
        }
      } else {
        const entry = await entryRepo.findByPath(scopeKey, normalized);
        if (entry != null && entry.entryKind === "file") {
          await adjustRef(revisionRepo, entry.entryId, entry.version, -1);
        }
      }
      // 物理删 entry，故意不走 deleteWithRevision（禁止注水墓碑）
      await entryRepo.delete(scopeKey, normalized, {
        recursive: options?.recursive === true,
      });
    });
  }

  renamePath(
    _scopeKey: string,
    fromLogical: string,
    _toLogical: string,
    _options?: { overwrite?: boolean },
  ): Promise<void> {
    // Step 7 才接通 rename 原语；本节点显式抛错，避免 silent no-op。
    throw new Error(
      `renamePath is unsupported in this wiring: ${fromLogical}`,
    );
  }

  renamePrefix(
    _scopeKey: string,
    oldDirLogical: string,
    _newDirLogical: string,
  ): Promise<void> {
    throw new Error(
      `renamePrefix is unsupported in this wiring: ${oldDirLogical}`,
    );
  }
}

/**
 * Opens a transaction when none is active; reuses `conn` when already in one.
 */
async function runInTransactionOrConn<T>(
  conn: TdbcConnection,
  fn: (tx: TdbcConnection) => Promise<T>,
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

async function writeWithRevision(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  path: string,
  content: string,
  options?: WriteOptions,
): Promise<{ version: number }> {
  const normalized = normalizePath(path);
  const existing = await entryRepo.findByPath(scopeKey, normalized);
  if (existing?.entryKind === "directory") {
    throw vfsIsDirectory(normalized);
  }

  const mtimeMs = Date.now();
  let version: number;

  if (existing == null) {
    await ensureParentDirectories(entryRepo, scopeKey, normalized);
    const maxRevision = await resolveMaxRevision(entryRepo, revisionRepo, scopeKey, normalized);
    if (maxRevision != null) {
      // Boundary: vfs_entry removed but revision history retained (e.g. batch rollback restore).
      version = maxRevision + 1;
      await entryRepo.insertAtVersion(scopeKey, normalized, content, version);
    } else {
      const inserted = await entryRepo.insert(scopeKey, normalized, content);
      version = inserted.version;
    }
    const entry = await entryRepo.findByPath(scopeKey, normalized);
    const entryId = entry!.entryId;
    await revisionRepo.append({
      entryId,
      version,
      content,
      status: "active",
      mtimeMs,
    });
    await adjustRef(revisionRepo, entryId, version, +1);
    return { version };
  }

  const versionCheck = options?.versionCheck !== false;
  if (versionCheck && options?.expectedVersion == null) {
    throw new VfsError(
      "CONFLICT",
      `expectedVersion required when updating ${normalized}`,
      { path: normalized },
    );
  }

  // 乐观锁优先：过期仍 CONFLICT，同文短路不得绕过
  if (
    versionCheck &&
    options?.expectedVersion != null &&
    options.expectedVersion !== existing.version
  ) {
    throw vfsConflict(
      normalized,
      options.expectedVersion,
      existing.version,
    );
  }

  // 同文短路：相对 live 明文全等 → 不 bump、不 append
  if (existing.content === content) {
    return { version: existing.version };
  }

  const updated = await entryRepo.update(scopeKey, normalized, content, {
    expectedVersion: options?.expectedVersion,
    versionCheck,
  });
  version = updated.version;
  await revisionRepo.append({
    entryId: existing.entryId,
    version,
    content,
    status: "active",
    mtimeMs,
  });
  await transferLiveRef(revisionRepo, existing.entryId, existing.version, version);
  return { version };
}

/**
 * entry_id 通道下，max revision 需要先知道 entry_id；entry 不存在时返回 null
 * （revision repo 无法凭空定位）。这覆盖了「entry 已删但 revision 仍在」的边界场景：
 * 此时 entry 重建后 revision 历史已不可凭 path 直接定位，writeWithRevision 走 insert v1。
 */
async function resolveMaxRevision(
  _entryRepo: VfsEntryRepository,
  _revisionRepo: VfsRevisionRepository,
  _scopeKey: string,
  _path: string,
): Promise<number | null> {
  // entry 不存在时拿不到 entry_id；保留 null 让上层按全新文件 v1 插入。
  // （历史 revision 仍按 entry_id 留存，后续 resetHead 可经新 entry_id 重建链路补接。）
  return null;
}

async function appendDeletedRevisionsForSubtree(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  path: string,
): Promise<void> {
  const files = await entryRepo.scanContents(scopeKey, path);
  for (const file of files) {
    if (file.path === path) {
      continue;
    }
    const fileEntry = await entryRepo.findByPath(scopeKey, file.path);
    if (fileEntry == null || fileEntry.entryKind !== "file") {
      continue;
    }
    await adjustRef(revisionRepo, fileEntry.entryId, fileEntry.version, -1);
    await appendDeletedRevision(
      revisionRepo,
      fileEntry.entryId,
      fileEntry.version,
    );
  }
}

async function deleteWithRevision(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  path: string,
  recursive: boolean,
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
    await appendDeletedRevisionsForSubtree(entryRepo, revisionRepo, scopeKey, path);
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
    await appendDeletedRevisionsForSubtree(entryRepo, revisionRepo, scopeKey, path);
    await entryRepo.delete(scopeKey, path, { recursive: true });
    return;
  }

  await entryRepo.delete(scopeKey, path, { recursive: false });
}

async function appendDeletedRevision(
  revisionRepo: VfsRevisionRepository,
  entryId: number,
  currentHeadVersion: number,
): Promise<void> {
  const deletedVersion = currentHeadVersion + 1;
  await revisionRepo.append({
    entryId,
    version: deletedVersion,
    content: null,
    status: "deleted",
    mtimeMs: Date.now(),
  });
  await adjustRef(revisionRepo, entryId, deletedVersion, +1);
}
