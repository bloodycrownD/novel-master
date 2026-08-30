/**
 * VFS rename 单事务原语（entry_id 化后 path 降级为可变列）。
 *
 * 文件 rename：单事务 UPDATE vfs_entry SET path = ? WHERE scope_key=? AND path=?
 * 目录 rename：单事务 REPLACE(path, oldDir, newDir) 批量更新子路径
 * entry_id 不变，revision/checkpoint 零操作。
 *
 * @module domain/vfs/logic/vfs-rename-primitive
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";

/**
 * 单事务内重命名单个 entry 的逻辑路径。
 *
 * @returns 影响行数
 * @throws 当旧路径不存在时由 repo.renamePathInScope 抛 NOT_FOUND
 */
export async function renameVfsEntry(
  tx: TdbcConnection,
  entryRepo: VfsEntryRepository,
  scopeKey: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  await entryRepo.renamePathInScope(tx, scopeKey, oldPath, newPath);
}

/**
 * 单事务内批量重命名目录前缀下所有子 entry。
 *
 * 子路径用 `REPLACE(path, oldBase||'/', newBase||'/')` 统一替换，
 * 再单独 UPDATE 目录根自身。entry_id 全部不变，revision/checkpoint 零操作。
 *
 * @throws 当旧目录前缀不存在时由 repo.renamePrefixInScope 抛 NOT_FOUND
 */
export async function renameVfsDirectory(
  tx: TdbcConnection,
  entryRepo: VfsEntryRepository,
  scopeKey: string,
  oldDir: string,
  newDir: string
): Promise<void> {
  await entryRepo.renamePrefixInScope(tx, scopeKey, oldDir, newDir);
}
