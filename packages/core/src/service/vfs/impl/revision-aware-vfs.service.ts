/**
 * VFS service wrapper that appends vfs_revision rows on file write/delete.
 *
 * @module service/vfs/impl/revision-aware-vfs.service
 */

import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import {
  VfsError,
  vfsInvalidPath,
  vfsIsDirectory,
  vfsNotFound,
  vfsReplaceNotFound,
} from "@/errors/vfs-errors.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { TdbcError } from "@/infra/tdbc/index.js";
import type {
  VfsGrepMatch,
  VfsListEntry,
  VfsReadResult,
  VfsService,
  WriteOptions,
} from "../vfs.port.js";

/**
 * Decorates a {@link VfsService} so file mutations append revision history.
 *
 * @remarks Directory mkdir/delete bypass revision storage (checkpoint captures files only).
 */
export class RevisionAwareVfsService implements VfsService {
  constructor(
    private readonly conn: TdbcConnection,
    private readonly inner: VfsService,
  ) {}

  list(
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number },
  ): Promise<VfsListEntry[]> {
    return this.inner.list(dir, options);
  }

  mkdir(path: string): Promise<void> {
    return this.inner.mkdir(path);
  }

  read(path: string): Promise<VfsReadResult> {
    return this.inner.read(path);
  }

  async write(
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
        path,
        content,
        options,
      );
    });
  }

  async replace(
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean },
  ): Promise<{ version: number; replacements: number }> {
    const current = await this.read(path);
    let replacements = 0;
    let nextContent = current.content;

    if (options?.replaceAll) {
      if (!current.content.includes(oldString)) {
        throw vfsReplaceNotFound(path);
      }
      const parts = current.content.split(oldString);
      replacements = parts.length - 1;
      nextContent = parts.join(newString);
    } else {
      const index = current.content.indexOf(oldString);
      if (index === -1) {
        throw vfsReplaceNotFound(path);
      }
      replacements = 1;
      nextContent =
        current.content.slice(0, index) +
        newString +
        current.content.slice(index + oldString.length);
    }

    const result = await this.write(path, nextContent, {
      expectedVersion: current.version,
      versionCheck: true,
    });
    return { version: result.version, replacements };
  }

  glob(pattern: string, options?: { cwd?: string }): Promise<string[]> {
    return this.inner.glob(pattern, options);
  }

  grep(
    pattern: string,
    options?: { pathPrefix?: string },
  ): Promise<VfsGrepMatch[]> {
    return this.inner.grep(pattern, options);
  }

  async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
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
        normalized,
        options?.recursive === true,
      );
    });
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
  path: string,
  content: string,
  options?: WriteOptions,
): Promise<{ version: number }> {
  const normalized = normalizePath(path);
  const existing = await entryRepo.findByPath(normalized);
  if (existing?.entryKind === "directory") {
    throw vfsIsDirectory(normalized);
  }

  const mtimeMs = Date.now();
  let version: number;

  if (existing == null) {
    await ensureParentDirectories(entryRepo, normalized);
    const maxRevision = await revisionRepo.findMaxVersionForPath(normalized);
    if (maxRevision != null) {
      // Boundary: vfs_entry removed but revision history retained (e.g. batch rollback restore).
      version = maxRevision + 1;
      await entryRepo.insertAtVersion(normalized, content, version);
    } else {
      const inserted = await entryRepo.insert(normalized, content);
      version = inserted.version;
    }
    await revisionRepo.append({
      path: normalized,
      version,
      content,
      status: "active",
      mtimeMs,
      storageKind: "inline",
    });
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

  const updated = await entryRepo.update(normalized, content, {
    expectedVersion: options?.expectedVersion,
    versionCheck,
  });
  version = updated.version;
  await revisionRepo.append({
    path: normalized,
    version,
    content,
    status: "active",
    mtimeMs,
    storageKind: existing.storageKind,
  });
  return { version };
}

async function deleteWithRevision(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  path: string,
  recursive: boolean,
): Promise<void> {
  const entry = await entryRepo.findByPath(path);
  if (entry == null) {
    throw vfsNotFound(path);
  }

  if (entry.entryKind === "file") {
    await appendDeletedRevision(revisionRepo, entry.path, entry.version, entry.storageKind);
    await entryRepo.delete(path, { recursive: false });
    return;
  }

  if (recursive) {
    const files = await entryRepo.scanContents(path);
    for (const file of files) {
      if (file.path === path) {
        continue;
      }
      const fileEntry = await entryRepo.findByPath(file.path);
      if (fileEntry == null || fileEntry.entryKind !== "file") {
        continue;
      }
      await appendDeletedRevision(
        revisionRepo,
        fileEntry.path,
        fileEntry.version,
        fileEntry.storageKind,
      );
    }
    await entryRepo.delete(path, { recursive: true });
    return;
  }

  await entryRepo.delete(path, { recursive: false });
}

async function appendDeletedRevision(
  revisionRepo: VfsRevisionRepository,
  path: string,
  currentHeadVersion: number,
  storageKind: "inline" | "external",
): Promise<void> {
  const deletedVersion = currentHeadVersion + 1;
  await revisionRepo.append({
    path,
    version: deletedVersion,
    content: null,
    status: "deleted",
    mtimeMs: Date.now(),
    storageKind,
  });
}
