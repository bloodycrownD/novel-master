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
import type { VfsEntry, VfsStorageKind } from "../../model/vfs-entry.js";
import type {
  VfsDeleteOptions,
  VfsListOptions,
  VfsWriteRepoOptions,
} from "../../model/vfs-options.js";
import type { VfsEntryRepository } from "../vfs-entry.port.js";
import { normalizePath } from "./normalize-path.js";

function rowToEntry(row: Row): VfsEntry {
  return {
    path: String(row.path),
    content: String(row.content),
    version: Number(row.version),
    mtimeMs: Number(row.mtime_ms),
    storageKind: String(row.storage_kind) as VfsStorageKind,
    externalUri: row.external_uri == null ? null : String(row.external_uri),
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

/**
 * TDBC-backed vfs_entry repository.
 */
export class SqliteVfsEntryRepository implements VfsEntryRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async list(dir: string, options?: VfsListOptions): Promise<string[]> {
    const normalizedDir = normalizePath(dir);
    const likePattern = listPrefix(normalizedDir);
    const rows = await queryTemplate<{ path: string }>(
      this.conn,
      this.parser,
      `SELECT path FROM vfs_entry WHERE path LIKE #{likePattern} ESCAPE '\\'`,
      { likePattern },
    );

    const recursive = options?.recursive === true;
    const maxDepth = options?.maxDepth;

    const paths: string[] = [];
    for (const row of rows) {
      const entryPath = String(row.path);
      const relative = relativeUnderDir(normalizedDir, entryPath);
      if (!recursive) {
        if (!relative.includes("/")) {
          paths.push(entryPath);
        }
        continue;
      }

      if (maxDepth != null) {
        const depth = relative.split("/").filter(Boolean).length;
        if (depth > maxDepth) {
          continue;
        }
      }
      paths.push(entryPath);
    }

    paths.sort();
    return paths;
  }

  async findByPath(path: string): Promise<VfsEntry | null> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT path, content, version, mtime_ms, storage_kind, external_uri
       FROM vfs_entry WHERE path = #{path}`,
      { path: normalized },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToEntry(rows[0]!);
  }

  async insert(path: string, content: string): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_entry (path, content, version, mtime_ms, storage_kind)
       VALUES (#{path}, #{content}, 1, #{mtimeMs}, 'inline')`,
      { path: normalized, content, mtimeMs },
    );
    return { version: 1 };
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
         SET content = #{content}, version = version + 1, mtime_ms = #{mtimeMs}
         WHERE path = #{path} AND version = #{expectedVersion}`,
        { content, mtimeMs, path: normalized, expectedVersion },
      );
      if (result.changes === 0) {
        const rows = await queryTemplate<{ version: number }>(
          this.conn,
          this.parser,
          `SELECT version FROM vfs_entry WHERE path = #{path}`,
          { path: normalized },
        );
        if (rows.length === 0) {
          throw vfsNotFound(normalized);
        }
        throw vfsConflict(
          normalized,
          expectedVersion,
          Number(rows[0]!.version),
        );
      }
    } else {
      const result = await executeTemplate(
        this.conn,
        this.parser,
        `UPDATE vfs_entry
         SET content = #{content}, version = version + 1, mtime_ms = #{mtimeMs}
         WHERE path = #{path}`,
        { content, mtimeMs, path: normalized },
      );
      if (result.changes === 0) {
        throw vfsNotFound(normalized);
      }
    }

    const rows = await queryTemplate<{ version: number }>(
      this.conn,
      this.parser,
      `SELECT version FROM vfs_entry WHERE path = #{path}`,
      { path: normalized },
    );
    return { version: Number(rows[0]!.version) };
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
      `SELECT path FROM vfs_entry ORDER BY path`,
      {},
    );
    return rows.map((row) => String(row.path));
  }

  async scanContents(
    pathPrefix?: string,
  ): Promise<ReadonlyArray<{ path: string; content: string }>> {
    if (pathPrefix == null) {
      const rows = await queryTemplate<{ path: string; content: string }>(
        this.conn,
        this.parser,
        `SELECT path, content FROM vfs_entry`,
        {},
      );
      return rows.map((row) => ({
        path: String(row.path),
        content: String(row.content),
      }));
    }

    const normalized = normalizePath(pathPrefix);
    const escaped = escapeLike(normalized);
    const rows = await queryTemplate<{ path: string; content: string }>(
      this.conn,
      this.parser,
      `SELECT path, content FROM vfs_entry
       WHERE path = #{path} OR path LIKE #{childPattern} ESCAPE '\\'`,
      { path: normalized, childPattern: `${escaped}/%` },
    );
    return rows.map((row) => ({
      path: String(row.path),
      content: String(row.content),
    }));
  }
}
