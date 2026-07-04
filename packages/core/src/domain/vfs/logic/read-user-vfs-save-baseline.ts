/**
 * 用户保存前读取磁盘 baseline（与 Desktop/Mobile FileEditor 对齐）。
 *
 * @module domain/vfs/logic/read-user-vfs-save-baseline
 */

import { isVfsError } from "@/errors/vfs-errors.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";

/**
 * 保存映射用的 baseline：读盘当前内容；新文件返回 null。
 *
 * @throws 非 NOT_FOUND 的 Vfs 错误原样抛出
 */
export async function readUserVfsSaveBaseline(
  vfs: VfsService,
  path: string,
): Promise<string | null> {
  try {
    const result = await vfs.read(path);
    return result.content;
  } catch (error: unknown) {
    if (isVfsError(error, "NOT_FOUND")) {
      return null;
    }
    throw error;
  }
}
