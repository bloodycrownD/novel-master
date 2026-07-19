/**
 * Mobile agent run — thin wrapper over core {@link runAgentTurn}.
 */
import { AgentRunResolveError, AgentTurnError, resolveApplicationModelIdForRun, resolveCurrentAgentDefinition as resolveCoreAgentDefinition, resolveCurrentAgentId as resolveCoreAgentId, runAgentTurn as coreRunAgentTurn, type AgentDefinition, type AgentRunResult, type AgentTurnScope } from "@novel-master/core/agent";
import type { AnnotateDraft, MessageAttachment } from "@novel-master/core/chat";
import type {MobileNovelMasterRuntime} from '../runtime/types';

export type AgentRunScope = AgentTurnScope;

export {AgentTurnError as AgentRunError};

function mapResolveError<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch(error => {
    if (error instanceof AgentRunResolveError) {
      throw new AgentTurnError(error.message);
    }
    throw error;
  });
}

/** Resolves current agent id from state or registry fallback. */
export async function resolveCurrentAgentId(
  runtime: MobileNovelMasterRuntime,
): Promise<string | undefined> {
  return resolveCoreAgentId(runtime);
}

/** Loads agent definition for the current agent pointer. */
export async function resolveCurrentAgentDefinition(
  runtime: MobileNovelMasterRuntime,
): Promise<{agentId: string; definition: AgentDefinition}> {
  return mapResolveError(() => resolveCoreAgentDefinition(runtime));
}

/** Resolves dialogue savedModelId (agent pin → workspace current model). */
export async function resolveMobileSavedModelId(
  runtime: MobileNovelMasterRuntime,
  definition: AgentDefinition,
): Promise<{savedModelId: string; workspaceModelId: string}> {
  return mapResolveError(() =>
    resolveApplicationModelIdForRun(runtime, definition),
  );
}

/** Appends a user message and runs the agent loop (streaming via event bus). */
export async function runAgentTurn(
  runtime: MobileNovelMasterRuntime,
  scope: AgentRunScope,
  userContent: string,
  options?: {
    readonly stream?: boolean;
    readonly allowResumeWithoutInput?: boolean;
    readonly attachments?: readonly MessageAttachment[];
    readonly annotateDrafts?: readonly AnnotateDraft[];
    readonly signal?: AbortSignal;
    readonly onUserMessageAppended?: () => void | Promise<void>;
  },
): Promise<AgentRunResult> {
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
