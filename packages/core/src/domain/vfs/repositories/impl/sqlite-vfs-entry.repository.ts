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
import { Result } from "@/errors/either.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import { Coerce } from "@/common/coerce.js";
import { SqliteVfsContentStore } from "../../content-store/impl/sqlite-vfs-content-store.js";
import type { VfsContentStore } from "../../content-store/vfs-content-store.port.js";
import { StoredContent } from "../../content-store/logic/resolve-stored-content.js";
import type { VfsEntry, VfsEntryKind } from "../../model/vfs-entry.js";
import type { VfsContentSize } from "../../model/vfs-content-size.js";
import type { VfsListEntry } from "../../model/vfs-list-entry.js";
import type { VfsDeleteOptions, VfsListOptions } from "../../model/vfs-options.js";
import type { VfsEntryRepository } from "../vfs-entry.port.js";
import { PathNormalizer } from "./normalize-path.js";
import { ScopePrefix } from "./scope-prefix-helpers.js";
import { Path } from "@/common/path.js";
import { VfsEntrySql } from "@/infra/sql-template/generated/vfs_entry.mapper.generated.js";
import { VfsContentStoreSql } from "@/infra/sql-template/generated/vfs_content_store.mapper.generated.js";

/** 统一前缀扫描的 LIKE 子串（base 为 `/` 时匹配 `/%`）。 */
function childLikePattern(base: string): string {
  return base === "/" ? "/%" : `${ScopePrefix.escapeLike(base)}/%`;
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

  /**
   * 路径归一化失败与已知失败走 `Result.err`（错误通道迁移四期：`throw r.error` 清零，调用方逐层接力）。
   */
  async list(scopeKey: string, dir: string, options?: VfsListOptions): Promise<Result<VfsListEntry[], AppError>> {
    const resolved = PathNormalizer.normalize(dir);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalizedDir = resolved.value;
    const pattern = childLikePattern(normalizedDir);
    const rows = await TdbcTemplate.query<{ path: string; entry_kind: string; head_version: number }>(this.conn, this.parser, VfsEntrySql.list, { scopeKey, pattern });

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
    return Result.ok(entries);
  }

  async findByPath(scopeKey: string, path: string): Promise<Result<VfsEntry | null, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const rows = await TdbcTemplate.query(this.conn, this.parser, VfsEntrySql.findByPath, { scopeKey, path: normalized });
    if (rows.length === 0) {
      return Result.ok(null);
    }
    const row = rows[0]!;
    const kindRaw = row.entry_kind;
    const entryKind: VfsEntryKind = kindRaw === "directory" ? "directory" : "file";
    const resolvedContent = await StoredContent.resolveEntry(this.contentStore, { entryKind, content: Coerce.nullableText(row.content), contentHash: Coerce.nullableText(row.content_hash) });
    if (!resolvedContent.ok) return Result.err(resolvedContent.error);
    return Result.ok({
      entryId: Number(row.entry_id),
      scopeKey: String(row.scope_key),
      path: String(row.path),
      content: resolvedContent.value,
      version: Number(row.head_version),
      mtimeMs: Number(row.mtime_ms),
      entryKind,
    });
  }

  async findContentHash(scopeKey: string, path: string): Promise<Result<string | null, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const rows = await TdbcTemplate.query<{ content_hash: string | null; entry_kind: string }>(this.conn, this.parser, VfsEntrySql.findContentHash, { scopeKey, path: normalized });
    if (rows.length === 0) {
      return Result.ok(null);
    }
    const row = rows[0]!;
    if (row.entry_kind === "directory") {
      return Result.ok(null);
    }
    return Result.ok(Coerce.nullableText(row.content_hash));
  }

  async findContentHashesByPaths(scopeKey: string, paths: ReadonlyArray<string>): Promise<Result<Map<string, string | null>, AppError>> {
    const result = new Map<string, string | null>();
    if (paths.length === 0) {
      return Result.ok(result);
    }
    const normalizedValues: string[] = [];
    for (const path of paths) {
      const resolved = PathNormalizer.normalize(path);
      if (!resolved.ok) return Result.err(resolved.error);
      normalizedValues.push(resolved.value);
    }
    const normalized = [...new Set(normalizedValues)];
    const chunkSize = 200;
    for (let offset = 0; offset < normalized.length; offset += chunkSize) {
      const chunk = normalized.slice(offset, offset + chunkSize);
      const rows = await TdbcTemplate.query<{ path: string; content_hash: string | null; entry_kind: string }>(this.conn, this.parser, VfsEntrySql.findContentHashesByPaths, { scopeKey, paths: chunk });
      for (const row of rows) {
        const path = String(row.path);
        if (row.entry_kind === "directory") {
          result.set(path, null);
        } else {
          result.set(path, Coerce.nullableText(row.content_hash));
        }
      }
    }
    for (const path of normalized) {
      if (!result.has(path)) {
        result.set(path, null);
      }
    }
    return Result.ok(result);
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.findContentSizeByPath 端口方法；内联会把大小探测 SQL 搬进调用层。 */
  async findContentSizeByPath(scopeKey: string, path: string): Promise<Result<VfsContentSize | null, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    // 只取长度不解正文：内联行 length(content) 为字符数（NULL 行不拉正文）；
    // mtime 随行带回供占位块渲染真实时间（CR-1：避免 1970 假时间戳入提示词）
    const rows = await TdbcTemplate.query<{ inline_chars: number | null; content_hash: string | null; entry_kind: string; mtime_ms: number }>(this.conn, this.parser, VfsEntrySql.findContentSizeByPath, { scopeKey, path: normalized });
    if (rows.length === 0) {
      return Result.ok(null);
    }
    const row = rows[0]!;
    if (row.entry_kind === "directory") {
      return Result.ok(null);
    }
    // 与 resolveActiveFilePlainContent 的解正文顺序对齐：content_hash 优先，
    // 遗留明文兜底，保证探测到的大小与真实读取路径周源一致
    const contentHash = Coerce.nullableText(row.content_hash);
    if (contentHash != null && contentHash.length > 0) {
      const blobRows = await TdbcTemplate.query<{ byte_len: number }>(this.conn, this.parser, VfsContentStoreSql.findContentSizeByPathBlobBytes, { contentHash });
      if (blobRows.length > 0) {
        return Result.ok({
          kind: "blobCompressedBytes",
          size: Number(blobRows[0]!.byte_len),
          mtimeMs: Number(row.mtime_ms),
        });
      }
      // blob 行缺失 → 回退 member.compressed_byte_len。该列恒为从被替换 blob 行
      // 原样复制的 byte_len（两 format 同口径，fossil 组严禁记 delta 长度），故
      // 大文件闸门（按压缩侧折算）口径与独立 blob 形态逐字节一致。
      const memberRows = await TdbcTemplate.query<{ compressed_byte_len: number }>(this.conn, this.parser, VfsContentStoreSql.findContentSizeByPathMemberBytes, { contentHash });
      if (memberRows.length === 0) {
        return Result.ok(null);
      }
      return Result.ok({
        kind: "blobCompressedBytes",
        size: Number(memberRows[0]!.compressed_byte_len),
        mtimeMs: Number(row.mtime_ms),
      });
    }
    const inlineChars = row.inline_chars;
    if (inlineChars != null) {
      return Result.ok({
        kind: "inlineChars",
        size: Number(inlineChars),
        mtimeMs: Number(row.mtime_ms),
      });
    }
    return Result.ok(null);
  }

  async insert(scopeKey: string, path: string, content: string): Promise<Result<{ version: number }, AppError>> {
    return this.insertAtVersion(scopeKey, path, content, 1);
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.insertWithContentHash 端口方法；内联会把 INSERT SQL 搬进调用层。 */
  async insertWithContentHash(scopeKey: string, path: string, contentHash: string): Promise<Result<{ version: number }, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const mtimeMs = Date.now();
    const version = 1;
    await TdbcTemplate.execute(this.conn, this.parser, VfsEntrySql.insertWithContentHash, { scopeKey, path: normalized, contentHash, version, mtimeMs });
    return Result.ok({ version });
  }

  async insertAtVersion(scopeKey: string, path: string, content: string, version: number): Promise<Result<{ version: number }, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const mtimeMs = Date.now();
    const contentHash = await this.contentStore.put(content);
    await TdbcTemplate.execute(this.conn, this.parser, VfsEntrySql.insertAtVersion, { scopeKey, path: normalized, contentHash, version, mtimeMs });
    return Result.ok({ version });
  }

  async insertDirectory(scopeKey: string, path: string): Promise<Result<void, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const mtimeMs = Date.now();
    await TdbcTemplate.execute(this.conn, this.parser, VfsEntrySql.insertDirectory, { scopeKey, path: normalized, mtimeMs });
    return Result.ok(undefined);
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.reviveEntryAtVersion 端口方法；内联会把显式 entry_id 重建 SQL 搬进调用层。 */
  async reviveEntryAtVersion(input: { entryId: number; scopeKey: string; path: string; contentHash: string; headVersion: number; mtimeMs: number }): Promise<Result<void, AppError>> {
    const resolved = PathNormalizer.normalize(input.path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    await TdbcTemplate.execute(this.conn, this.parser, VfsEntrySql.reviveEntryAtVersion, {
      entryId: input.entryId,
      scopeKey: input.scopeKey,
      path: normalized,
      contentHash: input.contentHash,
      headVersion: input.headVersion,
      mtimeMs: input.mtimeMs,
    });
    return Result.ok(undefined);
  }

  async update(scopeKey: string, path: string, content: string, nextVersion: number): Promise<Result<{ version: number }, AppError>> {
    const contentHash = await this.contentStore.put(content);
    return this.updateWithContentHash(scopeKey, path, contentHash, nextVersion);
  }

  async updateWithContentHash(scopeKey: string, path: string, contentHash: string, nextVersion: number): Promise<Result<{ version: number }, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const mtimeMs = Date.now();

    const result = await TdbcTemplate.execute(this.conn, this.parser, VfsEntrySql.updateWithContentHash, { scopeKey, contentHash, nextVersion, mtimeMs, path: normalized });
    if (result.changes === 0) {
      return Result.err(new AppError("VFS_NOT_FOUND", { path: normalized, detail: `Path not found: ${normalized}` }));
    }

    const rows = await TdbcTemplate.query<{ head_version: number }>(this.conn, this.parser, VfsEntrySql.selectHeadVersionByPath, { scopeKey, path: normalized });
    return Result.ok({ version: Number(rows[0]!.head_version) });
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.setHeadContentHash 端口方法；内联会把头指针更新 SQL 搬进调用层。 */
  async setHeadContentHash(scopeKey: string, path: string, input: {
      version: number;
      contentHash: string;
      mtimeMs: number;
    }): Promise<Result<void, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const existing = await TdbcTemplate.query<{ entry_id: number }>(this.conn, this.parser, VfsEntrySql.selectEntryIdByPath, { scopeKey, path: normalized });

    if (existing.length > 0) {
      await TdbcTemplate.execute(this.conn, this.parser, VfsEntrySql.setHeadContentHash, {
        scopeKey,
        path: normalized,
        contentHash: input.contentHash,
        version: input.version,
        mtimeMs: input.mtimeMs,
      });
      return Result.ok(undefined);
    }

    await TdbcTemplate.execute(this.conn, this.parser, VfsEntrySql.setHeadContentHashInsert, {
      scopeKey,
      path: normalized,
      contentHash: input.contentHash,
      version: input.version,
      mtimeMs: input.mtimeMs,
    });
    return Result.ok(undefined);
  }

  async delete(scopeKey: string, path: string, options: VfsDeleteOptions): Promise<Result<number, AppError>> {
    const resolved = PathNormalizer.normalize(path);
    if (!resolved.ok) return Result.err(resolved.error);
    const normalized = resolved.value;
    const pattern = childLikePattern(normalized);

    if (!options.recursive) {
      const childRows = await TdbcTemplate.query(this.conn, this.parser, VfsEntrySql.deleteChildProbe, { scopeKey, pattern, path: normalized });
      if (childRows.length > 0) {
        return Result.err(new AppError("VFS_DIRECTORY_NOT_EMPTY", { path: normalized, detail: `Directory not empty: ${normalized}` }));
      }

      const result = await TdbcTemplate.execute(this.conn, this.parser, VfsEntrySql.deleteExact, { scopeKey, path: normalized });
      if (result.changes === 0) {
        return Result.err(new AppError("VFS_NOT_FOUND", { path: normalized, detail: `Path not found: ${normalized}` }));
      }
      return Result.ok(result.changes);
    }

    const result = await TdbcTemplate.execute(this.conn, this.parser, VfsEntrySql.deleteRecursive, { scopeKey, path: normalized, pattern });
    if (result.changes === 0) {
      return Result.err(new AppError("VFS_NOT_FOUND", { path: normalized, detail: `Path not found: ${normalized}` }));
    }
    return Result.ok(result.changes);
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.deleteRecursiveIfAny 端口方法；内联会把探测 + 批量删除 SQL 搬进调用层。 */
  async deleteRecursiveIfAny(scopeKey: string, prefix: string): Promise<Result<number, AppError>> {
    // 先探测：prefix 下无任何 entry 时静默返回 0，避免 recursive:true 分支的 vfsNotFound。
    const base = Path.stripTrailingSlash(prefix);
    const entries = await this.listEntriesUnderPrefix(scopeKey, base);
    if (entries.length === 0) {
      return Result.ok(0);
    }
    // base 为空串时 PathNormalizer.normalize 会判 INVALID_PATH；空串与根 "/" 在 childLikePattern 下
    // 都匹配 "/%"（即全部以 / 开头的路径），语义等价，这里用 "/" 替代空串。
    const deletePath = base === "" ? "/" : base;
    // delete() 现在透出 changes（实际删除行数），比之前返回探测命中数更准——
    // 探测与删除在同一 scope+prefix 内，两者通常一致，但用真实 changes 避免「探测与删除之间
    // 出现并发写入」这类极端情况下的偏差。
    const deleted = await this.delete(scopeKey, deletePath, { recursive: true });
    if (!deleted.ok) return deleted;
    return Result.ok(deleted.value);
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.listAllPaths 端口方法；内联会把查询 SQL 搬进调用层。 */
  async listAllPaths(scopeKey: string): Promise<string[]> {
    const rows = await TdbcTemplate.query<{ path: string }>(this.conn, this.parser, VfsEntrySql.listAllPaths, { scopeKey });
    return rows.map((row) => String(row.path));
  }

  async listDirectoryPathsUnderPrefix(scopeKey: string, pathPrefix: string): Promise<string[]> {
    const base = Path.stripTrailingSlash(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await TdbcTemplate.query<{ path: string }>(this.conn, this.parser, VfsEntrySql.listDirectoryPathsUnderPrefix, { scopeKey, path: base, pattern });
    return rows.map((row) => String(row.path));
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.listDirectoryMetaUnderPrefix 端口方法；内联会把前缀扫描 SQL 搬进调用层。 */
  async listDirectoryMetaUnderPrefix(scopeKey: string, pathPrefix: string): Promise<ReadonlyArray<{ path: string; mtimeMs: number }>> {
    const base = Path.stripTrailingSlash(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await TdbcTemplate.query<{ path: string; mtime_ms: number }>(this.conn, this.parser, VfsEntrySql.listDirectoryMetaUnderPrefix, { scopeKey, path: base, pattern });
    return rows.map((row) => ({
      path: String(row.path),
      mtimeMs: Number(row.mtime_ms),
    }));
  }

  async listEntriesUnderPrefix(scopeKey: string, pathPrefix: string): Promise<VfsListEntry[]> {
    const base = Path.stripTrailingSlash(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await TdbcTemplate.query<{ path: string; entry_kind: string }>(this.conn, this.parser, VfsEntrySql.listEntriesUnderPrefix, { scopeKey, path: base, pattern });
    return rows.map((row) => ({
      path: String(row.path),
      kind: row.entry_kind === "directory" ? "directory" : "file",
    }));
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.listFileMetaUnderPrefix 端口方法；内联会把前缀扫描 SQL 搬进调用层。 */
  async listFileMetaUnderPrefix(scopeKey: string, pathPrefix: string): Promise<ReadonlyArray<{ path: string; mtimeMs: number }>> {
    const base = Path.stripTrailingSlash(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await TdbcTemplate.query<{ path: string; mtime_ms: number }>(this.conn, this.parser, VfsEntrySql.listFileMetaUnderPrefix, { scopeKey, path: base, pattern });
    return rows.map((row) => ({
      path: String(row.path),
      mtimeMs: Number(row.mtime_ms),
    }));
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.computeEntrySignature 端口方法；内联会把聚合签名 SQL 搬进调用层。 */
  async computeEntrySignature(scopeKey: string): Promise<string> {
    const rows = await TdbcTemplate.query<{ entry_count: number; sig: string | null }>(this.conn, this.parser, VfsEntrySql.computeEntrySignature, { scopeKey });
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
    const base = Path.stripTrailingSlash(pathPrefix);
    const pattern = childLikePattern(base);
    const rows = await TdbcTemplate.query<{ entry_id: number; path: string; head_version: number; mtime_ms: number }>(this.conn, this.parser, VfsEntrySql.listFileHeadsUnderPrefix, { scopeKey, path: base, pattern });
    return rows.map((row) => ({
      entryId: Number(row.entry_id),
      path: String(row.path),
      headVersion: Number(row.head_version),
      mtimeMs: Number(row.mtime_ms),
    }));
  }

  async scanContents(scopeKey: string, pathPrefix?: string): Promise<
    Result<
      ReadonlyArray<{
        entryId: number;
        path: string;
        content: string;
      }>,
      AppError
    >
  > {
    if (pathPrefix == null) {
      const rows = await TdbcTemplate.query<{ entry_id: number; path: string; content_hash: string | null }>(this.conn, this.parser, VfsEntrySql.scanContents, { scopeKey });
      return this.resolveScanRows(rows);
    }

    const resolved = PathNormalizer.normalize(pathPrefix);
    if (!resolved.ok) return Result.err(resolved.error);
    const base = resolved.value;
    const pattern = childLikePattern(base);
    const rows = await TdbcTemplate.query<{ entry_id: number; path: string; content_hash: string | null }>(this.conn, this.parser, VfsEntrySql.scanContentsUnderPrefix, { scopeKey, path: base, pattern });
    return this.resolveScanRows(rows);
  }

  async scanFileEntriesWithMeta(scopeKey: string, pathPrefix?: string): Promise<
    Result<
      ReadonlyArray<{
        entryId: number;
        path: string;
        contentHash: string | null;
        headVersion: number;
        mtimeMs: number;
      }>,
      AppError
    >
  > {
    if (pathPrefix == null) {
      const rows = await TdbcTemplate.query<{ entry_id: number; path: string; content_hash: string | null; head_version: number; mtime_ms: number }>(this.conn, this.parser, VfsEntrySql.scanFileEntriesWithMeta, { scopeKey });
      return Result.ok(rows.map((r) => ({
        entryId: r.entry_id,
        path: r.path,
        contentHash: Coerce.nullableText(r.content_hash),
        headVersion: r.head_version,
        mtimeMs: r.mtime_ms,
      })));
    }

    const resolved = PathNormalizer.normalize(pathPrefix);
    if (!resolved.ok) return Result.err(resolved.error);
    const base = resolved.value;
    const pattern = childLikePattern(base);
    const rows = await TdbcTemplate.query<{ entry_id: number; path: string; content_hash: string | null; head_version: number; mtime_ms: number }>(this.conn, this.parser, VfsEntrySql.scanFileEntriesWithMetaUnderPrefix, { scopeKey, path: base, pattern });
    return Result.ok(rows.map((r) => ({
      entryId: r.entry_id,
      path: r.path,
      contentHash: Coerce.nullableText(r.content_hash),
      headVersion: r.head_version,
      mtimeMs: r.mtime_ms,
    })));
  }

  async findExistingPaths(scopeKey: string, paths: ReadonlyArray<string>): Promise<Result<Set<string>, AppError>> {
    const result = new Set<string>();
    if (paths.length === 0) {
      return Result.ok(result);
    }
    const normalizedValues: string[] = [];
    for (const p of paths) {
      const resolved = PathNormalizer.normalize(p);
      if (!resolved.ok) return Result.err(resolved.error);
      normalizedValues.push(resolved.value);
    }
    const normalized = [...new Set(normalizedValues)];
    const chunkSize = 200;
    for (let offset = 0; offset < normalized.length; offset += chunkSize) {
      const chunk = normalized.slice(offset, offset + chunkSize);
      const rows = await TdbcTemplate.query<{ path: string }>(this.conn, this.parser, VfsEntrySql.findExistingPaths, { scopeKey, paths: chunk });
      for (const row of rows) {
        result.add(String(row.path));
      }
    }
    return Result.ok(result);
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.batchInsertFileEntriesWithHash 端口方法；内联会把批量 INSERT 搬进调用层。 */
  async batchInsertFileEntriesWithHash(scopeKey: string, entries: ReadonlyArray<{
      path: string;
      contentHash: string;
      mtimeMs: number;
    }>): Promise<Result<void, AppError>> {
    if (entries.length === 0) return Result.ok(undefined);
    const paramsList: unknown[][] = [];
    for (const e of entries) {
      const resolved = PathNormalizer.normalize(e.path);
      if (!resolved.ok) return Result.err(resolved.error);
      paramsList.push([scopeKey, resolved.value, e.contentHash, e.mtimeMs]);
    }
    await this.conn.batch(VfsEntrySql.batchInsertFileEntriesWithHash, paramsList);
    return Result.ok(undefined);
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.batchInsertDirectoryEntries 端口方法；内联会把批量 INSERT 搬进调用层。 */
  async batchInsertDirectoryEntries(scopeKey: string, paths: ReadonlyArray<string>): Promise<Result<void, AppError>> {
    if (paths.length === 0) return Result.ok(undefined);
    const now = Date.now();
    const paramsList: unknown[][] = [];
    for (const p of paths) {
      const resolved = PathNormalizer.normalize(p);
      if (!resolved.ok) return Result.err(resolved.error);
      paramsList.push([scopeKey, resolved.value, now]);
    }
    await this.conn.batch(VfsEntrySql.batchInsertDirectoryEntries, paramsList);
    return Result.ok(undefined);
  }

  private async resolveScanRows(rows: ReadonlyArray<{
      entry_id: number;
      path: string;
      content_hash: string | null;
    }>): Promise<Result<ReadonlyArray<{ entryId: number; path: string; content: string }>, AppError>> {
    // 先收集所有非空 content_hash，一次 getMany 批量读取，避免逐条 get 的 N+1。
    const hashes = new Set<string>();
    for (const row of rows) {
      const h = Coerce.nullableText(row.content_hash);
      if (h != null && h.length > 0) {
        hashes.add(h);
      }
    }
    let contentMap = new Map<string, string>();
    if (hashes.size > 0) {
      const loaded = await this.contentStore.getMany([...hashes]);
      if (!loaded.ok) return Result.err(loaded.error);
      contentMap = loaded.value;
    }

    const out: Array<{ entryId: number; path: string; content: string }> = [];
    for (const row of rows) {
      const h = Coerce.nullableText(row.content_hash);
      let plain: string;
      if (h != null && h.length > 0) {
        // scanContents 这条路径只查 entry_kind='file' 的行，正文从 blob 读。
        const cached = contentMap.get(h);
        if (cached == null) {
          return Result.err(new AppError("VFS_CONTENT_BLOB_MISSING", { detail: `vfs_content_blob 缺失: ${h}`, contentHash: h }));
        }
        plain = cached;
      } else {
        // content=NULL 且 content_hash=NULL 的 active 文件行视为正文损坏。
        return Result.err(new AppError("VFS_CONTENT_CORRUPT", { detail: "vfs 正文损坏：active 文件 content 与 content_hash 均为 NULL" }));
      }
      out.push({
        entryId: Number(row.entry_id),
        path: String(row.path),
        content: plain,
      });
    }
    return Result.ok(out);
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.renamePathInScope 端口方法；内联会把事务内改名 SQL 搬进调用层。 */
  async renamePathInScope(tx: TdbcConnection, scopeKey: string, oldPath: string, newPath: string): Promise<Result<void, AppError>> {
    const oldResolved = PathNormalizer.normalize(oldPath);
    if (!oldResolved.ok) return Result.err(oldResolved.error);
    const newResolved = PathNormalizer.normalize(newPath);
    if (!newResolved.ok) return Result.err(newResolved.error);
    const oldNorm = oldResolved.value;
    const newNorm = newResolved.value;
    const parser = this.parser;
    const result = await TdbcTemplate.execute(tx, parser, VfsEntrySql.renamePathInScope, { scopeKey, oldPath: oldNorm, newPath: newNorm });
    if (result.changes === 0) {
      return Result.err(new AppError("VFS_NOT_FOUND", { path: oldNorm, detail: `Path not found: ${oldNorm}` }));
    }
    return Result.ok(undefined);
  }

  /** nm-style: keep-public — 实现 VfsEntryRepository.renamePrefixInScope 端口方法；内联会把前缀重命名两条 UPDATE 搬进调用层。 */
  async renamePrefixInScope(tx: TdbcConnection, scopeKey: string, oldPrefix: string, newPrefix: string): Promise<void> {
    const oldBase = Path.stripTrailingSlash(oldPrefix);
    const newBase = Path.stripTrailingSlash(newPrefix);
    const parser = this.parser;
    // 目录前缀重命名：把 `oldBase/...` 整体替换成 `newBase/...`；含 oldBase 自身。
    // 必须用「剥定长前缀 + 拼新前缀」的定点写法（substr），**不能用 REPLACE**：
    // REPLACE 替换整串中出现的所有匹配，子树内部再出现一次同名目录时深层那一段
    // 会被二次替换（/a → /a_新 且子树含 a/sub/a/notes.md ⇒ 错成 a_新/sub/a_新/notes.md），
    // 文件被静默搬到磁盘上不存在的路径，用户再也点不到。
    const renameBindings = {
      scopeKey,
      oldWithSlash: `${oldBase}/`,
      newWithSlash: `${newBase}/`,
      pattern: `${ScopePrefix.escapeLike(oldBase)}/%`,
    };
    const result = await TdbcTemplate.execute(tx, parser, VfsEntrySql.renamePrefixInScope, renameBindings);
    // 处理前缀根自身（oldBase → newBase）。
    const rootResult = await TdbcTemplate.execute(tx, parser, VfsEntrySql.renamePrefixInScopeRoot, { scopeKey, oldBase, newBase });
    if (result.changes === 0 && rootResult.changes === 0) {
      // 子项与目录根都不存在（幽灵路径）时维持 NOT_FOUND。
      // 允许空目录（无子项）：根自身已被上面这条 UPDATE 改到新路径
      // （rootResult.changes === 1）即算成功，不能再按旧路径 SELECT 复核——
      // 根已改名，旧路径必然查不到。
      // nm-throw: keep — port 契约锁定：vfs-entry.port.ts renamePrefixInScope 声明 Promise<void>；改 Result
      // 需同波动 port 与 vfs-rename-primitive（跨分片）；throw 在事务回调内驱动回滚，方法边界转码 Result。
      throw new AppError("VFS_NOT_FOUND", { path: oldBase, detail: `Path not found: ${oldBase}` });
    }
  }
}
