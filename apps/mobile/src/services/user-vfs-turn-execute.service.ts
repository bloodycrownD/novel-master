/**
 * 会话 scope 用户 VFS 操作经 UserVfsTurnService 执行（写盘即时）。
 *
 * @module services/user-vfs-turn-execute.service
 */
import {type UserVfsTurnOp} from '@novel-master/core/chat';

import {Result} from '@novel-master/core/errors';
import {ChatComposerDraft} from '@/storage/chat-composer-draft';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {ProjectComposerStatusService} from './project-composer-status.service';

/** {@link UserVfsTurnExecuteService.executeSessionOp} 选项。 */
export type ExecuteSessionUserVfsOpOptions = {
    /**
   * 批量移动等场景：跳过每次 op 后的状态条刷新，批次末统一
   * {@link UserVfsTurnExecuteService.refreshComposerStatus}。
   * 投影已收窄为仅 annotate；本开关仅合并批次末 notify。
   */
    readonly skipComposerStatusRefresh?: boolean;
};

export namespace UserVfsTurnExecuteService {
    /**
   * 经 userVfsTurn 执行；失败沿 `Result.err` 接力（错误通道迁移四期），调用方
   * UI 事件收口 formatError → toast。默认成功后轻量投影状态条。
   */
    export async function executeSessionOp(runtime: MobileNovelMasterRuntime, sessionId: string, op: UserVfsTurnOp, options: ExecuteSessionUserVfsOpOptions = {}): Promise<Result<void, unknown>> {
        const result = await runtime.userVfsTurn.executeOp(sessionId, op);
        if (!result.ok) {
            return Result.err(result.error);
        }
        if (options.skipComposerStatusRefresh) {
            return Result.ok(undefined);
        }
        await refreshComposerStatus(sessionId);
        return Result.ok(undefined);
    }

    /** 批次结束后补一次状态条投影（仅 annotate，无净 diff）。 */
    export async function refreshComposerStatus(sessionId: string): Promise<void> {
        const attachments = await ProjectComposerStatusService.forSession(sessionId);
        ChatComposerDraft.applyComposerStatusAttachmentsReplace({sessionId, attachments});
    }
}
