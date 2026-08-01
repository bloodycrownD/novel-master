/**
 * VFS entry repository port (core-internal).
 *
 * entry_id 化后所有点查询 / 变更方法都带 `scopeKey` 首参，SQL 统一
 * `WHERE scope_key = ? AND path = ?`；前缀扫描统一
 * `WHERE scope_key = ? AND (path = ? OR path LIKE ?||'/%')`。`entry_id` 由
 * DB AUTOINCREMENT 生成，读回后挂在 {@link VfsEntry.entryId} 上。
 *
 * @module domain/vfs/repositories/vfs-entry.port
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { VfsEntry } from "../model/vfs-entry.js";
import type { VfsListEntry } from "../model/vfs-list-entry.js";
import type {
  VfsDeleteOptions,
  VfsListOptions,
  VfsWriteRepoOptions,
} from "../model/vfs-options.js";

/**
 * Persistence contract for vfs_entry rows. Implemented by SQLite adapter only.
 */
export interface VfsEntryRepository {
  list(
    scopeKey: string,
    dir: string,
    options?: VfsListOptions,
  ): Promise<VfsListEntry[]>;

  findByPath(scopeKey: string, path: string): Promise<VfsEntry | null>;

  /**
   * 读取文件行的 `content_hash`（不解正文）。
   *
   * @returns 目录行 / 无 hash / 路径不存在时为 `null`
   */
  findContentHash(scopeKey: string, path: string): Promise<string | null>;

  /**
   * 批量读取文件行的 `content_hash`（不解正文）。
   *
   * @returns 键为规范化逻辑 path；目录行 / 无 hash / 路径不存在时值为 `null`
   */
  findContentHashesByPaths(
    scopeKey: string,
    paths: ReadonlyArray<string>,
  ): Promise<Map<string, string | null>>;

  insert(
    scopeKey: string,
    path: string,
    content: string,
  ): Promise<{ version: number }>;

  /**
   * 以已有 content_hash 插入文件行（不 put；`content=NULL`）。
   *
   * @remarks tree-copy / seed 共享 blob 时使用。
   */
  insertWithContentHash(
    scopeKey: string,
    path: string,
    contentHash: string,
  ): Promise<{ version: number }>;

  /**
   * Inserts a new file entry at an explicit head version.
   *
   * @remarks Used when re-creating a path whose vfs_entry was removed but revision history remains.
   */
  insertAtVersion(
    scopeKey: string,
    path: string,
    content: string,
    version: number,
  ): Promise<{ version: number }>;

  insertDirectory(scopeKey: string, path: string): Promise<void>;

  update(
    scopeKey: string,
    path: string,
    content: string,
    options: VfsWriteRepoOptions,
  ): Promise<{ version: number }>;

  /**
   * 以已有 content_hash 更新文件行（不 put；`content=NULL`）。
   */
  updateWithContentHash(
    scopeKey: string,
    path: string,
    contentHash: string,
    options: VfsWriteRepoOptions,
  ): Promise<{ version: number }>;

  /**
   * 不升版写回 live head（补偿专用）。
   *
   * @remarks
   * entry 已存在 → 按指定 version / content_hash / mtime 写回，不 `version+1`；
   * entry 不存在 → 按指定 version + content_hash 插入（`content=NULL`）。
   * 禁止补偿路径复用会 bump 的 {@link update}。
   */
  setHeadContentHash(
    scopeKey: string,
    path: string,
    input: {
      version: number;
      contentHash: string;
      mtimeMs: number;
    },
  ): Promise<void>;

  delete(scopeKey: string, path: string, options: VfsDeleteOptions): Promise<void>;

  /** scope 下所有文件路径（glob 用）。 */
  listAllPaths(scopeKey: string): Promise<string[]>;

  listDirectoryPathsUnderPrefix(
    scopeKey: string,
    pathPrefix: string,
  ): Promise<string[]>;

  listEntriesUnderPrefix(
    scopeKey: string,
    pathPrefix: string,
  ): Promise<VfsListEntry[]>;

  /** Lists file paths and mtimes under a prefix without reading `content`. */
  listFileMetaUnderPrefix(
    scopeKey: string,
    pathPrefix: string,
  ): Promise<ReadonlyArray<{ path: string; mtimeMs: number }>>;

  /**
   * Lists live file heads under a scope + logical path prefix
   * (for checkpoint capture / GC)。
   */
  listFileHeadsUnderPrefix(
    scopeKey: string,
    pathPrefix: string,
  ): Promise<
    ReadonlyArray<{
      entryId: number;
      path: string;
      headVersion: number;
      mtimeMs: number;
    }>
  >;

  scanContents(
    scopeKey: string,
    pathPrefix?: string,
  ): Promise<
    ReadonlyArray<{
      entryId: number;
      path: string;
      content: string;
    }>
  >;

  /**
   * 单事务内重命名单个 entry 的逻辑路径（entry_id 不变，历史 revision 零操作）。
   *
   * @remarks 需在调用方事务的连接上执行。
   */
  renamePathInScope(
    tx: TdbcConnection,
    scopeKey: string,
    oldPath: string,
    newPath: string,
  ): Promise<void>;

  /**
   * 单事务内批量重命名目录前缀下所有子 entry（`REPLACE(path, old||'/', new||'/')`）。
   *
   * @remarks 需在调用方事务的连接上执行。
   */
  renamePrefixInScope(
    tx: TdbcConnection,
    scopeKey: string,
    oldPrefix: string,
    newPrefix: string,
  ): Promise<void>;

  /**
   * 扫描 scope + 前缀下所有文件 entry 的元数据（不解正文）。
   *
   * @returns 包含 entryId, path, contentHash, headVersion, mtimeMs 的列表
   */
  scanFileEntriesWithMeta(
    scopeKey: string,
    pathPrefix?: string,
  ): Promise<
    ReadonlyArray<{
      entryId: number;
      path: string;
      contentHash: string | null;
      headVersion: number;
      mtimeMs: number;
    }>
  >;

  /** 批量检查哪些路径在指定 scope 下已存在（文件或目录行）。 */
  findExistingPaths(
    scopeKey: string,
    paths: ReadonlyArray<string>,
  ): Promise<Set<string>>;

  /**
   * 批量插入文件 entry（共享 blob，content=NULL）。
   *
   * @remarks 每条 entry 的 head_version 固定为 1（tree-copy 新建场景）。
   * 使用 conn.batch 在一个原生调用内完成所有 INSERT。
   */
  batchInsertFileEntriesWithHash(
    scopeKey: string,
    entries: ReadonlyArray<{
      path: string;
      contentHash: string;
      mtimeMs: number;
    }>,
  ): Promise<void>;

  /** 批量插入目录 entry（head_version=1, content_hash=NULL）。 */
  batchInsertDirectoryEntries(
    scopeKey: string,
    paths: ReadonlyArray<string>,
  ): Promise<void>;
}

/** re-export entry kind type for impl convenience. */
export type { VfsEntryKind } from "../model/vfs-entry.js";
