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
import {UserVfsTurnExecuteService, type ExecuteSessionUserVfsOpOptions} from './user-vfs-turn-execute.service';

const createVfsDirectory = VfsEntryOps.createDirectory;
const createVfsFile = VfsEntryOps.createFile;
const renameVfsDirectory = VfsMove.move;
const renameVfsFile = VfsMove.move;
export {createVfsDirectory, createVfsFile, renameVfsDirectory, renameVfsFile};

type MobileRuntime = MobileNovelMasterRuntime;

/** 会话 scope 保存的参数对象（>4 参签名收口）：依赖与语义参数同对象，字段名即文档。 */
type SessionSaveFileParams = {
    readonly runtime: MobileRuntime;
    readonly vfs: VfsService;
    readonly sessionId: string;
    readonly path: string;
    readonly content: string;
    /** 外部漂移检测基线：与 userVfsTurn 基线不一致时打 external_drift_detected 日志。 */
    readonly lastKnownContent?: string | null;
};

/** 工作区删除的参数对象：原 DeleteScopedOptions 已展平进 params。 */
type DeleteScopedEntryParams = {
    readonly runtime: MobileRuntime;
    readonly scope: VfsScope;
    readonly vfs: VfsService;
    readonly path: string;
    readonly recursive?: boolean;
    readonly useUserVfsTurn: boolean;
    /** 传入且 useUserVfsTurn 时走会话 userVfsTurn 删除通道。 */
    readonly sessionId?: string;
};

/** 会话 scope 重命名的参数对象。 */
type SessionRenameFileParams = {
    readonly runtime: MobileRuntime;
    readonly sessionId: string;
    readonly oldPath: string;
    readonly newPath: string;
    readonly options?: ExecuteSessionUserVfsOpOptions;
};

export namespace VfsOperationsService {
    /** 会话 scope：新建文件经 userVfsTurn。 */
    // nm-style: keep-public — vfs-operations.service.test.ts 直接 import 断言；4 个 file-manager 集成测试以模块接缝 mock，测试锁名
    export async function sessionCreateFile(runtime: MobileRuntime, sessionId: string, path: string, content = ''): Promise<Result<void, unknown>> {
        return UserVfsTurnExecuteService.executeSessionOp(runtime, sessionId, UserVfsTurnOps.buildCreateFile(path, content));
    }

    /** 会话 scope：新建目录经 userVfsTurn。 */
    // nm-style: keep-public — vfs-operations.service.test.ts 直接 import 断言（去尾斜杠口径）；file-manager 集成测试 mock，测试锁名
    export async function sessionCreateDirectory(runtime: MobileRuntime, sessionId: string, dirPath: string): Promise<Result<void, unknown>> {
        const normalized = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
        return UserVfsTurnExecuteService.executeSessionOp(runtime, sessionId, UserVfsTurnOps.buildMkdir(normalized));
    }

    /** 工作区文件管理器删除：VFS 变更 + worktree 规则清理（与 Desktop handleVfsDelete 对齐）。 */
    export async function deleteScopedEntry(p: DeleteScopedEntryParams): Promise<Result<void, unknown>> {
        const {runtime, scope, vfs, path} = p;
        const recursive = p.recursive ?? true;
        if (p.useUserVfsTurn && p.sessionId != null) {
            const deleted = await UserVfsTurnExecuteService.executeSessionOp(runtime, p.sessionId, UserVfsTurnOps.buildDelete(path, recursive));
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
    export async function sessionRenameFile(p: SessionRenameFileParams): Promise<Result<void, unknown>> {
        const {runtime, sessionId, oldPath, newPath, options} = p;
        return UserVfsTurnExecuteService.executeSessionOp(runtime, sessionId, UserVfsTurnOps.buildRename(oldPath, newPath), options);
    }

    /** 会话 scope：保存文件经 userVfsTurn（含锚点 diff）。 */
    // nm-style: keep-public — vfs-operations.service.test.ts / file-editor-screen.test.tsx 直接 import 与断言，测试锁名
    export async function sessionSaveFile(p: SessionSaveFileParams): Promise<Result<void, unknown>> {
        const {runtime, sessionId, vfs, path, content, lastKnownContent} = p;
        const baselineResult = await UserVfsSaveBaseline.read(vfs, path);
        if (!baselineResult.ok) return Result.err(baselineResult.error);
        const baseline = baselineResult.value;
        if (lastKnownContent != null && baseline != null && lastKnownContent !== baseline) {
            console.info('[user-vfs-turn] external_drift_detected', {path});
        }
        const op = UserVfsTurnOps.buildSave({ baseline, path, fileContentAtSave: content });
        if (op == null) {
            return Result.ok(undefined);
        }
        return UserVfsTurnExecuteService.executeSessionOp(runtime, sessionId, op);
    }
}
