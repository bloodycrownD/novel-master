/**
 * VFS entry repository port (core-internal).
 *
 * @module domain/vfs/repositories/vfs-entry.port
 */

import type { VfsEntry, VfsStorageKind } from "../model/vfs-entry.js";
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
  list(dir: string, options?: VfsListOptions): Promise<VfsListEntry[]>;

  findByPath(path: string): Promise<VfsEntry | null>;

  /**
   * 读取文件行的 `content_hash`（不解正文）。
   *
   * @returns 目录行 / 无 hash / 路径不存在时为 `null`
   */
  findContentHash(path: string): Promise<string | null>;

  /**
   * 批量读取文件行的 `content_hash`（不解正文）。
   *
   * @returns 键为规范化物理 path；目录行 / 无 hash / 路径不存在时值为 `null`
   */
  findContentHashesByPaths(
    paths: ReadonlyArray<string>,
  ): Promise<Map<string, string | null>>;

  insert(path: string, content: string): Promise<{ version: number }>;

  /**
   * 以已有 content_hash 插入文件行（不 put；`content=NULL`）。
   *
   * @remarks tree-copy / seed 共享 blob 时使用。
   */
  insertWithContentHash(
    path: string,
    contentHash: string,
  ): Promise<{ version: number }>;

  /**
   * Inserts a new file entry at an explicit head version.
   *
   * @remarks Used when re-creating a path whose vfs_entry was removed but revision history remains.
   */
  insertAtVersion(
    path: string,
    content: string,
    version: number,
  ): Promise<{ version: number }>;

  insertDirectory(path: string): Promise<void>;

  update(
    path: string,
    content: string,
    options: VfsWriteRepoOptions,
  ): Promise<{ version: number }>;

  /**
   * 以已有 content_hash 更新文件行（不 put；`content=NULL`）。
   */
  updateWithContentHash(
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
    path: string,
    input: {
      version: number;
      contentHash: string;
      mtimeMs: number;
    },
  ): Promise<void>;

  delete(path: string, options: VfsDeleteOptions): Promise<void>;

  listAllPaths(): Promise<string[]>;

  listDirectoryPathsUnderPrefix(physicalPrefix: string): Promise<string[]>;

  listEntriesUnderPrefix(prefix: string): Promise<VfsListEntry[]>;

  /** Lists file paths and mtimes under a prefix without reading `content`. */
  listFileMetaUnderPrefix(physicalPrefix: string): Promise<
    ReadonlyArray<{ path: string; mtimeMs: number }>
  >;

  /** Lists live file heads under a physical prefix (for checkpoint capture / GC). */
  listFileHeadsUnderPrefix(physicalPrefix: string): Promise<
    ReadonlyArray<{ path: string; headVersion: number }>
  >;

  scanContents(pathPrefix?: string): Promise<
    ReadonlyArray<{
      path: string;
      content: string;
      storageKind: VfsStorageKind;
    }>
  >;
}
