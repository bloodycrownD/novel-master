/**
 * 用户 VFS flush 终态 diff 的工作区快照类型与目录推导。
 *
 * @module domain/chat/logic/workspace-flush-snapshot
 */

import { parentDir } from "@/domain/vfs/logic/parent-dir.js";

/** checkpoint 基准或当前会话工作区的文件树 + 目录集。 */
export type WorkspaceFlushSnapshot = {
  readonly fileTree: Map<string, number>;
  readonly dirPaths: Set<string>;
};

/** 空快照（无 checkpoint 或无文件时的 baseline）。 */
export function emptyWorkspaceFlushSnapshot(): WorkspaceFlushSnapshot {
  return {
    fileTree: new Map(),
    dirPaths: new Set(),
  };
}

/**
 * 从文件路径集合推导父目录链（不含根 `/`）。
 *
 * @remarks checkpoint 不存空目录；baseline 目录集仅由此推导。
 */
export function deriveDirPathsFromFileTree(
  fileTree: ReadonlyMap<string, number>,
): Set<string> {
  const dirs = new Set<string>();
  for (const filePath of fileTree.keys()) {
    let current = parentDir(filePath);
    while (current !== "/") {
      dirs.add(current);
      current = parentDir(current);
    }
  }
  return dirs;
}
