/**
 * VFS mutations for the file manager (create / delete / rename).
 */
import {
  type VfsListEntry,
  type VfsScope,
  type VfsService,
} from '@novel-master/core/vfs';
import {
  buildUserVfsCreateFileOp,
  buildUserVfsDeleteOp,
  buildUserVfsMkdirOp,
  buildUserVfsRenameOp,
  buildUserVfsSaveOp,
  moveVfsPath,
  readUserVfsSaveBaseline,
  remapPathUnderDir,
} from '@novel-master/core/vfs';
import {Result, AppError} from '@novel-master/core/errors';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {
  executeSessionUserVfsOp,
  type ExecuteSessionUserVfsOpOptions,
} from './user-vfs-turn-execute.service';

/** Create a new file (empty by default). */
export async function createVfsFile(
  vfs: VfsService,
  path: string,
  content = '',
): Promise<void> {
  await vfs.write(path, content);
}

/** 会话 scope：新建文件经 userVfsTurn。 */
export async function sessionCreateVfsFile(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  path: string,
  content = '',
): Promise<Result<void, unknown>> {
  return executeSessionUserVfsOp(
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
): Promise<Result<void, unknown>> {
  const normalized = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
  return executeSessionUserVfsOp(
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
): Promise<Result<void, unknown>> {
  return executeSessionUserVfsOp(
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
  const wt = runtime.workplace(scope);
  await wt.deleteRulesUnderLogicalPrefix(path);
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
): Promise<Result<void, unknown>> {
  const recursive = options.recursive ?? true;
  if (options.useUserVfsTurn && options.sessionId != null) {
    const deleted = await sessionDeleteVfsEntry(
      runtime,
      options.sessionId,
      path,
      {
        recursive,
      },
    );
    if (!deleted.ok) return deleted;
  } else {
    // 错误通道迁移四期：vfs.delete 失败沿 Result 接力，不再静默吞掉
    // （deleteVfsEntry 的 void 包装不检查返回值，这里必须自判）。
    const deleted = await vfs.delete(path, {recursive});
    if (!deleted.ok) return Result.err(deleted.error);
  }
  await cleanupWorktreeAfterVfsDelete(runtime, scope, path);
  return Result.ok(undefined);
}

/** Rename a file or directory (delegates to Core move logic). */
export async function renameVfsFile(
  vfs: VfsService,
  oldPath: string,
  newPath: string,
): Promise<Result<void, AppError>> {
  const moved = await moveVfsPath(vfs, oldPath, newPath);
  // 失败沿 Result 接力（错误通道迁移四期）：调用方 VfsFileManager 收口 formatError → toast。
  if (!moved.ok) return moved;
  return Result.ok(undefined);
}

/** 会话 scope：重命名文件经 userVfsTurn。 */
export async function sessionRenameVfsFile(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  oldPath: string,
  newPath: string,
  options?: ExecuteSessionUserVfsOpOptions,
): Promise<Result<void, unknown>> {
  return executeSessionUserVfsOp(
    runtime,
    sessionId,
    buildUserVfsRenameOp(oldPath, newPath),
    options,
  );
}

/** Rename a directory tree (delegates to Core move logic; same impl as file rename). */
export const renameVfsDirectory = renameVfsFile;

/** 会话 scope：重命名目录经 userVfsTurn（与文件重命名同一实现）。 */
export const sessionRenameVfsDirectory = sessionRenameVfsFile;

/** 会话 scope：保存文件经 userVfsTurn（含锚点 diff）。 */
export async function sessionSaveVfsFile(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  vfs: VfsService,
  path: string,
  content: string,
  lastKnownContent?: string | null,
): Promise<Result<void, unknown>> {
  const baselineResult = await readUserVfsSaveBaseline(vfs, path);
  if (!baselineResult.ok) return Result.err(baselineResult.error);
  const baseline = baselineResult.value;
  if (
    lastKnownContent != null &&
    baseline != null &&
    lastKnownContent !== baseline
  ) {
    console.info('[user-vfs-turn] external_drift_detected', {path});
  }
  const op = buildUserVfsSaveOp(
    baseline,
    content,
    path,
    content,
  );
  if (op == null) {
    return Result.ok(undefined);
  }
  return executeSessionUserVfsOp(runtime, sessionId, op);
}

export {remapPathUnderDir};
export type {VfsListEntry};
