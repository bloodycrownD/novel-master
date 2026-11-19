/**
 * VFS mutations for the file manager (create / delete / rename).
 *
 * 基础动作（createVfsFile / createVfsDirectory）的实现已下沉 core（`VfsEntryOps`，
 * 双端同一份）；重命名就是 `VfsMove.move` 的导出别名。本模块保留会话 scope 的
 * userVfsTurn 包装（边界转换）与工作区删除的规则清理。
 */
import {type VfsScope, type VfsService, UserVfsSaveBaseline, UserVfsTurnOps, VfsEntryOps, VfsMove} from '@novel-master/core/vfs';
import {Result} from '@novel-master/core/errors';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {executeSessionUserVfsOp, type ExecuteSessionUserVfsOpOptions} from './user-vfs-turn-execute.service';

const createVfsDirectory = VfsEntryOps.createDirectory;
const createVfsFile = VfsEntryOps.createFile;
const renameVfsDirectory = VfsMove.move;
const renameVfsFile = VfsMove.move;
export {createVfsDirectory, createVfsFile, renameVfsDirectory, renameVfsFile};

type MobileRuntime = MobileNovelMasterRuntime;

type DeleteScopedOptions = {
  recursive?: boolean;
  useUserVfsTurn: boolean;
  sessionId?: string;
};

/** 会话 scope：新建文件经 userVfsTurn。 */
// nm-style: keep-public — vfs-operations.service.test.ts 直接 import 断言；4 个 file-manager 集成测试以模块接缝 mock，测试锁名
export async function sessionCreateVfsFile(runtime: MobileRuntime, sessionId: string, path: string, content = ''): Promise<Result<void, unknown>> {
  return executeSessionUserVfsOp(runtime, sessionId, UserVfsTurnOps.buildCreateFile(path, content));
}

/** 会话 scope：新建目录经 userVfsTurn。 */
// nm-style: keep-public — vfs-operations.service.test.ts 直接 import 断言（去尾斜杠口径）；file-manager 集成测试 mock，测试锁名
export async function sessionCreateVfsDirectory(runtime: MobileRuntime, sessionId: string, dirPath: string): Promise<Result<void, unknown>> {
  const normalized = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
  return executeSessionUserVfsOp(runtime, sessionId, UserVfsTurnOps.buildMkdir(normalized));
}

/** 工作区文件管理器删除：VFS 变更 + worktree 规则清理（与 Desktop handleVfsDelete 对齐）。 */
export async function deleteScopedVfsEntry(runtime: MobileRuntime, scope: VfsScope, vfs: VfsService, path: string, options: DeleteScopedOptions): Promise<Result<void, unknown>> {
  const recursive = options.recursive ?? true;
  if (options.useUserVfsTurn && options.sessionId != null) {
    const deleted = await executeSessionUserVfsOp(runtime, options.sessionId, UserVfsTurnOps.buildDelete(path, recursive));
    if (!deleted.ok) return deleted;
  } else {
    // 错误通道迁移四期：vfs.delete 失败沿 Result 接力，不再静默吞掉
    // （core 的 deleteVfsEntry 是 void 包装不检查返回值，这里必须自判）。
    const deleted = await vfs.delete(path, {recursive});
    if (!deleted.ok) return Result.err(deleted.error);
  }
  await runtime.workplace(scope).deleteRulesUnderLogicalPrefix(path);
  return Result.ok(undefined);
}

/** 会话 scope：重命名文件经 userVfsTurn。 */
export async function sessionRenameVfsFile(runtime: MobileRuntime, sessionId: string, oldPath: string, newPath: string, options?: ExecuteSessionUserVfsOpOptions): Promise<Result<void, unknown>> {
  return executeSessionUserVfsOp(runtime, sessionId, UserVfsTurnOps.buildRename(oldPath, newPath), options);
}

/** 会话 scope：重命名目录经 userVfsTurn（与文件重命名同一实现）。 */
export const sessionRenameVfsDirectory = sessionRenameVfsFile;

/** 会话 scope：保存文件经 userVfsTurn（含锚点 diff）。 */
// nm-style: keep-public — vfs-operations.service.test.ts / file-editor-screen.test.tsx 直接 import 与断言，测试锁名
export async function sessionSaveVfsFile(runtime: MobileRuntime, sessionId: string, vfs: VfsService, path: string, content: string, lastKnownContent?: string | null): Promise<Result<void, unknown>> {
  const baselineResult = await UserVfsSaveBaseline.read(vfs, path);
  if (!baselineResult.ok) return Result.err(baselineResult.error);
  const baseline = baselineResult.value;
  if (lastKnownContent != null && baseline != null && lastKnownContent !== baseline) {
    console.info('[user-vfs-turn] external_drift_detected', {path});
  }
  const op = UserVfsTurnOps.buildSave(baseline, content, path, content);
  if (op == null) {
    return Result.ok(undefined);
  }
  return executeSessionUserVfsOp(runtime, sessionId, op);
}
