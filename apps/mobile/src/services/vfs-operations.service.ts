/**
 * VFS mutations for the file manager (create / delete / rename).
 */
import type {VfsListEntry, VfsService} from '@novel-master/core';
import {
  buildUserVfsCreateFileOp,
  buildUserVfsDeleteOp,
  buildUserVfsMkdirOp,
  buildUserVfsRenameOp,
  buildUserVfsSaveOp,
  moveVfsPath,
  remapPathUnderDir,
  type UserVfsSaveVersionOptions,
} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {executeSessionUserVfsOp} from './user-vfs-turn-execute.service';

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
  baseline: string | null,
  path: string,
  content: string,
  versionOptions?: UserVfsSaveVersionOptions,
): Promise<void> {
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
