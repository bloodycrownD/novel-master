/**
 * SQLite implementation of {@link VfsEntryRepository} via SqlTemplateParser.
 *
 * @module domain/vfs/repositories/impl/sqlite-vfs-entry.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import {
  vfsConflict,
  vfsDirectoryNotEmpty,
  vfsNotFound,
} from "@/errors/vfs-errors.js";
import type {
  VfsEntry,
  VfsEntryKind,
  VfsStorageKind,
} from "../../model/vfs-entry.js";
import type { VfsListEntry } from "../../model/vfs-list-entry.js";
import type {
  VfsDeleteOptions,
  VfsListOptions,
  VfsWriteRepoOptions,
} from "../../model/vfs-options.js";
import type { VfsEntryRepository } from "../vfs-entry.port.js";
import { normalizePath } from "./normalize-path.js";

function rowToEntry(row: Row): VfsEntry {
  const kindRaw = row.entry_kind;
  const entryKind: VfsEntryKind =
    kindRaw === "directory" ? "directory" : "file";
  const headVersion =
    row.head_version == null ? Number(row.version) : Number(row.head_version);
  return {
    path: String(row.path),
    content: String(row.content),
    version: headVersion,
    mtimeMs: Number(row.mtime_ms),
    storageKind: String(row.storage_kind) as VfsStorageKind,
    externalUri: row.external_uri == null ? null : String(row.external_uri),
    entryKind,
  };
}

function listPrefix(dir: string): string {
  return dir === "/" ? "/%" : `${dir}/%`;
}

function relativeUnderDir(dir: string, entryPath: string): string {
  if (dir === "/") {
    return entryPath.slice(1);
  }
  return entryPath.slice(dir.length + 1);
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function normalizePrefix(prefix: string): string {
  if (prefix === "/") {
    return prefix;
  }
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

/**
 * TDBC-backed vfs_entry repository.
 */
export class SqliteVfsEntryRepository implements VfsEntryRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async list(dir: string, options?: VfsListOptions): Promise<VfsListEntry[]> {
    const normalizedDir = normalizePath(dir);
    const likePattern = listPrefix(normalizedDir);
    const rows = await queryTemplate<{ path: string; entry_kind: string }>(
      this.conn,
      this.parser,
      `SELECT path, entry_kind FROM vfs_entry WHERE path LIKE #{likePattern} ESCAPE '\\'`,
      { likePattern },
    );

    const recursive = options?.recursive === true;
    const maxDepth = options?.maxDepth;

    const entries: VfsListEntry[] = [];
    for (const row of rows) {
      const entryPath = String(row.path);
      const kind: VfsEntryKind =
        row.entry_kind === "directory" ? "directory" : "file";
      const relative = relativeUnderDir(normalizedDir, entryPath);
      if (!recursive) {
        if (!relative.includes("/")) {
          entries.push({ path: entryPath, kind });
        }
        continue;
      }

      if (maxDepth != null) {
        const depth = relative.split("/").filter(Boolean).length;
        if (depth > maxDepth) {
          continue;
        }
      }
      entries.push({ path: entryPath, kind });
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }

