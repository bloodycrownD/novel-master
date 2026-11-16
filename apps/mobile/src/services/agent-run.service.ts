/**
 * Mobile agent run — thin wrapper over core {@link runAgentTurn}.
 */
import {
  runAgentTurn as coreRunAgentTurn,
  type AgentRunResult,
  type AgentTurnScope,
} from '@novel-master/core/agent';
import type {AppError, Result} from '@novel-master/core/errors';
import type {
  ComposerDraftTokenRange,
  MessageAttachment,
  SendAnnotateDraft,
} from '@novel-master/core/chat';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

export type AgentRunScope = AgentTurnScope;

/** Appends a user message and runs the agent loop (streaming via event bus). */
export async function runAgentTurn(
  runtime: MobileNovelMasterRuntime,
  scope: AgentRunScope,
  userContent: string,
  options?: {
    readonly stream?: boolean;
    readonly allowResumeWithoutInput?: boolean;
    readonly attachments?: readonly MessageAttachment[];
    readonly annotateDrafts?: readonly SendAnnotateDraft[];
    /** D9：确认胶囊区间（已换算到 trim 后正文坐标；空/缺失退回全量扫描）。 */
    readonly excludedScanRanges?: readonly ComposerDraftTokenRange[];
    readonly signal?: AbortSignal;
    readonly onUserMessageAppended?: () => void | Promise<void>;
  },
): Promise<Result<AgentRunResult, AppError>> {
  return coreRunAgentTurn(runtime, scope, userContent, {
    ...options,
    onRunFailed: ctx => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        const err =
          ctx.error instanceof Error
            ? {
                name: ctx.error.name,
                message: ctx.error.message,
                stack: ctx.error.stack,
                cause: String(
                  (ctx.error as Error & {cause?: unknown}).cause ?? '',
                ),
              }
            : {name: typeof ctx.error, message: String(ctx.error)};
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
