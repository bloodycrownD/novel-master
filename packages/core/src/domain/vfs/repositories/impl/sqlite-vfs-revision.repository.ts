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
import { SqliteVfsContentStore } from "../../content-store/impl/sqlite-vfs-content-store.js";
import type { VfsContentStore } from "../../content-store/vfs-content-store.port.js";
import {
  nullableText,
  resolveRevisionPlainContent,
} from "../../content-store/logic/resolve-stored-content.js";
import type {
  VfsRevision,
  VfsRevisionStatus,
} from "../../model/vfs-revision.js";
import type { VfsStorageKind } from "../../model/vfs-entry.js";
import type {
  VfsRevisionAppendInput,
  VfsRevisionPointerMeta,
  VfsRevisionRepository,
} from "../vfs-revision.port.js";
import { revisionPairKey } from "../../logic/revision-pair-key.js";
import { normalizePath } from "./normalize-path.js";

/** 批量 SQL 的分块大小（避免单条语句过长）。 */
const REVISION_BATCH_CHUNK_SIZE = 100;

/**
 * TDBC-backed vfs_revision repository（append-only；正文经 ContentStore）。
 */
export class SqliteVfsRevisionRepository implements VfsRevisionRepository {
  private readonly parser = new SqlTemplateParser();
  private readonly contentStore: VfsContentStore;

  constructor(
    private readonly conn: TdbcConnection,
    contentStore?: VfsContentStore,
  ) {
    this.contentStore = contentStore ?? new SqliteVfsContentStore(conn);
  }

