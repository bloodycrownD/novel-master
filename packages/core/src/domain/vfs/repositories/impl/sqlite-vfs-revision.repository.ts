/**
 * SQLite implementation of {@link VfsRevisionRepository}.
 *
 * @module domain/vfs/repositories/impl/sqlite-vfs-revision.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type {
  VfsRevision,
  VfsRevisionStatus,
} from "../../model/vfs-revision.js";
import type { VfsStorageKind } from "../../model/vfs-entry.js";
import type {
  VfsRevisionAppendInput,
  VfsRevisionRepository,
} from "../vfs-revision.port.js";
import { normalizePath } from "./normalize-path.js";

function rowToRevision(row: Row): VfsRevision {
  const statusRaw = String(row.status);
  const status: VfsRevisionStatus =
    statusRaw === "deleted" ? "deleted" : "active";
  return {
    path: String(row.path),
    version: Number(row.version),
    content: row.content == null ? null : String(row.content),
    status,
    mtimeMs: Number(row.mtime_ms),
    storageKind: String(row.storage_kind) as VfsStorageKind,
  };
}

/**
 * TDBC-backed vfs_revision repository (append-only inserts).
 */
export class SqliteVfsRevisionRepository implements VfsRevisionRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async findByPathAndVersion(
    path: string,
    version: number,
  ): Promise<VfsRevision | null> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT path, version, content, status, mtime_ms, storage_kind
       FROM vfs_revision
       WHERE path = #{path} AND version = #{version}`,
      { path: normalized, version },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToRevision(rows[0]!);
  }

  async append(input: VfsRevisionAppendInput): Promise<void> {
    const normalized = normalizePath(input.path);
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_revision
       (path, version, content, status, mtime_ms, storage_kind)
       VALUES (#{path}, #{version}, #{content}, #{status}, #{mtimeMs}, #{storageKind})`,
      {
        path: normalized,
        version: input.version,
        content: input.content,
        status: input.status,
        mtimeMs: input.mtimeMs,
        storageKind: input.storageKind,
      },
    );
  }
}
