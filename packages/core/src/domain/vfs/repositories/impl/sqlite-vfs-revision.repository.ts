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
import { ORPHAN_REVISION_GC_SQL } from "@/bootstrap/schema-migrations/orphan-revision-gc-v1.js";

/** 批量 SQL 的分块大小（避免单条语句过长）。 */
const REVISION_BATCH_CHUNK_SIZE = 100;

/** batchRepairRefCountFloor 的 SELECT / UPDATE 分块大小（对齐 v1.4.24 的 500）。 */
const REVISION_REPAIR_CHUNK_SIZE = 500;

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

  async batchAdjustRefCount(
    pointers: ReadonlyArray<{ readonly entryId: number; readonly version: number }>,
    delta: 1 | -1,
  ): Promise<void> {
    await this.batchAdjustRefCountWithDelta(pointers, delta);
  }

  async batchAdjustRefCountWithDelta(
    pointers: ReadonlyArray<{ readonly entryId: number; readonly version: number }>,
    delta: number,
  ): Promise<void> {
    if (pointers.length === 0 || delta === 0) {
      return;
    }

    // delta > 0 要先校验所有 pair 都存在，守护 T-RB-REF-MISSING 不变量；
    // delta < 0 命不中即跳过，不需要前置查存在性。
    if (delta > 0) {
      const existing = await this.findExistingEntryVersionKeys(pointers);
      const missing: Array<{ entryId: number; version: number }> = [];
      for (const p of pointers) {
        if (!existing.has(revisionPairKey(p.entryId, p.version))) {
          missing.push({ entryId: p.entryId, version: p.version });
        }
      }
      if (missing.length > 0) {
        const first = missing[0]!;
        throw new VfsError(
          "NOT_FOUND",
          `Revision not found: entry ${first.entryId}@${first.version} (共 ${missing.length} 条缺失)`,
          {
            details: { missing },
            expectedVersion: first.version,
          },
        );
      }
    }

    // 按 500 分块发 UPDATE，复用 findExistingEntryVersionKeys 的 (entry_id, version) IN (...) 写法
    const CHUNK_SIZE = 500;
    const deltaLiteral = delta > 0 ? `+ ${delta}` : `${delta}`;
    for (let offset = 0; offset < pointers.length; offset += CHUNK_SIZE) {
      const chunk = pointers.slice(offset, offset + CHUNK_SIZE);
      const placeholders = chunk.map(() => `(?,?)`).join(`,`);
      const params: unknown[] = [];
      for (const pair of chunk) {
        params.push(pair.entryId, pair.version);
      }
      await this.conn.execute(
        `UPDATE vfs_revision SET ref_count = ref_count ${deltaLiteral} WHERE (entry_id, version) IN (${placeholders})`,
        params,
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

  async batchRepairRefCountFloor(
    items: ReadonlyArray<{
      readonly entryId: number;
      readonly version: number;
      readonly expected: number;
    }>,
  ): Promise<number> {
    if (items.length === 0) {
      return 0;
    }

    // Step 1：批量 SELECT 当前 ref_count。复用 (entry_id, version) IN (...) 写法，
    // 按 500 分块避免单条 SQL 太长。缺失行（revision 已被 GC）自然不会进 currentMap，
    // 后面 diff 时当作 no-op，跟逐条 repairRefCountFloor 的 row == null 分支一致。
    const currentMap = new Map<string, number>();
    for (
      let offset = 0;
      offset < items.length;
      offset += REVISION_REPAIR_CHUNK_SIZE
    ) {
      const chunk = items.slice(offset, offset + REVISION_REPAIR_CHUNK_SIZE);
      const placeholders = chunk.map(() => `(?,?)`).join(`,`);
      const params: unknown[] = [];
      for (const item of chunk) {
        params.push(item.entryId, item.version);
      }
      const rows = await this.conn.query<{ entry_id: number; version: number; ref_count: number }>(
        `SELECT entry_id, version, ref_count FROM vfs_revision WHERE (entry_id, version) IN (${placeholders})`,
        params,
      );
      for (const row of rows) {
        currentMap.set(
          revisionPairKey(Number(row.entry_id), Number(row.version)),
          Number(row.ref_count),
        );
      }
    }

    // Step 2：内存算 diff，只挑 current < expected 的项（保持「只增不减」语义）。
    const toUpdate: Array<[number, number, number]> = [];
    for (const item of items) {
      const current = currentMap.get(
        revisionPairKey(item.entryId, item.version),
      );
      if (current == null) {
        continue;
      }
      if (current < item.expected) {
        toUpdate.push([item.expected, item.entryId, item.version]);
      }
    }
    if (toUpdate.length === 0) {
      return 0;
    }

    // Step 3：conn.batch 写回。每条参数是 [expected, entryId, version]，对应
    // `UPDATE ... SET ref_count = ? WHERE entry_id = ? AND version = ?`。batch 把
    // N 行压成一次原生调用，counter 侧只计 1 条 SQL（同文本）。同样按 500 分块，
    // 避免单次 batch 参数列表过长。
    const sql = `UPDATE vfs_revision SET ref_count = ? WHERE entry_id = ? AND version = ?`;
    let adjusted = 0;
    for (
      let offset = 0;
      offset < toUpdate.length;
      offset += REVISION_REPAIR_CHUNK_SIZE
    ) {
      const chunk = toUpdate.slice(offset, offset + REVISION_REPAIR_CHUNK_SIZE);
      await this.conn.batch(sql, chunk);
      adjusted += chunk.length;
    }
    return adjusted;
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
      // 用复合 PK (entry_id, version) 寻址而非 rowid，这样 vfs_revision 可以安全地
      // 切换到 WITHOUT ROWID（决策 4）。rowid 表和 WITHOUT ROWID 表都支持这种写法，
      // 所以这条改动本身不改变 rowid 表上的行为。
      `DELETE FROM vfs_revision
       WHERE (entry_id, version) IN (
         SELECT r.entry_id, r.version
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

  async deleteGlobalOrphans(): Promise<number> {
    // 不依赖 vfs_entry JOIN（孤儿 revision 的 entry 已删，JOIN 不到），
    // 直接按「ref_count<=0 且 entry_id 不存在」全表清扫。
    // revision DELETE 触发器会连带维护 vfs_content_blob.ref_count 并回收归零 blob。
    // SQL 与 orphan-revision-gc-v1 migration 共享同一常量，避免两份逐字漂移。
    const result = await executeTemplate(
      this.conn,
      this.parser,
      ORPHAN_REVISION_GC_SQL,
      {},
    );
    return Number(result.changes);
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
