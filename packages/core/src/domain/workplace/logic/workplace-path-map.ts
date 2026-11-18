/**
 * Project ↔ session workplace logical path mapping.
 *
 * @module domain/workplace/workplace-path-map
 */

import { PathNormalizer } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/**
 * Maps a project template logical path to session scope (identity after unified root).
  * 解包接力（错误通道迁移四期门⑦）：PathNormalizer.normalize 失败沿返回值通道原样上交（mapSessionWorkplacePathToProject 同款），决定权交给调用方。
 */
export function mapProjectWorkplacePathToSession(logical: string): Result<string, AppError> {
  const resolved = PathNormalizer.normalize(logical);
  if (!resolved.ok) return Result.err(resolved.error);
  return Result.ok(resolved.value);
}

/**
 * Maps a session logical path back to project template scope (identity).
 */
export function mapSessionWorkplacePathToProject(logical: string): Result<string, AppError> {
  const resolved = PathNormalizer.normalize(logical);
  if (!resolved.ok) return Result.err(resolved.error);
  return Result.ok(resolved.value);
}
