/**
 * Desktop agent run — thin wrapper over core {@link runAgentTurn}.
 *
 * @module services/agent-run
 */
import { AgentRunResolveError, AgentTurnError, resolveApplicationModelIdForRun, resolveCurrentAgentDefinition as resolveCoreAgentDefinition, resolveCurrentAgentId as resolveCoreAgentId, runAgentTurn as coreRunAgentTurn, type AgentDefinition, type AgentRunResult, type AgentTurnScope } from "@novel-master/core/agent";

import {
  desktopLog,
  desktopLogError,
  desktopLogWarn,
  isDesktopLlmDebug,
} from "../log/desktop-log.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

export type AgentRunScope = AgentTurnScope;

export { AgentTurnError as AgentRunError };

function mapResolveError<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((error) => {
    if (error instanceof AgentRunResolveError) {
      throw new AgentTurnError(error.message);
    }
    throw error;
  });
}

export async function resolveCurrentAgentId(
  runtime: DesktopNovelMasterRuntime,
): Promise<string | undefined> {
  return resolveCoreAgentId(runtime);
}

export async function resolveCurrentAgentDefinition(
  runtime: DesktopNovelMasterRuntime,
): Promise<{ agentId: string; definition: AgentDefinition }> {
  return mapResolveError(() => resolveCoreAgentDefinition(runtime));
}

export async function resolveDesktopSavedModelId(
  runtime: DesktopNovelMasterRuntime,
  definition: AgentDefinition,
): Promise<{ savedModelId: string; workspaceModelId: string }> {
  return mapResolveError(() =>
    resolveApplicationModelIdForRun(runtime, definition),
  );
}

export async function runAgentTurn(
  runtime: DesktopNovelMasterRuntime,
  scope: AgentRunScope,
  userContent: string,
  options?: {
    readonly stream?: boolean;
    readonly allowResumeWithoutInput?: boolean;
    readonly signal?: AbortSignal;
    readonly onUserMessageAppended?: () => void | Promise<void>;
  },
): Promise<AgentRunResult> {
  return coreRunAgentTurn(runtime, scope, userContent, {
    ...options,
    onAfterResolveModel: async (ctx) => {
      if (!isDesktopLlmDebug()) {
        return;
      }
      const saved = await runtime.providerModels.getSavedById(ctx.savedModelId);
      const providerId = saved?.providerId ?? "unknown";
      const vendorModelId = saved?.vendorModelId ?? ctx.savedModelId;
      try {
        const provider = await runtime.providers.get(providerId);
        desktopLog("agent-run start", {
          sessionId: ctx.scope.sessionId,
          projectId: ctx.scope.projectId,
          providerId,
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          vendorModelId,
          savedModelId: ctx.savedModelId,
          stream: ctx.stream,
        });
      } catch (lookupError) {
        desktopLogWarn("agent-run provider lookup failed", {
          providerId,
          savedModelId: ctx.savedModelId,
          err:
            lookupError instanceof Error
              ? lookupError.message
              : String(lookupError),
        });
      }
    },
    onRunFailed: (ctx) => {
      const err =
        ctx.error instanceof Error
          ? {
              name: ctx.error.name,
              message: ctx.error.message,
              stack: ctx.error.stack,
            }
          : { name: typeof ctx.error, message: String(ctx.error) };
      desktopLogError("agent-run failed", {
        stage: ctx.stage,
        sessionId: ctx.scope.sessionId,
        projectId: ctx.scope.projectId,
        savedModelId: ctx.savedModelId,
        stream: ctx.stream,
        err,
      });
    },
  });
}
