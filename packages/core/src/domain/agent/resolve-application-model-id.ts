/**
 * Pure model id resolution for dialogue and compaction summary agents.
 *
 * Priority (dialogue): CLI flag → agent preferredModelId → workspace current model.
 * Priority (summary): CLI flag → summary preferredModelId → dialogue applicationModelId.
 *
 * Core does not read PersistentState; hosts pass resolved strings.
 *
 * @module domain/agent/resolve-application-model-id
 */

export interface ResolveApplicationModelIdInput {
  readonly cliModelId?: string;
  readonly preferredModelId?: string;
  readonly workspaceModelId?: string;
}

/**
 * Resolves applicationModelId for agent run when the host has not pre-resolved.
 * @returns undefined when no source is available (host should error).
 */
export function resolveApplicationModelId(
  input: ResolveApplicationModelIdInput,
): string | undefined {
  return (
    input.cliModelId ??
    input.preferredModelId ??
    input.workspaceModelId ??
    undefined
  );
}

export interface ResolveSummaryApplicationModelIdInput {
  readonly cliModelId?: string;
  readonly summaryPreferredModelId?: string;
  readonly dialogueApplicationModelId: string;
}

/**
 * Resolves applicationModelId for compaction summary agent LLM calls.
 */
export function resolveSummaryApplicationModelId(
  input: ResolveSummaryApplicationModelIdInput,
): string {
  return (
    input.cliModelId ??
    input.summaryPreferredModelId ??
    input.dialogueApplicationModelId
  );
}
