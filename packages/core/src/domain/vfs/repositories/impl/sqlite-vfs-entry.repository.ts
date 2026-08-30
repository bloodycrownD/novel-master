/**
 * SQLite implementation of {@link VfsEntryRepository} via SqlTemplateParser.
 *
 * entry_id 化后所有 SQL 带 `scope_key`；点查询统一 `WHERE scope_key=? AND path=?`，
 * 前缀扫描统一 `WHERE scope_key=? AND (path=? OR path LIKE ?||'/%')`。`entry_id`
 * 由 DB AUTOINCREMENT 生成，写入后读回挂在 {@link VfsEntry.entryId}。
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
import { SqliteVfsContentStore } from "../../content-store/impl/sqlite-vfs-content-store.js";
import type { VfsContentStore } from "../../content-store/vfs-content-store.port.js";
import {
  nullableText,
  resolveEntryPlainContent,
} from "../../content-store/logic/resolve-stored-content.js";
import type { VfsEntry, VfsEntryKind } from "../../model/vfs-entry.js";
import type { VfsListEntry } from "../../model/vfs-list-entry.js";
import type {
  VfsDeleteOptions,
  VfsListOptions,
  VfsWriteRepoOptions,
} from "../../model/vfs-options.js";
import type { VfsEntryRepository } from "../vfs-entry.port.js";
import { normalizePath } from "./normalize-path.js";
import { escapeLike, normalizePrefix } from "./scope-prefix-helpers.js";

function relativeUnderDir(dir: string, entryPath: string): string {
  if (dir === "/") {
    return entryPath.slice(1);
  }
  return entryPath.slice(dir.length + 1);
}

/** 统一前缀扫描的 LIKE 子串（base 为 `/` 时匹配 `/%`）。 */
function childLikePattern(base: string): string {
  return base === "/" ? "/%" : `${escapeLike(base)}/%`;
}

/**
 * TDBC-backed vfs_entry repository（正文经 ContentStore）。
 */
export class SqliteVfsEntryRepository implements VfsEntryRepository {
  private readonly parser = new SqlTemplateParser();
  private readonly contentStore: VfsContentStore;

  constructor(
    private readonly conn: TdbcConnection,
    contentStore?: VfsContentStore
  ) {
    this.contentStore = contentStore ?? new SqliteVfsContentStore(conn);
  }

  async list(
    scopeKey: string,
    dir: string,
    options?: VfsListOptions
  ): Promise<VfsListEntry[]> {
    const normalizedDir = normalizePath(dir);
    const pattern = childLikePattern(normalizedDir);
    const rows = await queryTemplate<{
      path: string;
      entry_kind: string;
      head_version: number;
    }>(
      this.conn,
      this.parser,
      `SELECT path, entry_kind, head_version FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND path LIKE #{pattern} ESCAPE '\\'`,
      { scopeKey, pattern }
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
          entries.push({
            path: entryPath,
            kind,
            version: Number(row.head_version),
          });
        }
        continue;
      }

