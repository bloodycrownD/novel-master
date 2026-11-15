/**
 * Minimal VFS port for checkpoint restore (domain layer).
 *
 * 错误通道迁移四期：与 {@link VfsService} 同为 `Result<T, AppError>` 形态，
 * 已知失败走 `Result.err`、基础设施故障由实现层 throw（事务回调内靠抛错回滚）。
 *
 * @module domain/vfs/ports/vfs-restore.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { VfsReadResult } from "./vfs-service.port.js";

/** Subset of {@link VfsService} used by message-checkpoint restore logic. */
export interface VfsRestorePort {
  mkdir(path: string): Promise<Result<void, AppError>>;
  read(path: string): Promise<Result<VfsReadResult, AppError>>;
  write(path: string, content: string): Promise<Result<{ version: number }, AppError>>;
  delete(path: string): Promise<Result<void, AppError>>;

  /**
   * 将 live head 拨回指定 version（不 append、不 bump）。
   *
   * @remarks restore-path 走 resetHead 语义替代 write 注水。
   */
  resetHeadToVersion(path: string, version: number): Promise<Result<void, AppError>>;
}