  async findMaxVersionForPath(path: string): Promise<number | null> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate<{ max_version: number | null }>(
      this.conn,
      this.parser,
      `SELECT MAX(version) AS max_version FROM vfs_revision WHERE path = #{path}`,
      { path: normalized },
    );
    const max = rows[0]?.max_version;
    return max == null ? null : Number(max);
  }

  async findByPathAndVersion(
    path: string,
    version: number,
  ): Promise<VfsRevision | null> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT path, version, content, content_hash, status, mtime_ms, storage_kind
       FROM vfs_revision
       WHERE path = #{path} AND version = #{version}`,
      { path: normalized, version },
    );
    if (rows.length === 0) {
      return null;
    }
    return this.rowToRevision(rows[0]!);
  }

  async existsByPathAndVersion(
    path: string,
    version: number,
  ): Promise<boolean> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate<{ one: number }>(
      this.conn,
      this.parser,
      `SELECT 1 AS one FROM vfs_revision
       WHERE path = #{path} AND version = #{version}
       LIMIT 1`,
      { path: normalized, version },
    );
    return rows.length > 0;
  }

  async findMetaByPathAndVersion(
    path: string,
    version: number,
  ): Promise<VfsRevisionPointerMeta | null> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate<{
      status: string;
      content_hash: string | null;
    }>(
      this.conn,
      this.parser,
      `SELECT status, content_hash FROM vfs_revision
       WHERE path = #{path} AND version = #{version}
       LIMIT 1`,
      { path: normalized, version },
    );
    const row = rows[0];
    if (row == null) {
      return null;
    }
    return {
      status: row.status as VfsRevisionStatus,
      contentHash: nullableText(row.content_hash),
    };
  }

  async findMetasByPathVersions(
    pairs: ReadonlyArray<{ readonly path: string; readonly version: number }>,
  ): Promise<Map<string, VfsRevisionPointerMeta>> {
    const result = new Map<string, VfsRevisionPointerMeta>();
    if (pairs.length === 0) {
      return result;
    }
    for (let offset = 0; offset < pairs.length; offset += REVISION_BATCH_CHUNK_SIZE) {
      const chunk = pairs.slice(offset, offset + REVISION_BATCH_CHUNK_SIZE);
      const bindings: Record<string, string | number> = {};
      const conditions = chunk
        .map((pair, index) => {
          bindings[`path${index}`] = normalizePath(pair.path);
          bindings[`version${index}`] = pair.version;
          return `(path = #{path${index}} AND version = #{version${index}})`;
        })
        .join(" OR ");
      const rows = await queryTemplate<{
        path: string;
        version: number;
        status: string;
        content_hash: string | null;
      }>(
        this.conn,
        this.parser,
        `SELECT path, version, status, content_hash
         FROM vfs_revision
         WHERE ${conditions}`,
        bindings,
      );
      for (const row of rows) {
        result.set(revisionPairKey(String(row.path), Number(row.version)), {
          status: row.status as VfsRevisionStatus,
          contentHash: nullableText(row.content_hash),
        });
      }
    }
    return result;
  }

  async append(input: VfsRevisionAppendInput): Promise<void> {
    const normalized = normalizePath(input.path);
    let contentHash: string | null = null;
    if (input.status === "active") {
      if (input.contentHash != null && input.contentHash.length > 0) {
        contentHash = input.contentHash;
      } else if (input.content != null) {
        contentHash = await this.contentStore.put(input.content);
      }
    }

    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_revision
       (path, version, content, content_hash, status, mtime_ms, storage_kind)
       VALUES (#{path}, #{version}, NULL, #{contentHash}, #{status}, #{mtimeMs}, #{storageKind})`,
      {
        path: normalized,
        version: input.version,
        contentHash,
        status: input.status,
        mtimeMs: input.mtimeMs,
        storageKind: input.storageKind,
      },
    );
  }

  async listKeysUnderPrefix(
    physicalPrefix: string,
  ): Promise<ReadonlyArray<{ path: string; version: number }>> {
    const base = normalizePath(physicalPrefix);
    const escaped = base.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const childPattern = base === "/" ? "/%" : `${escaped}/%`;
    const rows = await queryTemplate<{ path: string; version: number }>(
      this.conn,
      this.parser,
      `SELECT path, version FROM vfs_revision
       WHERE path = #{path} OR path LIKE #{childPattern} ESCAPE '\\'
       ORDER BY path, version`,
      { path: base, childPattern },
    );
    return rows.map((row) => ({
      path: String(row.path),
      version: Number(row.version),
    }));
  }

  async deleteExceptReachable(
    physicalPrefix: string,
    reachable: ReadonlySet<string>,
  ): Promise<number> {
    const candidates = await this.listKeysUnderPrefix(physicalPrefix);
    const toDelete = candidates.filter(
      ({ path, version }) => !reachable.has(revisionPairKey(path, version)),
    );
    if (toDelete.length === 0) {
      return 0;
    }
    let deleted = 0;
    for (let offset = 0; offset < toDelete.length; offset += REVISION_BATCH_CHUNK_SIZE) {
      const chunk = toDelete.slice(offset, offset + REVISION_BATCH_CHUNK_SIZE);
      const bindings: Record<string, string | number> = {};
      const conditions = chunk
        .map(({ path, version }, index) => {
          bindings[`path${index}`] = path;
          bindings[`version${index}`] = version;
          return `(path = #{path${index}} AND version = #{version${index}})`;
        })
        .join(" OR ");
      await executeTemplate(
        this.conn,
        this.parser,
        `DELETE FROM vfs_revision WHERE ${conditions}`,
        bindings,
      );
      deleted += chunk.length;
    }
    return deleted;
  }

  async adjustRefCount(
    path: string,
    version: number,
    delta: number,
  ): Promise<void> {
    if (delta === 0) {
      return;
    }
    const normalized = normalizePath(path);
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE vfs_revision SET ref_count = ref_count + #{delta}
       WHERE path = #{path} AND version = #{version}`,
      { path: normalized, version, delta },
    );
  }

  async repairRefCountFloor(
    path: string,
    version: number,
    expected: number,
  ): Promise<boolean> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate<{ ref_count: number }>(
      this.conn,
      this.parser,
      `SELECT ref_count FROM vfs_revision
       WHERE path = #{path} AND version = #{version}`,
      { path: normalized, version },
    );
    const row = rows[0];
    if (row == null) {
      return false;
    }
    const current = Number(row.ref_count);
    if (current >= expected) {
      return false;
    }
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE vfs_revision SET ref_count = #{expected}
       WHERE path = #{path} AND version = #{version}`,
      { path: normalized, version, expected },
    );
    return true;
  }

  async deleteUnreferencedUnderPrefix(physicalPrefix: string): Promise<number> {
    const base = normalizePath(physicalPrefix);
    const escaped = base.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const childPattern = base === "/" ? "/%" : `${escaped}/%`;
    const before = await queryTemplate<{ n: number }>(
      this.conn,
      this.parser,
      `SELECT COUNT(*) AS n FROM vfs_revision
       WHERE (path = #{path} OR path LIKE #{childPattern} ESCAPE '\\')
         AND ref_count <= 0`,
      { path: base, childPattern },
    );
    const count = Number(before[0]?.n ?? 0);
    if (count === 0) {
      return 0;
    }
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM vfs_revision
       WHERE (path = #{path} OR path LIKE #{childPattern} ESCAPE '\\')
         AND ref_count <= 0`,
      { path: base, childPattern },
    );
    return count;
  }

  private async rowToRevision(row: Row): Promise<VfsRevision> {
    const statusRaw = String(row.status);
    const status: VfsRevisionStatus =
      statusRaw === "deleted" ? "deleted" : "active";
    const content = await resolveRevisionPlainContent(this.contentStore, {
      status,
      content: nullableText(row.content),
      contentHash: nullableText(row.content_hash),
    });
    return {
      path: String(row.path),
      version: Number(row.version),
      content,
      status,
      mtimeMs: Number(row.mtime_ms),
      storageKind: String(row.storage_kind) as VfsStorageKind,
    };
  }
}