      if (maxDepth != null) {
        const depth = relative.split("/").filter(Boolean).length;
        if (depth > maxDepth) {
          continue;
        }
      }
      entries.push({
        path: entryPath,
        kind,
        version: Number(row.head_version),
      });
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }

  async findByPath(scopeKey: string, path: string): Promise<VfsEntry | null> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT entry_id, scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind
       FROM vfs_entry WHERE scope_key = #{scopeKey} AND path = #{path}`,
      { scopeKey, path: normalized }
    );
    if (rows.length === 0) {
      return null;
    }
    return this.rowToEntry(rows[0]!);
  }

  async findContentHash(
    scopeKey: string,
    path: string
  ): Promise<string | null> {
    const normalized = normalizePath(path);
    const rows = await queryTemplate<{
      content_hash: string | null;
      entry_kind: string;
    }>(
      this.conn,
      this.parser,
      `SELECT content_hash, entry_kind FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND path = #{path}`,
      { scopeKey, path: normalized }
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    if (row.entry_kind === "directory") {
      return null;
    }
    return nullableText(row.content_hash);
  }

  async findContentHashesByPaths(
    scopeKey: string,
    paths: ReadonlyArray<string>
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (paths.length === 0) {
      return result;
    }
    const normalized = [...new Set(paths.map((path) => normalizePath(path)))];
    const chunkSize = 200;
    for (let offset = 0; offset < normalized.length; offset += chunkSize) {
      const chunk = normalized.slice(offset, offset + chunkSize);
      const bindings: Record<string, string | number> = { scopeKey };
      const inClause = chunk
        .map((path, index) => {
          bindings[`path${index}`] = path;
          return `#{path${index}}`;
        })
        .join(", ");
      const rows = await queryTemplate<{
        path: string;
        content_hash: string | null;
        entry_kind: string;
      }>(
        this.conn,
        this.parser,
        `SELECT path, content_hash, entry_kind
         FROM vfs_entry
         WHERE scope_key = #{scopeKey} AND path IN (${inClause})`,
        bindings
      );
      for (const row of rows) {
        const path = String(row.path);
        if (row.entry_kind === "directory") {
          result.set(path, null);
        } else {
          result.set(path, nullableText(row.content_hash));
        }
      }
    }
    for (const path of normalized) {
      if (!result.has(path)) {
        result.set(path, null);
      }
    }
    return result;
  }

  async insert(
    scopeKey: string,
    path: string,
    content: string
  ): Promise<{ version: number }> {
    return this.insertAtVersion(scopeKey, path, content, 1);
  }

  async insertWithContentHash(
    scopeKey: string,
    path: string,
    contentHash: string
  ): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();
    const version = 1;
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (#{scopeKey}, #{path}, NULL, #{contentHash}, #{version}, #{mtimeMs}, 'file')`,
      { scopeKey, path: normalized, contentHash, version, mtimeMs }
    );
    return { version };
  }

  async insertAtVersion(
    scopeKey: string,
    path: string,
    content: string,
    version: number
  ): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();
    const contentHash = await this.contentStore.put(content);
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (#{scopeKey}, #{path}, NULL, #{contentHash}, #{version}, #{mtimeMs}, 'file')`,
      { scopeKey, path: normalized, contentHash, version, mtimeMs }
    );
    return { version };
  }

  async insertDirectory(scopeKey: string, path: string): Promise<void> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (#{scopeKey}, #{path}, NULL, NULL, 1, #{mtimeMs}, 'directory')`,
      { scopeKey, path: normalized, mtimeMs }
    );
  }

  async update(
    scopeKey: string,
    path: string,
    content: string,
    nextVersion: number,
    options: VfsWriteRepoOptions
  ): Promise<{ version: number }> {
    const contentHash = await this.contentStore.put(content);
    return this.applyContentHashUpdate(
      scopeKey,
      path,
      contentHash,
      nextVersion,
      options
    );
  }

  async updateWithContentHash(
    scopeKey: string,
    path: string,
    contentHash: string,
    nextVersion: number,
    options: VfsWriteRepoOptions
  ): Promise<{ version: number }> {
    return this.applyContentHashUpdate(
      scopeKey,
      path,
      contentHash,
      nextVersion,
      options
    );
  }

  private async applyContentHashUpdate(
    scopeKey: string,
    path: string,
    contentHash: string,
    nextVersion: number,
    options: VfsWriteRepoOptions
  ): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();

    if (options.versionCheck) {
      const expectedVersion = options.expectedVersion!;
      const result = await executeTemplate(
        this.conn,
        this.parser,
        `UPDATE vfs_entry
         SET content = NULL,
             content_hash = #{contentHash},
             head_version = #{nextVersion},
             mtime_ms = #{mtimeMs}
         WHERE scope_key = #{scopeKey} AND path = #{path}
           AND head_version = #{expectedVersion} AND entry_kind = 'file'`,
        {
          scopeKey,
          contentHash,
          nextVersion,
          mtimeMs,
          path: normalized,
          expectedVersion,
        }
      );
      if (result.changes === 0) {
        const rows = await queryTemplate<{ head_version: number }>(
          this.conn,
          this.parser,
          `SELECT head_version FROM vfs_entry
           WHERE scope_key = #{scopeKey} AND path = #{path}`,
          { scopeKey, path: normalized }
        );
        if (rows.length === 0) {
          throw vfsNotFound(normalized);
        }
        throw vfsConflict(
          normalized,
          expectedVersion,
          Number(rows[0]!.head_version)
        );
      }
    } else {
      const result = await executeTemplate(
        this.conn,
        this.parser,
        `UPDATE vfs_entry
         SET content = NULL,
             content_hash = #{contentHash},
             head_version = #{nextVersion},
             mtime_ms = #{mtimeMs}
         WHERE scope_key = #{scopeKey} AND path = #{path} AND entry_kind = 'file'`,
        { scopeKey, contentHash, nextVersion, mtimeMs, path: normalized }
      );
      if (result.changes === 0) {
        throw vfsNotFound(normalized);
      }
    }

    const rows = await queryTemplate<{ head_version: number }>(
      this.conn,
      this.parser,
      `SELECT head_version FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND path = #{path}`,
      { scopeKey, path: normalized }
    );
    return { version: Number(rows[0]!.head_version) };
  }

  async setHeadContentHash(
    scopeKey: string,
    path: string,
    input: {
      version: number;
      contentHash: string;
      mtimeMs: number;
    }
  ): Promise<void> {
    const normalized = normalizePath(path);
    const existing = await queryTemplate<{ entry_id: number }>(
      this.conn,
      this.parser,
      `SELECT entry_id FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND path = #{path}`,
      { scopeKey, path: normalized }
    );

    if (existing.length > 0) {
      await executeTemplate(
        this.conn,
        this.parser,
        `UPDATE vfs_entry
         SET content = NULL,
             content_hash = #{contentHash},
             head_version = #{version},
             mtime_ms = #{mtimeMs},
             entry_kind = 'file'
         WHERE scope_key = #{scopeKey} AND path = #{path}`,
        {
          scopeKey,
          path: normalized,
          contentHash: input.contentHash,
          version: input.version,
          mtimeMs: input.mtimeMs,
        }
      );
      return;
    }

    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)
       VALUES (#{scopeKey}, #{path}, NULL, #{contentHash}, #{version}, #{mtimeMs}, 'file')`,
      {
        scopeKey,
        path: normalized,
        contentHash: input.contentHash,
        version: input.version,
        mtimeMs: input.mtimeMs,
      }
    );
  }

  async delete(
    scopeKey: string,
    path: string,
    options: VfsDeleteOptions
  ): Promise<number> {
    const normalized = normalizePath(path);
    const pattern = childLikePattern(normalized);

    if (!options.recursive) {
      const childRows = await queryTemplate(
        this.conn,
        this.parser,
        `SELECT 1 FROM vfs_entry
         WHERE scope_key = #{scopeKey}
           AND path LIKE #{pattern} ESCAPE '\\'
           AND path <> #{path}
         LIMIT 1`,
        { scopeKey, pattern, path: normalized }
      );
      if (childRows.length > 0) {
        throw vfsDirectoryNotEmpty(normalized);
      }

      const result = await executeTemplate(
        this.conn,
        this.parser,
        `DELETE FROM vfs_entry WHERE scope_key = #{scopeKey} AND path = #{path}`,
        { scopeKey, path: normalized }
      );
      if (result.changes === 0) {
        throw vfsNotFound(normalized);
      }
      return result.changes;
    }

    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')`,
      { scopeKey, path: normalized, pattern }
    );
    if (result.changes === 0) {
      throw vfsNotFound(normalized);
    }
    return result.changes;
  }

  async deleteRecursiveIfAny(
    scopeKey: string,
    prefix: string
  ): Promise<number> {
    // 先探测：prefix 下无任何 entry 时静默返回 0，避免 recursive:true 分支的 vfsNotFound。
    const base = normalizePrefix(prefix);
    const entries = await this.listEntriesUnderPrefix(scopeKey, base);
    if (entries.length === 0) {
      return 0;
    }
    // base 为空串时 normalizePath 会抛 INVALID_PATH；空串与根 "/" 在 childLikePattern 下
    // 都匹配 "/%"（即全部以 / 开头的路径），语义等价，这里用 "/" 替代空串。
    const deletePath = base === "" ? "/" : base;
    // delete() 现在透出 changes（实际删除行数），比之前返回探测命中数更准——
    // 探测与删除在同一 scope+prefix 内，两者通常一致，但用真实 changes 避免「探测与删除之间
    // 出现并发写入」这类极端情况下的偏差。
    return await this.delete(scopeKey, deletePath, { recursive: true });
  }

  async listAllPaths(scopeKey: string): Promise<string[]> {
    const rows = await queryTemplate<{ path: string }>(
      this.conn,
      this.parser,
      `SELECT path FROM vfs_entry
       WHERE scope_key = #{scopeKey} AND entry_kind = 'file'
       ORDER BY path`,
      { scopeKey }
    );
    return rows.map((row) => String(row.path));
  }

  async listDirectoryPathsUnderPrefix(
    scopeKey: string,
    pathPrefix: string
  ): Promise<string[]> {
    const base = normalizePrefix(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await queryTemplate<{ path: string }>(
      this.conn,
      this.parser,
      `SELECT path FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'directory'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
       ORDER BY path`,
      { scopeKey, path: base, pattern }
    );
    return rows.map((row) => String(row.path));
  }

  async listEntriesUnderPrefix(
    scopeKey: string,
    pathPrefix: string
  ): Promise<VfsListEntry[]> {
    const base = normalizePrefix(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await queryTemplate<{ path: string; entry_kind: string }>(
      this.conn,
      this.parser,
      `SELECT path, entry_kind FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
       ORDER BY path`,
      { scopeKey, path: base, pattern }
    );
    return rows.map((row) => ({
      path: String(row.path),
      kind: row.entry_kind === "directory" ? "directory" : "file",
    }));
  }

  async listFileMetaUnderPrefix(
    scopeKey: string,
    pathPrefix: string
  ): Promise<ReadonlyArray<{ path: string; mtimeMs: number }>> {
    const base = normalizePrefix(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await queryTemplate<{ path: string; mtime_ms: number }>(
      this.conn,
      this.parser,
      `SELECT path, mtime_ms FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
       ORDER BY path`,
      { scopeKey, path: base, pattern }
    );
    return rows.map((row) => ({
      path: String(row.path),
      mtimeMs: Number(row.mtime_ms),
    }));
  }

  async listFileHeadsUnderPrefix(
    scopeKey: string,
    pathPrefix: string
  ): Promise<
    ReadonlyArray<{
      entryId: number;
      path: string;
      headVersion: number;
      mtimeMs: number;
    }>
  > {
    const base = normalizePrefix(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await queryTemplate<{
      entry_id: number;
      path: string;
      head_version: number;
      mtime_ms: number;
    }>(
      this.conn,
      this.parser,
      `SELECT entry_id, path, head_version, mtime_ms FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')
       ORDER BY path`,
      { scopeKey, path: base, pattern }
    );
    return rows.map((row) => ({
      entryId: Number(row.entry_id),
      path: String(row.path),
      headVersion: Number(row.head_version),
      mtimeMs: Number(row.mtime_ms),
    }));
  }

  async scanContents(
    scopeKey: string,
    pathPrefix?: string
  ): Promise<
    ReadonlyArray<{
      entryId: number;
      path: string;
      content: string;
    }>
  > {
    if (pathPrefix == null) {
      const rows = await queryTemplate<{
        entry_id: number;
        path: string;
        content_hash: string | null;
      }>(
        this.conn,
        this.parser,
        `SELECT entry_id, path, content_hash FROM vfs_entry
         WHERE scope_key = #{scopeKey} AND entry_kind = 'file'`,
        { scopeKey }
      );
      return this.resolveScanRows(rows);
    }

    const base = normalizePath(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await queryTemplate<{
      entry_id: number;
      path: string;
      content_hash: string | null;
    }>(
      this.conn,
      this.parser,
      `SELECT entry_id, path, content_hash FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')`,
      { scopeKey, path: base, pattern }
    );
    return this.resolveScanRows(rows);
  }

  async scanFileEntriesWithMeta(
    scopeKey: string,
    pathPrefix?: string
  ): Promise<
    ReadonlyArray<{
      entryId: number;
      path: string;
      contentHash: string | null;
      headVersion: number;
      mtimeMs: number;
    }>
  > {
    if (pathPrefix == null) {
      const rows = await queryTemplate<{
        entry_id: number;
        path: string;
        content_hash: string | null;
        head_version: number;
        mtime_ms: number;
      }>(
        this.conn,
        this.parser,
        `SELECT entry_id, path, content_hash, head_version, mtime_ms FROM vfs_entry
         WHERE scope_key = #{scopeKey} AND entry_kind = 'file'`,
        { scopeKey }
      );
      return rows.map((r) => ({
        entryId: r.entry_id,
        path: r.path,
        contentHash: nullableText(r.content_hash),
        headVersion: r.head_version,
        mtimeMs: r.mtime_ms,
      }));
    }

    const base = normalizePath(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await queryTemplate<{
      entry_id: number;
      path: string;
      content_hash: string | null;
      head_version: number;
      mtime_ms: number;
    }>(
      this.conn,
      this.parser,
      `SELECT entry_id, path, content_hash, head_version, mtime_ms FROM vfs_entry
       WHERE scope_key = #{scopeKey}
         AND entry_kind = 'file'
         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')`,
      { scopeKey, path: base, pattern }
    );
    return rows.map((r) => ({
      entryId: r.entry_id,
      path: r.path,
      contentHash: nullableText(r.content_hash),
      headVersion: r.head_version,
      mtimeMs: r.mtime_ms,
    }));
  }

  async findExistingPaths(
    scopeKey: string,
    paths: ReadonlyArray<string>
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (paths.length === 0) {
      return result;
    }
    const normalized = [...new Set(paths.map((p) => normalizePath(p)))];
    const chunkSize = 200;
    for (let offset = 0; offset < normalized.length; offset += chunkSize) {
      const chunk = normalized.slice(offset, offset + chunkSize);
      const bindings: Record<string, string> = { scopeKey };
      const inClause = chunk
        .map((path, index) => {
          bindings[`path${index}`] = path;
          return `#{path${index}}`;
        })
        .join(", ");
      const rows = await queryTemplate<{ path: string }>(
        this.conn,
        this.parser,
        `SELECT path FROM vfs_entry
         WHERE scope_key = #{scopeKey} AND path IN (${inClause})`,
        bindings
      );
      for (const row of rows) {
        result.add(String(row.path));
      }
    }
    return result;
  }

  async batchInsertFileEntriesWithHash(
    scopeKey: string,
    entries: ReadonlyArray<{
      path: string;
      contentHash: string;
      mtimeMs: number;
    }>
  ): Promise<void> {
    if (entries.length === 0) return;
    const sql = `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind) VALUES (?, ?, NULL, ?, 1, ?, 'file')`;
    const paramsList = entries.map((e) => [
      scopeKey,
      normalizePath(e.path),
      e.contentHash,
      e.mtimeMs,
    ]);
    await this.conn.batch(sql, paramsList);
  }

  async batchInsertDirectoryEntries(
    scopeKey: string,
    paths: ReadonlyArray<string>
  ): Promise<void> {
    if (paths.length === 0) return;
    const sql = `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind) VALUES (?, ?, NULL, NULL, 1, ?, 'directory')`;
    const now = Date.now();
    const paramsList = paths.map((p) => [scopeKey, normalizePath(p), now]);
    await this.conn.batch(sql, paramsList);
  }

  private async resolveScanRows(
    rows: ReadonlyArray<{
      entry_id: number;
      path: string;
      content_hash: string | null;
    }>
  ): Promise<
    ReadonlyArray<{ entryId: number; path: string; content: string }>
  > {
    // 先收集所有非空 content_hash，一次 getMany 批量读取，避免逐条 get 的 N+1。
    const hashes = new Set<string>();
    for (const row of rows) {
      const h = nullableText(row.content_hash);
      if (h != null && h.length > 0) {
        hashes.add(h);
      }
    }
    const contentMap =
      hashes.size > 0
        ? await this.contentStore.getMany([...hashes])
        : new Map<string, string>();

    const out: Array<{ entryId: number; path: string; content: string }> = [];
    for (const row of rows) {
      const h = nullableText(row.content_hash);
      let plain: string;
      if (h != null && h.length > 0) {
        // scanContents 这条路径只查 entry_kind='file' 的行，正文从 blob 读。
        const cached = contentMap.get(h);
        if (cached == null) {
          throw new Error(`vfs_content_blob 缺失: ${h}`);
        }
        plain = cached;
      } else {
        // content=NULL 且 content_hash=NULL 的 active 文件行视为正文损坏。
        throw new Error(
          "vfs 正文损坏：active 文件 content 与 content_hash 均为 NULL"
        );
      }
      out.push({
        entryId: Number(row.entry_id),
        path: String(row.path),
        content: plain,
      });
    }
    return out;
  }

  async renamePathInScope(
    tx: TdbcConnection,
    scopeKey: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    const oldNorm = normalizePath(oldPath);
    const newNorm = normalizePath(newPath);
    const parser = this.parser;
    const result = await executeTemplate(
      tx,
      parser,
      `UPDATE vfs_entry SET path = #{newPath}
       WHERE scope_key = #{scopeKey} AND path = #{oldPath}`,
      { scopeKey, oldPath: oldNorm, newPath: newNorm }
    );
    if (result.changes === 0) {
      throw vfsNotFound(oldNorm);
    }
  }

  async renamePrefixInScope(
    tx: TdbcConnection,
    scopeKey: string,
    oldPrefix: string,
    newPrefix: string
  ): Promise<void> {
    const oldBase = normalizePrefix(oldPrefix);
    const newBase = normalizePrefix(newPrefix);
    const parser = this.parser;
    // 目录前缀重命名：把 `oldBase/...` 整体替换成 `newBase/...`；含 oldBase 自身。
    // 用 `REPLACE(path, oldBase||'/', newBase||'/')` 处理子项，再单独 UPDATE 前缀根。
    const result = await executeTemplate(
      tx,
      parser,
      `UPDATE vfs_entry
       SET path = REPLACE(path, #{oldWithSlash}, #{newWithSlash})
       WHERE scope_key = #{scopeKey}
         AND path LIKE #{pattern} ESCAPE '\\'`,
      {
        scopeKey,
        oldWithSlash: `${oldBase}/`,
        newWithSlash: `${newBase}/`,
        pattern: `${escapeLike(oldBase)}/%`,
      }
    );
    // 处理前缀根自身（oldBase → newBase）。
    await executeTemplate(
      tx,
      parser,
      `UPDATE vfs_entry SET path = #{newBase}
       WHERE scope_key = #{scopeKey} AND path = #{oldBase}`,
      { scopeKey, oldBase, newBase }
    );
    if (result.changes === 0) {
      // 允许空目录（无子项），仅根自身存在时也算成功；根都不在时抛错。
      const rows = await queryTemplate<{ entry_id: number }>(
        tx,
        parser,
        `SELECT entry_id FROM vfs_entry
         WHERE scope_key = #{scopeKey} AND path = #{oldBase} LIMIT 1`,
        { scopeKey, oldBase }
      );
      if (rows.length === 0) {
        throw vfsNotFound(oldBase);
      }
    }
  }

  private async rowToEntry(row: Row): Promise<VfsEntry> {
    const kindRaw = row.entry_kind;
    const entryKind: VfsEntryKind =
      kindRaw === "directory" ? "directory" : "file";
    const headVersion = Number(row.head_version);
    const content = await resolveEntryPlainContent(this.contentStore, {
      entryKind,
      content: nullableText(row.content),
      contentHash: nullableText(row.content_hash),
    });
    return {
      entryId: Number(row.entry_id),
      scopeKey: String(row.scope_key),
      path: String(row.path),
      content,
      version: headVersion,
      mtimeMs: Number(row.mtime_ms),
      entryKind,
    };
  }
}
