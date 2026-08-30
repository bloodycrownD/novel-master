/**
 * VFS capability port and DTOs (domain contract for tools, CLI, and service impl).
 *
 * @module domain/vfs/ports/vfs-service.port
 *
 * @remarks
 * Implemented by {@link DefaultVfsService} / {@link ScopedVfsService} in service layer.
 * Builtin tools and external consumers depend on this port only — not on `service/vfs`.
 */

import type { VfsEntryKind } from "../model/vfs-entry.js";
import type { VfsListEntry } from "../model/vfs-list-entry.js";
import type { VfsGrepOptions } from "../logic/vfs-grep.js";

export type { VfsEntryKind, VfsListEntry };

/** Result of reading a single path. */
export interface VfsReadResult {
  readonly path: string;
  readonly content: string;
  readonly version: number;
  readonly mtimeMs: number;
}

/** Options for write operations. */
export interface WriteOptions {
  readonly expectedVersion?: number;
  readonly versionCheck?: boolean;
}

/** A single grep match with line/column position. */
export interface VfsGrepMatch {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly excerpt: string;
}

export type { VfsGrepMatchMode, VfsGrepOptions } from "../logic/vfs-grep.js";

/**
 * Virtual file system capability (read/write/list/glob/grep/delete/mkdir).
 *
 * @remarks
 * Scoping (global / project / session paths) is applied by scoped service wrappers;
 * callers inject the appropriate instance (e.g. session-scoped for agent tools).
 */
export interface VfsService {
  list(
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number }
  ): Promise<VfsListEntry[]>;

  mkdir(path: string): Promise<void>;

  read(path: string): Promise<VfsReadResult>;

  write(
    path: string,
    content: string,
    options?: WriteOptions
  ): Promise<{ version: number }>;

  replace(
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean }
  ): Promise<{ version: number; replacements: number }>;

  glob(pattern: string, options?: { cwd?: string }): Promise<string[]>;

  grep(pattern: string, options?: VfsGrepOptions): Promise<VfsGrepMatch[]>;

  delete(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * 失败补偿：将 live head 拨回指定 revision，不 append、不 bump。
   *
   * @remarks
   * revision 缺失或 `status='deleted'` 时明确抛错。
   * live entry 不存在时按该 revision 重建（含父目录），禁止走 `write` 注水。
   */
  resetHeadToVersion(path: string, version: number): Promise<void>;

  /**
   * 失败补偿：物理删除 entry（及约定子树），不 append `deleted` 墓碑 revision。
   */
  hardDelete(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * 单文件重命名/移动（单事务 UPDATE entry_path，不写 revision/checkpoint）。
   *
   * @remarks
   * 是 rename 还是目录内部移动由服务端实现根据路径前缀判断：
   * 同目录改名 = rename；跨目录移动 = rename + 路径前缀变更。
   * 底层统一走 `renameVfsEntry` 原语，entry_id 不变。
   *
   * @throws 目标路径已存在时抛 ALREADY_EXISTS（需调用方先校验或传 options.overwrite）
   * @throws `DefaultVfsService` 下抛 unsupported
   */
  renamePath(
    from: string,
    to: string,
    options?: { overwrite?: boolean }
  ): Promise<void>;

  /**
   * 目录前缀批量重命名（单事务 UPDATE 全部子路径，不写 revision/checkpoint）。
   *
   * @remarks
   * 底层统一走 `renamePrefixInScope` 原语，包含目录根自身及所有子孙的 path 替换。
   * 调用方保证 oldDir 和 newDir 归一化（无尾斜杠）。
   *
   * @throws 旧目录不存在时抛 NOT_FOUND
   * @throws `DefaultVfsService` 下抛 unsupported
   */
  renamePrefix(oldDir: string, newDir: string): Promise<void>;
}
