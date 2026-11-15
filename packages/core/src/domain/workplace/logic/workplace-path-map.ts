/**
 * Project ↔ session workplace logical path mapping.
 *
 * @module domain/workplace/workplace-path-map
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";

/**
 * Maps a project template logical path to session scope (identity after unified root).
  * 解包 throw 边界（错误通道迁移三期门⑦）：normalizePath 失败按迁移前形态上抛（mapSessionWorkplacePathToProject 同款），由调用链端点 catch 收口。
 */
export function mapProjectWorkplacePathToSession(logical: string): string {
  const resolved = normalizePath(logical);
  if (!resolved.ok) throw resolved.error;
  return resolved.value;
}

/**
 * Maps a session logical path back to project template scope (identity).
 */
export function mapSessionWorkplacePathToProject(logical: string): string {
  const resolved = normalizePath(logical);
  if (!resolved.ok) throw resolved.error;
  return resolved.value;
}
