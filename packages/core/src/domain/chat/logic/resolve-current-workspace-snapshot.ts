/**
 * 解析当前会话工作区快照：live 文件头 + 空目录列表。
 *
 * @module domain/chat/logic/resolve-current-workspace-snapshot
 */

import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import {
  scopePhysicalPrefix,
  toLogicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { WorkspaceFlushSnapshot } from "./workspace-flush-snapshot.js";

/**
 * 读取会话工作区当前终态：文件 head 版本 map + `listDirectoryPathsUnderPrefix` 目录集。
 */
export async function resolveCurrentWorkspaceSnapshot(
  vfs: VfsEntryRepository,
  projectId: string,
  sessionId: string,
): Promise<WorkspaceFlushSnapshot> {
  const scope: VfsScope = {
    kind: "session",
    projectId,
    sessionId,
  };
  const prefix = scopePhysicalPrefix(scope);
  const heads = await listSessionFileHeads(vfs, projectId, sessionId);
  const fileTree = new Map<string, number>(
    heads.map((head) => [head.logicalPath, head.headVersion]),
  );

  const physicalDirs = await vfs.listDirectoryPathsUnderPrefix(prefix);
  const dirPaths = new Set<string>(
    physicalDirs.map((physical) => toLogicalPath(scope, physical)),
  );

  return { fileTree, dirPaths };
}
