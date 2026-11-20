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
} from "@/domain/vfs/ports/vfs-service.port.js";
import type { VfsContentSize } from "@/domain/vfs/model/vfs-content-size.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/**
 * scopeKey + 纯逻辑路径 版本的 VFS service。
 *
 * `renamePath` / `renamePrefix` 也在此接口声明（Step 7 接通具体实现）。
 * 错误通道迁移四期：读取 / 路径校验 / 写入 / 删除 / rename 走返回值通道（`Result<T, AppError>`）；
 * `glob` 链上无解包点，暂维持原形态。
 */
export interface InternalVfsService {
  list(scopeKey: string, dir: string, options?: { recursive?: boolean; maxDepth?: number }): Promise<Result<VfsListEntry[], AppError>>;

  mkdir(scopeKey: string, path: string): Promise<Result<void, AppError>>;

  read(scopeKey: string, path: string): Promise<Result<VfsReadResult, AppError>>;

  /** 按路径轻量探测文件 content 大小（不解正文，供读取侧降级闸门使用）。 */
  findContentSize(scopeKey: string, path: string): Promise<Result<VfsContentSize | null, AppError>>;

  write(scopeKey: string, path: string, content: string): Promise<Result<{ version: number }, AppError>>;

  replace(scopeKey: string, path: string, oldString: string, newString: string, options?: { replaceAll?: boolean }): Promise<Result<{ version: number; replacements: number }, AppError>>;

  glob(scopeKey: string, pattern: string, options?: { cwd?: string }): Promise<string[]>;

  grep(scopeKey: string, pattern: string, options?: VfsGrepOptions): Promise<Result<VfsGrepMatch[], AppError>>;

  delete(scopeKey: string, path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>>;

  resetHeadToVersion(scopeKey: string, path: string, version: number): Promise<Result<void, AppError>>;

  hardDelete(scopeKey: string, path: string, options?: { recursive?: boolean }): Promise<Result<void, AppError>>;

  /** 单文件 rename（Step 7 接通具体实现）。 */
  renamePath(scopeKey: string, fromLogical: string, toLogical: string, options?: { overwrite?: boolean }): Promise<Result<void, AppError>>;

  /** 目录前缀批量 rename（Step 7 接通具体实现）。 */
  renamePrefix(scopeKey: string, oldDirLogical: string, newDirLogical: string): Promise<Result<void, AppError>>;
}

/** re-export service DTOs for impl convenience. */
export type {
  VfsGrepMatch,
  VfsGrepOptions,
  VfsListEntry,
  VfsReadResult,
  VfsContentSize,
};