  async findByPath(path: string): Promise<VfsEntry | null> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT path, content, version, head_version, mtime_ms, storage_kind, external_uri, entry_kind
       FROM vfs_entry WHERE path = #{path}`,
      { path: normalized },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToEntry(rows[0]!);
  }

  async insert(path: string, content: string): Promise<{ version: number }> {
    return this.insertAtVersion(path, content, 1);
  }

  async insertAtVersion(
    path: string,
    content: string,
    version: number,
  ): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind)
       VALUES (#{path}, #{content}, #{version}, #{version}, #{mtimeMs}, 'inline', 'file')`,
      { path: normalized, content, version, mtimeMs },
    );
    return { version };
  }

  async insertDirectory(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind)
       VALUES (#{path}, '', 1, 1, #{mtimeMs}, 'inline', 'directory')`,
      { path: normalized, mtimeMs },
    );
  }

  async update(
    path: string,
    content: string,
    options: VfsWriteRepoOptions,
  ): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();

    if (options.versionCheck) {
      const expectedVersion = options.expectedVersion!;
      const result = await executeTemplate(
        this.conn,
        this.parser,
        `UPDATE vfs_entry
         SET content = #{content},
             version = head_version + 1,
             head_version = head_version + 1,
             mtime_ms = #{mtimeMs}
         WHERE path = #{path} AND head_version = #{expectedVersion} AND entry_kind = 'file'`,
        { content, mtimeMs, path: normalized, expectedVersion },
      );
      if (result.changes === 0) {
        const rows = await queryTemplate<{ head_version: number }>(
          this.conn,
          this.parser,
          `SELECT head_version FROM vfs_entry WHERE path = #{path}`,
          { path: normalized },
        );
        if (rows.length === 0) {
          throw vfsNotFound(normalized);
        }
        throw vfsConflict(
          normalized,
          expectedVersion,
          Number(rows[0]!.head_version),
        );
      }
    } else {
      const result = await executeTemplate(
        this.conn,
        this.parser,
        `UPDATE vfs_entry
         SET content = #{content},
             version = head_version + 1,
             head_version = head_version + 1,
             mtime_ms = #{mtimeMs}
         WHERE path = #{path} AND entry_kind = 'file'`,
        { content, mtimeMs, path: normalized },
      );
      if (result.changes === 0) {
        throw vfsNotFound(normalized);
      }
    }

    const rows = await queryTemplate<{ head_version: number }>(
      this.conn,
      this.parser,
      `SELECT head_version FROM vfs_entry WHERE path = #{path}`,
      { path: normalized },
    );
    return { version: Number(rows[0]!.head_version) };
  }

  async delete(path: string, options: VfsDeleteOptions): Promise<void> {
    const normalized = normalizePath(path);
    const escaped = escapeLike(normalized);

    if (!options.recursive) {
      const childRows = await queryTemplate(
        this.conn,
        this.parser,
        `SELECT 1 FROM vfs_entry WHERE path LIKE #{childPattern} ESCAPE '\\' LIMIT 1`,
        { childPattern: `${escaped}/%` },
      );
      if (childRows.length > 0) {
        throw vfsDirectoryNotEmpty(normalized);
      }

      const result = await executeTemplate(
        this.conn,
        this.parser,
        `DELETE FROM vfs_entry WHERE path = #{path}`,
        { path: normalized },
      );
      if (result.changes === 0) {
        throw vfsNotFound(normalized);
      }
      return;
    }

    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM vfs_entry WHERE path = #{path} OR path LIKE #{childPattern} ESCAPE '\\'`,
      { path: normalized, childPattern: `${escaped}/%` },
    );
    if (result.changes === 0) {
      throw vfsNotFound(normalized);
    }
  }

  async listAllPaths(): Promise<string[]> {
    const rows = await queryTemplate<{ path: string }>(
      this.conn,
      this.parser,
      `SELECT path FROM vfs_entry WHERE entry_kind = 'file' ORDER BY path`,
      {},
    );
    return rows.map((row) => String(row.path));
  }

  async listDirectoryPathsUnderPrefix(
    physicalPrefix: string,
  ): Promise<string[]> {
    const base = normalizePrefix(physicalPrefix);
    const escaped = escapeLike(base);
    const rows = await queryTemplate<{ path: string }>(
      this.conn,
      this.parser,
      `SELECT path FROM vfs_entry
       WHERE entry_kind = 'directory'
         AND (path = #{path} OR path LIKE #{childPattern} ESCAPE '\\')
       ORDER BY path`,
      { path: base, childPattern: `${escaped}/%` },
    );
    return rows.map((row) => String(row.path));
  }

  async listEntriesUnderPrefix(prefix: string): Promise<VfsListEntry[]> {
    const base = normalizePrefix(prefix);
    const escaped = escapeLike(base);
    const rows = await queryTemplate<{ path: string; entry_kind: string }>(
      this.conn,
      this.parser,
      `SELECT path, entry_kind FROM vfs_entry
       WHERE path = #{path} OR path LIKE #{childPattern} ESCAPE '\\'
       ORDER BY path`,
      { path: base, childPattern: `${escaped}/%` },
    );
    return rows.map((row) => ({
      path: String(row.path),
      kind: row.entry_kind === "directory" ? "directory" : "file",
    }));
  }

  async listFileMetaUnderPrefix(
    physicalPrefix: string,
  ): Promise<ReadonlyArray<{ path: string; mtimeMs: number }>> {
    const base = normalizePrefix(physicalPrefix);
    const escaped = escapeLike(base);
    const childPattern = base === "/" ? "/%" : `${escaped}/%`;
    const rows = await queryTemplate<{ path: string; mtime_ms: number }>(
      this.conn,
      this.parser,
      `SELECT path, mtime_ms FROM vfs_entry
       WHERE entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{childPattern} ESCAPE '\\')
       ORDER BY path`,
      { path: base, childPattern },
    );
    return rows.map((row) => ({
      path: String(row.path),
      mtimeMs: Number(row.mtime_ms),
    }));
  }

  async scanContents(
    pathPrefix?: string,
  ): Promise<
    ReadonlyArray<{
      path: string;
      content: string;
      storageKind: VfsStorageKind;
    }>
  > {
    if (pathPrefix == null) {
      const rows = await queryTemplate<{
        path: string;
        content: string;
        storage_kind: string;
      }>(
        this.conn,
        this.parser,
        `SELECT path, content, storage_kind FROM vfs_entry WHERE entry_kind = 'file'`,
        {},
      );
      return rows.map((row) => ({
        path: String(row.path),
        content: String(row.content),
        storageKind: String(row.storage_kind) as VfsStorageKind,
      }));
    }

    const normalized = normalizePath(pathPrefix);
    const escaped = escapeLike(normalized);
    const rows = await queryTemplate<{
      path: string;
      content: string;
      storage_kind: string;
    }>(
      this.conn,
      this.parser,
      `SELECT path, content, storage_kind FROM vfs_entry
       WHERE entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{childPattern} ESCAPE '\\')`,
      { path: normalized, childPattern: `${escaped}/%` },
    );
    return rows.map((row) => ({
      path: String(row.path),
      content: String(row.content),
      storageKind: String(row.storage_kind) as VfsStorageKind,
    }));
  }
}
