/**
 * SQLite implementation of {@link VfsRevisionRepository}.
 *
 * entry_id 化后所有 SQL 改按 `entry_id` 寻址；前缀扫描经 `vfs_entry` JOIN 用
 * `(scope_key, path)` 圈定范围。
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
import type {
  VfsRevisionAppendInput,
  VfsRevisionPointerMeta,
  VfsRevisionRepository,
} from "../vfs-revision.port.js";
import { VfsError } from "@/errors/vfs-errors.js";
import { revisionPairKey } from "../../logic/revision-pair-key.js";
import { escapeLike, normalizePrefix } from "./scope-prefix-helpers.js";

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

  async findMaxVersionForEntry(entryId: number): Promise<number | null> {
    const rows = await queryTemplate<{ max_version: number | null }>(
      this.conn,
      this.parser,
      `SELECT MAX(version) AS max_version FROM vfs_revision WHERE entry_id = #{entryId}`,
      { entryId },
    );
    const max = rows[0]?.max_version;
    return max == null ? null : Number(max);
  }

  async findByEntryAndVersion(
    entryId: number,
    version: number,
  ): Promise<VfsRevision | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT entry_id, version, content_hash, status, mtime_ms
       FROM vfs_revision
       WHERE entry_id = #{entryId} AND version = #{version}`,
      { entryId, version },
    );
    if (rows.length === 0) {
      return null;
    }
    return this.rowToRevision(rows[0]!);
  }

  async existsByEntryAndVersion(
    entryId: number,
    version: number,
  ): Promise<boolean> {
    const rows = await queryTemplate<{ one: number }>(
      this.conn,
      this.parser,
      `SELECT 1 AS one FROM vfs_revision
       WHERE entry_id = #{entryId} AND version = #{version}
       LIMIT 1`,
      { entryId, version },
    );
    return rows.length > 0;
  }

  async findMetaByEntryAndVersion(
    entryId: number,
    version: number,
  ): Promise<VfsRevisionPointerMeta | null> {
    const rows = await queryTemplate<{
      status: string;
      content_hash: string | null;
    }>(
      this.conn,
      this.parser,
      `SELECT status, content_hash FROM vfs_revision
       WHERE entry_id = #{entryId} AND version = #{version}
       LIMIT 1`,
      { entryId, version },
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

  async findMetasByEntryVersions(
    pairs: ReadonlyArray<{ readonly entryId: number; readonly version: number }>,
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
          bindings[`entryId${index}`] = pair.entryId;
          bindings[`version${index}`] = pair.version;
          return `(entry_id = #{entryId${index}} AND version = #{version${index}})`;
        })
        .join(" OR ");
      const rows = await queryTemplate<{
        entry_id: number;
        version: number;
        status: string;
        content_hash: string | null;
      }>(
        this.conn,
        this.parser,
        `SELECT entry_id, version, status, content_hash
         FROM vfs_revision
         WHERE ${conditions}`,
        bindings,
      );
      for (const row of rows) {
        result.set(
          revisionPairKey(Number(row.entry_id), Number(row.version)),
          {
            status: row.status as VfsRevisionStatus,
            contentHash: nullableText(row.content_hash),
          },
        );
      }
    }
    return result;
  }

  async findExistingEntryVersionKeys(
    pairs: ReadonlyArray<{ readonly entryId: number; readonly version: number }>,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (pairs.length === 0) {
      return result;
    }
    const CHUNK_SIZE = 500;
    for (let offset = 0; offset < pairs.length; offset += CHUNK_SIZE) {
      const chunk = pairs.slice(offset, offset + CHUNK_SIZE);
      const placeholders = chunk.map(() => `(?,?)`).join(`,`);
      const params: unknown[] = [];
      for (const pair of chunk) {
        params.push(pair.entryId, pair.version);
      }
      const rows = await this.conn.query<{ entry_id: number; version: number }>(
        `SELECT entry_id, version FROM vfs_revision WHERE (entry_id, version) IN (${placeholders})`,
        params,
      );
      for (const row of rows) {
        result.add(revisionPairKey(Number(row.entry_id), Number(row.version)));
      }
    }
    return result;
  }

  async batchAppendWithRefCount(
    items: ReadonlyArray<{
      readonly entryId: number;
      readonly version: number;
      readonly contentHash: string | null;
      readonly status: string;
      readonly mtimeMs: number;
      readonly refCount: number;
    }>,
  ): Promise<void> {
    if (items.length === 0) return;
    const sql = `INSERT INTO vfs_revision (entry_id, version, content_hash, status, mtime_ms, ref_count) VALUES (?, ?, ?, ?, ?, ?)`;
    const paramsList = items.map((i) => [
      i.entryId,
      i.version,
      i.contentHash,
      i.status,
      i.mtimeMs,
      i.refCount,
    ]);
    await this.conn.batch(sql, paramsList);
  }

  async append(input: VfsRevisionAppendInput): Promise<void> {
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
       (entry_id, version, content_hash, status, mtime_ms)
       VALUES (#{entryId}, #{version}, #{contentHash}, #{status}, #{mtimeMs})`,
      {
        entryId: input.entryId,
        version: input.version,
        contentHash,
        status: input.status,
        mtimeMs: input.mtimeMs,
      },
    );
  }

  async listKeysUnderScope(
    scopeKey: string,
    pathPrefix: string,
  ): Promise<ReadonlyArray<{ entryId: number; version: number }>> {
    const base = normalizePrefix(pathPrefix);
    const escaped = escapeLike(base);
    const pattern = base === "/" ? "/%" : `${escaped}/%`;
    const rows = await queryTemplate<{ entry_id: number; version: number }>(
      this.conn,
      this.parser,
      `SELECT r.entry_id AS entry_id, r.version AS version
       FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = #{scopeKey}
         AND (e.path = #{path} OR e.path LIKE #{pattern} ESCAPE '\\')
       ORDER BY r.entry_id, r.version`,
      { scopeKey, path: base, pattern },
    );
    return rows.map((row) => ({
      entryId: Number(row.entry_id),
      version: Number(row.version),
    }));
  }

  async deleteExceptReachable(
    scopeKey: string,
    pathPrefix: string,
    reachable: ReadonlySet<string>,
  ): Promise<number> {
    const candidates = await this.listKeysUnderScope(scopeKey, pathPrefix);
    const toDelete = candidates.filter(
      ({ entryId, version }) => !reachable.has(revisionPairKey(entryId, version)),
    );
    if (toDelete.length === 0) {
      return 0;
    }
    let deleted = 0;
    for (let offset = 0; offset < toDelete.length; offset += REVISION_BATCH_CHUNK_SIZE) {
      const chunk = toDelete.slice(offset, offset + REVISION_BATCH_CHUNK_SIZE);
      const bindings: Record<string, string | number> = {};
      const conditions = chunk
        .map(({ entryId, version }, index) => {
          bindings[`entryId${index}`] = entryId;
          bindings[`version${index}`] = version;
          return `(entry_id = #{entryId${index}} AND version = #{version${index}})`;
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
    entryId: number,
    version: number,
    delta: number,
  ): Promise<void> {
    if (delta === 0) {
      return;
    }
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE vfs_revision SET ref_count = ref_count + #{delta}
       WHERE entry_id = #{entryId} AND version = #{version}`,
      { entryId, version, delta },
    );
    if (delta > 0 && result.changes === 0) {
      throw new VfsError(
        "NOT_FOUND",
        `Revision not found: entry ${entryId}@${version}`,
        { details: { entryId, version }, expectedVersion: version },
      );
    }
  }

  async repairRefCountFloor(
    entryId: number,
    version: number,
    expected: number,
  ): Promise<boolean> {
    const rows = await queryTemplate<{ ref_count: number }>(
      this.conn,
      this.parser,
      `SELECT ref_count FROM vfs_revision
       WHERE entry_id = #{entryId} AND version = #{version}`,
      { entryId, version },
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
       WHERE entry_id = #{entryId} AND version = #{version}`,
      { entryId, version, expected },
    );
    return true;
  }

  async deleteUnreferencedUnderScope(
    scopeKey: string,
    pathPrefix: string,
  ): Promise<number> {
    const base = normalizePrefix(pathPrefix);
    const escaped = escapeLike(base);
    const pattern = base === "/" ? "/%" : `${escaped}/%`;
    const before = await queryTemplate<{ n: number }>(
      this.conn,
      this.parser,
      `SELECT COUNT(*) AS n
       FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = #{scopeKey}
         AND (e.path = #{path} OR e.path LIKE #{pattern} ESCAPE '\\')
         AND r.ref_count <= 0`,
      { scopeKey, path: base, pattern },
    );
    const count = Number(before[0]?.n ?? 0);
    if (count === 0) {
      return 0;
    }
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM vfs_revision
       WHERE rowid IN (
         SELECT r.rowid
         FROM vfs_revision r
         JOIN vfs_entry e ON e.entry_id = r.entry_id
         WHERE e.scope_key = #{scopeKey}
           AND (e.path = #{path} OR e.path LIKE #{pattern} ESCAPE '\\')
           AND r.ref_count <= 0
       )`,
      { scopeKey, path: base, pattern },
    );
    return count;
  }

  private async rowToRevision(row: Row): Promise<VfsRevision> {
    const statusRaw = String(row.status);
    const status: VfsRevisionStatus =
      statusRaw === "deleted" ? "deleted" : "active";
    const content = await resolveRevisionPlainContent(this.contentStore, {
      status,
      content: null,
      contentHash: nullableText(row.content_hash),
    });
    return {
      entryId: Number(row.entry_id),
      version: Number(row.version),
      content,
      status,
      mtimeMs: Number(row.mtime_ms),
    };
  }
}
