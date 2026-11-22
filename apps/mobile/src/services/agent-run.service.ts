/**
 * Mobile agent run adapter — thin wrapper over core `AgentTurnRunner.run`.
 */
import {AgentTurnRunner, type AgentRunResult, type AgentTurnScope} from '@novel-master/core/agent';
import type {AppError, Result} from '@novel-master/core/errors';
import type {ComposerDraftTokenRange, MessageAttachment, SendAnnotateDraft} from '@novel-master/core/chat';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

export type AgentRunScope = AgentTurnScope;

export type AgentRunOptions = {
    readonly stream?: boolean;
    readonly allowResumeWithoutInput?: boolean;
    readonly attachments?: readonly MessageAttachment[];
    readonly annotateDrafts?: readonly SendAnnotateDraft[];
    /** D9：确认胶囊区间（已换算到 trim 后正文坐标；空/缺失退回全量扫描）。 */
    readonly excludedScanRanges?: readonly ComposerDraftTokenRange[];
    readonly onUserMessageAppended?: () => void | Promise<void>;
};

export namespace AgentRunService {
    /** Appends a user message and runs the agent loop (streaming via event bus). */
    export async function run(runtime: MobileNovelMasterRuntime, scope: AgentRunScope, userContent: string, options?: AgentRunOptions): Promise<Result<AgentRunResult, AppError>> {
        return AgentTurnRunner.run(runtime, scope, userContent, {
            ...options,
            onRunFailed: ctx => {
                if (typeof __DEV__ !== 'undefined' && __DEV__) {
                    let err: {name: string; message: string; stack?: string; cause?: string};
                    if (ctx.error instanceof Error) {
                        err = {name: ctx.error.name, message: ctx.error.message, stack: ctx.error.stack, cause: String((ctx.error as Error & {cause?: unknown}).cause ?? '')};
                    } else {
                        err = {name: typeof ctx.error, message: String(ctx.error)};
                    }
                    console.error('[novel-master/agent-run] failed', {
                        stage: ctx.stage,
                        sessionId: ctx.scope.sessionId,
                        projectId: ctx.scope.projectId,
                        err,
                    });
                }
            },
        });
    }
}
