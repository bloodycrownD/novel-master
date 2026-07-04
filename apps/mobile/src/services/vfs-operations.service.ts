/**
 * VFS mutations for the file manager (create / delete / rename).
 */
import {
  type VfsListEntry,
  type VfsScope,
  type VfsService,
} from "@novel-master/core/vfs";
import { buildUserVfsCreateFileOp, buildUserVfsDeleteOp, buildUserVfsMkdirOp, buildUserVfsRenameOp, buildUserVfsSaveOp, moveVfsPath, readUserVfsSaveBaseline, remapPathUnderDir, type UserVfsSaveVersionOptions } from "@novel-master/core/vfs";
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {executeSessionUserVfsOp} from './user-vfs-turn-execute.service';
import {invalidateSessionWorktreeSnapshot} from './worktree-snapshot.service';

/** Create a new file (empty by default). */
export async function createVfsFile(
  vfs: VfsService,
  path: string,
  content = '',
): Promise<void> {
  await vfs.write(path, content, {versionCheck: false});
}

/** 会话 scope：新建文件经 userVfsTurn。 */
export async function sessionCreateVfsFile(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  path: string,
  content = '',
): Promise<void> {
  await executeSessionUserVfsOp(
    runtime,
    sessionId,
    buildUserVfsCreateFileOp(path, content),
  );
}

/** Create an empty directory node. */
export async function createVfsDirectory(
  vfs: VfsService,
  dirPath: string,
): Promise<void> {
  const normalized = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
  await vfs.mkdir(normalized);
}

/** 会话 scope：新建目录经 userVfsTurn。 */
export async function sessionCreateVfsDirectory(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  dirPath: string,
): Promise<void> {
  const normalized = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
  await executeSessionUserVfsOp(
    runtime,
    sessionId,
    buildUserVfsMkdirOp(normalized),
  );
}

/** Delete a file or directory tree. */
export async function deleteVfsEntry(
  vfs: VfsService,
  path: string,
  options?: {recursive?: boolean},
): Promise<void> {
  await vfs.delete(path, {recursive: options?.recursive ?? true});
}

/** 会话 scope：删除经 userVfsTurn。 */
export async function sessionDeleteVfsEntry(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  path: string,
  options?: {recursive?: boolean},
): Promise<void> {
  await executeSessionUserVfsOp(
    runtime,
    sessionId,
    buildUserVfsDeleteOp(path, options?.recursive ?? true),
  );
}

async function cleanupWorktreeAfterVfsDelete(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  path: string,
): Promise<void> {
  const wt = runtime.worktree(scope);
  await wt.deleteRulesUnderLogicalPrefix(path);
  if (scope.kind === 'session') {
    invalidateSessionWorktreeSnapshot(runtime, scope.projectId, scope.sessionId);
  }
}

/** 工作区文件管理器删除：VFS 变更 + worktree 规则清理（与 Desktop handleVfsDelete 对齐）。 */
export async function deleteScopedVfsEntry(
  runtime: MobileNovelMasterRuntime,
  scope: VfsScope,
  vfs: VfsService,
  path: string,
  options: {
    recursive?: boolean;
    useUserVfsTurn: boolean;
    sessionId?: string;
  },
): Promise<void> {
  const recursive = options.recursive ?? true;
  if (options.useUserVfsTurn && options.sessionId != null) {
    await sessionDeleteVfsEntry(runtime, options.sessionId, path, {recursive});
  } else {
    await deleteVfsEntry(vfs, path, {recursive});
  }
  await cleanupWorktreeAfterVfsDelete(runtime, scope, path);
}

/** Rename a file or directory (delegates to Core move logic). */
export async function renameVfsFile(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await moveVfsPath(vfs, oldPath, newPath);
}

/** 会话 scope：重命名文件经 userVfsTurn。 */
export async function sessionRenameVfsFile(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await executeSessionUserVfsOp(
    runtime,
    sessionId,
    buildUserVfsRenameOp(oldPath, newPath),
  );
}

/** Rename a directory tree (delegates to Core move logic). */
export async function renameVfsDirectory(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await moveVfsPath(vfs, oldPath, newPath);
}

/** 会话 scope：重命名目录经 userVfsTurn。 */
export async function sessionRenameVfsDirectory(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await executeSessionUserVfsOp(
    runtime,
    sessionId,
    buildUserVfsRenameOp(oldPath, newPath),
  );
}

/** 会话 scope：保存文件经 userVfsTurn（含锚点 diff）。 */
export async function sessionSaveVfsFile(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  vfs: VfsService,
  path: string,
  content: string,
  versionOptions?: UserVfsSaveVersionOptions,
  lastKnownContent?: string | null,
): Promise<void> {
  const baseline = await readUserVfsSaveBaseline(vfs, path);
  if (
    lastKnownContent != null &&
    baseline != null &&
    lastKnownContent !== baseline
  ) {
    console.info("[user-vfs-turn] external_drift_detected", { path });
  }
  const op = buildUserVfsSaveOp(
    baseline,
    content,
    path,
    content,
    versionOptions,
  );
  if (op == null) {
    return;
  }
  await executeSessionUserVfsOp(runtime, sessionId, op);
}

export {remapPathUnderDir};
export type {VfsListEntry};
