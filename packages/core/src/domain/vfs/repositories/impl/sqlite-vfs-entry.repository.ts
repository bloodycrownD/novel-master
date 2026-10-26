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
import { AppError } from "@/errors/app-error.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { executeTemplate, queryTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { vfsDirectoryNotEmpty, vfsNotFound } from "@/errors/vfs-errors.js";
import { nullableText } from "@/common/coerce.js";
import { SqliteVfsContentStore } from "../../content-store/impl/sqlite-vfs-content-store.js";
import type { VfsContentStore } from "../../content-store/vfs-content-store.port.js";
import { resolveEntryPlainContent } from "../../content-store/logic/resolve-stored-content.js";
import type { VfsEntry, VfsEntryKind } from "../../model/vfs-entry.js";
import type { VfsContentSize } from "../../model/vfs-content-size.js";
import type { VfsListEntry } from "../../model/vfs-list-entry.js";
import type { VfsDeleteOptions, VfsListOptions } from "../../model/vfs-options.js";
import type { VfsEntryRepository } from "../vfs-entry.port.js";
import { normalizePath } from "./normalize-path.js";
import { escapeLike, normalizePrefix } from "./scope-prefix-helpers.js";

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

  constructor(private readonly conn: TdbcConnection, contentStore?: VfsContentStore) {
    this.contentStore = contentStore ?? new SqliteVfsContentStore(conn);
  }

  async list(scopeKey: string, dir: string, options?: VfsListOptions): Promise<VfsListEntry[]> {
    const normalizedDir = normalizePath(dir);
    const pattern = childLikePattern(normalizedDir);
    const sql27 = "SELECT path, entry_kind, head_version FROM vfs_entry\n       WHERE scope_key = #{scopeKey}\n         AND path LIKE #{pattern} ESCAPE '\\'";
    const rows = await queryTemplate<{ path: string; entry_kind: string; head_version: number }>(this.conn, this.parser, sql27, { scopeKey, pattern });

    const recursive = options?.recursive === true;
    const maxDepth = options?.maxDepth;

    const entries: VfsListEntry[] = [];
    for (const row of rows) {
      const entryPath = String(row.path);
      const kind: VfsEntryKind = row.entry_kind === "directory" ? "directory" : "file";
      const relative = normalizedDir === "/" ? entryPath.slice(1) : entryPath.slice(normalizedDir.length + 1);
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
    const sql28 = "SELECT entry_id, scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind\n       FROM vfs_entry WHERE scope_key = #{scopeKey} AND path = #{path}";
    const rows = await queryTemplate(this.conn, this.parser, sql28, { scopeKey, path: normalized });
    if (rows.length === 0) {
      return null;
    }
    return this.rowToEntry(rows[0]!);
  }

  async findContentHash(scopeKey: string, path: string): Promise<string | null> {
    const normalized = normalizePath(path);
    const sql29 = "SELECT content_hash, entry_kind FROM vfs_entry\n       WHERE scope_key = #{scopeKey} AND path = #{path}";
    const rows = await queryTemplate<{ content_hash: string | null; entry_kind: string }>(this.conn, this.parser, sql29, { scopeKey, path: normalized });
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    if (row.entry_kind === "directory") {
      return null;
    }
    return nullableText(row.content_hash);
  }

  async findContentHashesByPaths(scopeKey: string, paths: ReadonlyArray<string>): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (paths.length === 0) {
      return result;
    }
    const normalized = [...new Set(paths.map((path) => normalizePath(path)))];
    const chunkSize = 200;
    for (let offset = 0; offset < normalized.length; offset += chunkSize) {
      const chunk = normalized.slice(offset, offset + chunkSize);
      const bindings: Record<string, string | number> = { scopeKey };
      const placeholders = chunk.map((path, index) => {
        bindings[`path${index}`] = path;
        return `#{path${index}}`;
      });
      const inClause = placeholders.join(", ");
      const sql30 = `SELECT path, content_hash, entry_kind
         FROM vfs_entry
         WHERE scope_key = #{scopeKey} AND path IN (${inClause})`;
      const rows = await queryTemplate<{ path: string; content_hash: string | null; entry_kind: string }>(this.conn, this.parser, sql30, bindings);
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

  async findContentSizeByPath(scopeKey: string, path: string): Promise<VfsContentSize | null> {
    const normalized = normalizePath(path);
    // 只取长度不解正文：内联行 length(content) 为字符数（NULL 行不拉正文）；
    // mtime 随行带回供占位块渲染真实时间（CR-1：避免 1970 假时间戳入提示词）
    const sql31 = "SELECT length(content) AS inline_chars, content_hash, entry_kind, mtime_ms\n       FROM vfs_entry\n       WHERE scope_key = #{scopeKey} AND path = #{path}";
    const rows = await queryTemplate<{ inline_chars: number | null; content_hash: string | null; entry_kind: string; mtime_ms: number }>(this.conn, this.parser, sql31, { scopeKey, path: normalized });
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    if (row.entry_kind === "directory") {
      return null;
    }
    // 与 resolveActiveFilePlainContent 的解正文顺序对齐：content_hash 优先，
    // 遗留明文兜底，保证探测到的大小与真实读取路径周源一致
    const contentHash = nullableText(row.content_hash);
    if (contentHash != null && contentHash.length > 0) {
      const sql15 = "SELECT byte_len FROM vfs_content_blob\n         WHERE content_hash = #{contentHash}";
      const blobRows = await queryTemplate<{ byte_len: number }>(this.conn, this.parser, sql15, { contentHash });
      if (blobRows.length > 0) {
        return {
          kind: "blobCompressedBytes",
          size: Number(blobRows[0]!.byte_len),
          mtimeMs: Number(row.mtime_ms),
        };
      }
      // blob 行缺失 → 回退 member.compressed_byte_len。该列恒为从被替换 blob 行
      // 原样复制的 byte_len（两 format 同口径，fossil 组严禁记 delta 长度），故
      // 大文件闸门（按压缩侧折算）口径与独立 blob 形态逐字节一致。
      const sql16 = "SELECT compressed_byte_len FROM vfs_content_pack_member\n         WHERE content_hash = #{contentHash}";
      const memberRows = await queryTemplate<{ compressed_byte_len: number }>(this.conn, this.parser, sql16, { contentHash });
      if (memberRows.length === 0) {
        return null;
      }
      return {
        kind: "blobCompressedBytes",
        size: Number(memberRows[0]!.compressed_byte_len),
        mtimeMs: Number(row.mtime_ms),
      };
    }
    const inlineChars = row.inline_chars;
    if (inlineChars != null) {
      return {
        kind: "inlineChars",
        size: Number(inlineChars),
        mtimeMs: Number(row.mtime_ms),
      };
    }
    return null;
  }

  async insert(scopeKey: string, path: string, content: string): Promise<{ version: number }> {
    return this.insertAtVersion(scopeKey, path, content, 1);
  }

  async insertWithContentHash(scopeKey: string, path: string, contentHash: string): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();
    const version = 1;
    const sql32 = "INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)\n       VALUES (#{scopeKey}, #{path}, NULL, #{contentHash}, #{version}, #{mtimeMs}, 'file')";
    await executeTemplate(this.conn, this.parser, sql32, { scopeKey, path: normalized, contentHash, version, mtimeMs });
    return { version };
  }

  async insertAtVersion(scopeKey: string, path: string, content: string, version: number): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();
    const contentHash = await this.contentStore.put(content);
    const sql33 = "INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)\n       VALUES (#{scopeKey}, #{path}, NULL, #{contentHash}, #{version}, #{mtimeMs}, 'file')";
    await executeTemplate(this.conn, this.parser, sql33, { scopeKey, path: normalized, contentHash, version, mtimeMs });
    return { version };
  }

  async insertDirectory(scopeKey: string, path: string): Promise<void> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();
    const sql34 = "INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)\n       VALUES (#{scopeKey}, #{path}, NULL, NULL, 1, #{mtimeMs}, 'directory')";
    await executeTemplate(this.conn, this.parser, sql34, { scopeKey, path: normalized, mtimeMs });
  }

  async reviveEntryAtVersion(input: { entryId: number; scopeKey: string; path: string; contentHash: string; headVersion: number; mtimeMs: number }): Promise<void> {
    const normalized = normalizePath(input.path);
    const sql35 = "INSERT INTO vfs_entry (entry_id, scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)\n       VALUES (#{entryId}, #{scopeKey}, #{path}, NULL, #{contentHash}, #{headVersion}, #{mtimeMs}, 'file')";
    await executeTemplate(this.conn, this.parser, sql35, {
      entryId: input.entryId,
      scopeKey: input.scopeKey,
      path: normalized,
      contentHash: input.contentHash,
      headVersion: input.headVersion,
      mtimeMs: input.mtimeMs,
    });
  }

  async update(scopeKey: string, path: string, content: string, nextVersion: number): Promise<{ version: number }> {
    const contentHash = await this.contentStore.put(content);
    return this.applyContentHashUpdate(scopeKey, path, contentHash, nextVersion);
  }

  async updateWithContentHash(scopeKey: string, path: string, contentHash: string, nextVersion: number): Promise<{ version: number }> {
    return this.applyContentHashUpdate(scopeKey, path, contentHash, nextVersion);
  }

  private async applyContentHashUpdate(scopeKey: string, path: string, contentHash: string, nextVersion: number): Promise<{ version: number }> {
    const normalized = normalizePath(path);
    const mtimeMs = Date.now();

    const sql36 = "UPDATE vfs_entry\n       SET content = NULL,\n           content_hash = #{contentHash},\n           head_version = #{nextVersion},\n           mtime_ms = #{mtimeMs}\n       WHERE scope_key = #{scopeKey} AND path = #{path} AND entry_kind = 'file'";
    const result = await executeTemplate(this.conn, this.parser, sql36, { scopeKey, contentHash, nextVersion, mtimeMs, path: normalized });
    if (result.changes === 0) {
      throw vfsNotFound(normalized);
    }

    const sql17 = "SELECT head_version FROM vfs_entry\n       WHERE scope_key = #{scopeKey} AND path = #{path}";
    const rows = await queryTemplate<{ head_version: number }>(this.conn, this.parser, sql17, { scopeKey, path: normalized });
    return { version: Number(rows[0]!.head_version) };
  }

  async setHeadContentHash(scopeKey: string, path: string, input: {
      version: number;
      contentHash: string;
      mtimeMs: number;
    }): Promise<void> {
    const normalized = normalizePath(path);
    const sql37 = "SELECT entry_id FROM vfs_entry\n       WHERE scope_key = #{scopeKey} AND path = #{path}";
    const existing = await queryTemplate<{ entry_id: number }>(this.conn, this.parser, sql37, { scopeKey, path: normalized });

    if (existing.length > 0) {
      const sql18 = "UPDATE vfs_entry\n         SET content = NULL,\n             content_hash = #{contentHash},\n             head_version = #{version},\n             mtime_ms = #{mtimeMs},\n             entry_kind = 'file'\n         WHERE scope_key = #{scopeKey} AND path = #{path}";
      await executeTemplate(this.conn, this.parser, sql18, {
        scopeKey,
        path: normalized,
        contentHash: input.contentHash,
        version: input.version,
        mtimeMs: input.mtimeMs,
      });
      return;
    }

    const sql19 = "INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind)\n       VALUES (#{scopeKey}, #{path}, NULL, #{contentHash}, #{version}, #{mtimeMs}, 'file')";
    await executeTemplate(this.conn, this.parser, sql19, {
      scopeKey,
      path: normalized,
      contentHash: input.contentHash,
      version: input.version,
      mtimeMs: input.mtimeMs,
    });
  }

  async delete(scopeKey: string, path: string, options: VfsDeleteOptions): Promise<number> {
    const normalized = normalizePath(path);
    const pattern = childLikePattern(normalized);

    if (!options.recursive) {
      const sql20 = "SELECT 1 FROM vfs_entry\n         WHERE scope_key = #{scopeKey}\n           AND path LIKE #{pattern} ESCAPE '\\'\n           AND path <> #{path}\n         LIMIT 1";
      const childRows = await queryTemplate(this.conn, this.parser, sql20, { scopeKey, pattern, path: normalized });
      if (childRows.length > 0) {
        throw vfsDirectoryNotEmpty(normalized);
      }

      const result = await executeTemplate(this.conn, this.parser, `DELETE FROM vfs_entry WHERE scope_key = #{scopeKey} AND path = #{path}`, { scopeKey, path: normalized });
      if (result.changes === 0) {
        throw vfsNotFound(normalized);
      }
      return result.changes;
    }

    const sql21 = "DELETE FROM vfs_entry\n       WHERE scope_key = #{scopeKey}\n         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')";
    const result = await executeTemplate(this.conn, this.parser, sql21, { scopeKey, path: normalized, pattern });
    if (result.changes === 0) {
      throw vfsNotFound(normalized);
    }
    return result.changes;
  }

  async deleteRecursiveIfAny(scopeKey: string, prefix: string): Promise<number> {
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
    const sql38 = "SELECT path FROM vfs_entry\n       WHERE scope_key = #{scopeKey} AND entry_kind = 'file'\n       ORDER BY path";
    const rows = await queryTemplate<{ path: string }>(this.conn, this.parser, sql38, { scopeKey });
    return rows.map((row) => String(row.path));
  }

  async listDirectoryPathsUnderPrefix(scopeKey: string, pathPrefix: string): Promise<string[]> {
    const base = normalizePrefix(pathPrefix);
    const pattern = childLikePattern(base);
    const sql39 = "SELECT path FROM vfs_entry\n       WHERE scope_key = #{scopeKey}\n         AND entry_kind = 'directory'\n         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')\n       ORDER BY path";
    const rows = await queryTemplate<{ path: string }>(this.conn, this.parser, sql39, { scopeKey, path: base, pattern });
    return rows.map((row) => String(row.path));
  }

  async listDirectoryMetaUnderPrefix(scopeKey: string, pathPrefix: string): Promise<ReadonlyArray<{ path: string; mtimeMs: number }>> {
    const base = normalizePrefix(pathPrefix);
    const pattern = childLikePattern(base);
    const sql40 = "SELECT path, mtime_ms FROM vfs_entry\n       WHERE scope_key = #{scopeKey}\n         AND entry_kind = 'directory'\n         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')\n       ORDER BY path";
    const rows = await queryTemplate<{ path: string; mtime_ms: number }>(this.conn, this.parser, sql40, { scopeKey, path: base, pattern });
    return rows.map((row) => ({
      path: String(row.path),
      mtimeMs: Number(row.mtime_ms),
    }));
  }

  async listEntriesUnderPrefix(scopeKey: string, pathPrefix: string): Promise<VfsListEntry[]> {
    const base = normalizePrefix(pathPrefix);
    const pattern = childLikePattern(base);
    const sql41 = "SELECT path, entry_kind FROM vfs_entry\n       WHERE scope_key = #{scopeKey}\n         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')\n       ORDER BY path";
    const rows = await queryTemplate<{ path: string; entry_kind: string }>(this.conn, this.parser, sql41, { scopeKey, path: base, pattern });
    return rows.map((row) => ({
      path: String(row.path),
      kind: row.entry_kind === "directory" ? "directory" : "file",
    }));
  }

  async listFileMetaUnderPrefix(scopeKey: string, pathPrefix: string): Promise<ReadonlyArray<{ path: string; mtimeMs: number }>> {
    const base = normalizePrefix(pathPrefix);
    const pattern = childLikePattern(base);
    const sql42 = "SELECT path, mtime_ms FROM vfs_entry\n       WHERE scope_key = #{scopeKey}\n         AND entry_kind = 'file'\n         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')\n       ORDER BY path";
    const rows = await queryTemplate<{ path: string; mtime_ms: number }>(this.conn, this.parser, sql42, { scopeKey, path: base, pattern });
    return rows.map((row) => ({
      path: String(row.path),
      mtimeMs: Number(row.mtime_ms),
    }));
  }

  async computeEntrySignature(scopeKey: string): Promise<string> {
    const sql43 = "SELECT count(*) AS entry_count, group_concat(s, char(31)) AS sig\n       FROM (SELECT path || ':' || head_version || ':' || mtime_ms AS s\n             FROM vfs_entry\n             WHERE scope_key = #{scopeKey}\n             ORDER BY path)";
    const rows = await queryTemplate<{ entry_count: number; sig: string | null }>(this.conn, this.parser, sql43, { scopeKey });
    const row = rows[0];
    // 空结果集时 group_concat 返回 NULL；两列拼成单串（count 天然隔离
    // 拼接歧义：不同行数的集合必不同串）
    return `${Number(row?.entry_count ?? 0)}|${row?.sig ?? ""}`;
  }

  async listFileHeadsUnderPrefix(scopeKey: string, pathPrefix: string): Promise<
    ReadonlyArray<{
      entryId: number;
      path: string;
      headVersion: number;
      mtimeMs: number;
    }>
  > {
    const base = normalizePrefix(pathPrefix);
    const pattern = childLikePattern(base);
    const sql44 = "SELECT entry_id, path, head_version, mtime_ms FROM vfs_entry\n       WHERE scope_key = #{scopeKey}\n         AND entry_kind = 'file'\n         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')\n       ORDER BY path";
    const rows = await queryTemplate<{ entry_id: number; path: string; head_version: number; mtime_ms: number }>(this.conn, this.parser, sql44, { scopeKey, path: base, pattern });
    return rows.map((row) => ({
      entryId: Number(row.entry_id),
      path: String(row.path),
      headVersion: Number(row.head_version),
      mtimeMs: Number(row.mtime_ms),
    }));
  }

  async scanContents(scopeKey: string, pathPrefix?: string): Promise<
    ReadonlyArray<{
      entryId: number;
      path: string;
      content: string;
    }>
  > {
    if (pathPrefix == null) {
      const sql45 = "SELECT entry_id, path, content_hash FROM vfs_entry\n         WHERE scope_key = #{scopeKey} AND entry_kind = 'file'";
      const rows = await queryTemplate<{ entry_id: number; path: string; content_hash: string | null }>(this.conn, this.parser, sql45, { scopeKey });
      return this.resolveScanRows(rows);
    }

    const base = normalizePath(pathPrefix);
    const pattern = childLikePattern(base);
    const sql46 = "SELECT entry_id, path, content_hash FROM vfs_entry\n       WHERE scope_key = #{scopeKey}\n         AND entry_kind = 'file'\n         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')";
    const rows = await queryTemplate<{ entry_id: number; path: string; content_hash: string | null }>(this.conn, this.parser, sql46, { scopeKey, path: base, pattern });
    return this.resolveScanRows(rows);
  }

  async scanFileEntriesWithMeta(scopeKey: string, pathPrefix?: string): Promise<
    ReadonlyArray<{
      entryId: number;
      path: string;
      contentHash: string | null;
      headVersion: number;
      mtimeMs: number;
    }>
  > {
    if (pathPrefix == null) {
      const sql47 = "SELECT entry_id, path, content_hash, head_version, mtime_ms FROM vfs_entry\n         WHERE scope_key = #{scopeKey} AND entry_kind = 'file'";
      const rows = await queryTemplate<{ entry_id: number; path: string; content_hash: string | null; head_version: number; mtime_ms: number }>(this.conn, this.parser, sql47, { scopeKey });
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
    const sql48 = "SELECT entry_id, path, content_hash, head_version, mtime_ms FROM vfs_entry\n       WHERE scope_key = #{scopeKey}\n         AND entry_kind = 'file'\n         AND (path = #{path} OR path LIKE #{pattern} ESCAPE '\\')";
    const rows = await queryTemplate<{ entry_id: number; path: string; content_hash: string | null; head_version: number; mtime_ms: number }>(this.conn, this.parser, sql48, { scopeKey, path: base, pattern });
    return rows.map((r) => ({
      entryId: r.entry_id,
      path: r.path,
      contentHash: nullableText(r.content_hash),
      headVersion: r.head_version,
      mtimeMs: r.mtime_ms,
    }));
  }

  async findExistingPaths(scopeKey: string, paths: ReadonlyArray<string>): Promise<Set<string>> {
    const result = new Set<string>();
    if (paths.length === 0) {
      return result;
    }
    const normalized = [...new Set(paths.map((p) => normalizePath(p)))];
    const chunkSize = 200;
    for (let offset = 0; offset < normalized.length; offset += chunkSize) {
      const chunk = normalized.slice(offset, offset + chunkSize);
      const bindings: Record<string, string> = { scopeKey };
      const placeholders = chunk.map((path, index) => {
        bindings[`path${index}`] = path;
        return `#{path${index}}`;
      });
      const inClause = placeholders.join(", ");
      const sql22 = `SELECT path FROM vfs_entry
         WHERE scope_key = #{scopeKey} AND path IN (${inClause})`;
      const rows = await queryTemplate<{ path: string }>(this.conn, this.parser, sql22, bindings);
      for (const row of rows) {
        result.add(String(row.path));
      }
    }
    return result;
  }

  async batchInsertFileEntriesWithHash(scopeKey: string, entries: ReadonlyArray<{
      path: string;
      contentHash: string;
      mtimeMs: number;
    }>): Promise<void> {
    if (entries.length === 0) return;
    const sql = `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind) VALUES (?, ?, NULL, ?, 1, ?, 'file')`;
    const paramsList = entries.map((e) => [scopeKey, normalizePath(e.path), e.contentHash, e.mtimeMs]);
    await this.conn.batch(sql, paramsList);
  }

  async batchInsertDirectoryEntries(scopeKey: string, paths: ReadonlyArray<string>): Promise<void> {
    if (paths.length === 0) return;
    const sql = `INSERT INTO vfs_entry (scope_key, path, content, content_hash, head_version, mtime_ms, entry_kind) VALUES (?, ?, NULL, NULL, 1, ?, 'directory')`;
    const now = Date.now();
    const paramsList = paths.map((p) => [scopeKey, normalizePath(p), now]);
    await this.conn.batch(sql, paramsList);
  }

  private async resolveScanRows(rows: ReadonlyArray<{
      entry_id: number;
      path: string;
      content_hash: string | null;
    }>): Promise<ReadonlyArray<{ entryId: number; path: string; content: string }>> {
    // 先收集所有非空 content_hash，一次 getMany 批量读取，避免逐条 get 的 N+1。
    const hashes = new Set<string>();
    for (const row of rows) {
      const h = nullableText(row.content_hash);
      if (h != null && h.length > 0) {
        hashes.add(h);
      }
    }
    const contentMap = hashes.size > 0 ? await this.contentStore.getMany([...hashes]) : new Map<string, string>();

    const out: Array<{ entryId: number; path: string; content: string }> = [];
    for (const row of rows) {
      const h = nullableText(row.content_hash);
      let plain: string;
      if (h != null && h.length > 0) {
        // scanContents 这条路径只查 entry_kind='file' 的行，正文从 blob 读。
        const cached = contentMap.get(h);
        if (cached == null) {
          throw new AppError("VFS_CONTENT_BLOB_MISSING", `vfs_content_blob 缺失: ${h}`, { contentHash: h });
        }
        plain = cached;
      } else {
        // content=NULL 且 content_hash=NULL 的 active 文件行视为正文损坏。
        throw new AppError("VFS_CONTENT_CORRUPT", "vfs 正文损坏：active 文件 content 与 content_hash 均为 NULL");
      }
      out.push({
        entryId: Number(row.entry_id),
        path: String(row.path),
        content: plain,
      });
    }
    return out;
  }

  async renamePathInScope(tx: TdbcConnection, scopeKey: string, oldPath: string, newPath: string): Promise<void> {
    const oldNorm = normalizePath(oldPath);
    const newNorm = normalizePath(newPath);
    const parser = this.parser;
    const sql49 = "UPDATE vfs_entry SET path = #{newPath}\n       WHERE scope_key = #{scopeKey} AND path = #{oldPath}";
    const result = await executeTemplate(tx, parser, sql49, { scopeKey, oldPath: oldNorm, newPath: newNorm });
    if (result.changes === 0) {
      throw vfsNotFound(oldNorm);
    }
  }

  async renamePrefixInScope(tx: TdbcConnection, scopeKey: string, oldPrefix: string, newPrefix: string): Promise<void> {
    const oldBase = normalizePrefix(oldPrefix);
    const newBase = normalizePrefix(newPrefix);
    const parser = this.parser;
    // 目录前缀重命名：把 `oldBase/...` 整体替换成 `newBase/...`；含 oldBase 自身。
    // 必须用「剥定长前缀 + 拼新前缀」的定点写法（substr），**不能用 REPLACE**：
    // REPLACE 替换整串中出现的所有匹配，子树内部再出现一次同名目录时深层那一段
    // 会被二次替换（/a → /a_新 且子树含 a/sub/a/notes.md ⇒ 错成 a_新/sub/a_新/notes.md），
    // 文件被静默搬到磁盘上不存在的路径，用户再也点不到。
    const sql50 = "UPDATE vfs_entry\n       SET path = #{newWithSlash} || substr(path, length(#{oldWithSlash}) + 1)\n       WHERE scope_key = #{scopeKey}\n         AND path LIKE #{pattern} ESCAPE '\\'";
    const sql50Bindings = {
      scopeKey,
      oldWithSlash: `${oldBase}/`,
      newWithSlash: `${newBase}/`,
      pattern: `${escapeLike(oldBase)}/%`,
    };
    const result = await executeTemplate(tx, parser, sql50, sql50Bindings);
    // 处理前缀根自身（oldBase → newBase）。
    const sql51 = "UPDATE vfs_entry SET path = #{newBase}\n       WHERE scope_key = #{scopeKey} AND path = #{oldBase}";
    const rootResult = await executeTemplate(tx, parser, sql51, { scopeKey, oldBase, newBase });
    if (result.changes === 0 && rootResult.changes === 0) {
      // 子项与目录根都不存在（幽灵路径）时维持 NOT_FOUND。
      // 允许空目录（无子项）：根自身已被上面这条 UPDATE 改到新路径
      // （rootResult.changes === 1）即算成功，不能再按旧路径 SELECT 复核——
      // 根已改名，旧路径必然查不到。
      throw vfsNotFound(oldBase);
    }
  }

  private async rowToEntry(row: Row): Promise<VfsEntry> {
    const kindRaw = row.entry_kind;
    const entryKind: VfsEntryKind = kindRaw === "directory" ? "directory" : "file";
    const headVersion = Number(row.head_version);
    const resolved = await resolveEntryPlainContent(this.contentStore, { entryKind, content: nullableText(row.content), contentHash: nullableText(row.content_hash) });
    if (!resolved.ok) throw resolved.error;
    return {
      entryId: Number(row.entry_id),
      scopeKey: String(row.scope_key),
      path: String(row.path),
      content: resolved.value,
      version: headVersion,
      mtimeMs: Number(row.mtime_ms),
      entryKind,
    };
  }
}
