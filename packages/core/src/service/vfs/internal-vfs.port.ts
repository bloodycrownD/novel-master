/**
 * core-internal VFS service 契约：每个 path 入参前都带 `scopeKey`，path 为纯逻辑路径。
 *
 * 这是 {@link ScopedVfsService} 与其 inner 之间的接线契约，让 scopeKey 能一路透传到
 * entry repo 的每一条点查询，避免 `vfs_entry` 改 `UNIQUE(scope_key, path)` 后跨 scope
 * 同名 path 随机命中。**只在 core 内部 export**，不进 domain/ports，不污染 apps 层的
 * {@link VfsService} 契约。
 *
 * @module service/vfs/internal-vfs.port
 */

import type {
  VfsGrepMatch,
  VfsGrepOptions,
  VfsListEntry,
  VfsReadResult,
  WriteOptions,
} from "@/domain/vfs/ports/vfs-service.port.js";

/**
 * scopeKey + 纯逻辑路径 版本的 VFS service。
 *
 * `renamePath` / `renamePrefix` 也在此接口声明（Step 7 接通具体实现）。
 */
export interface InternalVfsService {
  list(
    scopeKey: string,
    dir: string,
    options?: { recursive?: boolean; maxDepth?: number }
  ): Promise<VfsListEntry[]>;

  mkdir(scopeKey: string, path: string): Promise<void>;

  read(scopeKey: string, path: string): Promise<VfsReadResult>;

  write(
    scopeKey: string,
    path: string,
    content: string,
    options?: WriteOptions
  ): Promise<{ version: number }>;

  replace(
    scopeKey: string,
    path: string,
    oldString: string,
    newString: string,
    options?: { replaceAll?: boolean }
  ): Promise<{ version: number; replacements: number }>;

  glob(
    scopeKey: string,
    pattern: string,
    options?: { cwd?: string }
  ): Promise<string[]>;

  grep(
    scopeKey: string,
    pattern: string,
    options?: VfsGrepOptions
  ): Promise<VfsGrepMatch[]>;

  delete(
    scopeKey: string,
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void>;

  resetHeadToVersion(
    scopeKey: string,
    path: string,
    version: number
  ): Promise<void>;

  hardDelete(
    scopeKey: string,
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void>;

  /** 单文件 rename（Step 7 接通具体实现）。 */
  renamePath(
    scopeKey: string,
    fromLogical: string,
    toLogical: string,
    options?: { overwrite?: boolean }
  ): Promise<void>;

  /** 目录前缀批量 rename（Step 7 接通具体实现）。 */
  renamePrefix(
    scopeKey: string,
    oldDirLogical: string,
    newDirLogical: string
  ): Promise<void>;
}

/** re-export service DTOs for impl convenience. */
export type {
  VfsGrepMatch,
  VfsGrepOptions,
  VfsListEntry,
  VfsReadResult,
  WriteOptions,
};
