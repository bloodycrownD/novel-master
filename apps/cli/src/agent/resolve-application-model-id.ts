/**
 * CLI wrapper: resolves savedModelId from flags, agent pin, and workspace state.
 *
 * @module agent/resolve-application-model-id
 */

import { type PersistentState } from "@novel-master/core";

import { resolveApplicationModelId, type AgentDefinition } from "@novel-master/core/agent";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

export interface ResolveCliSavedModelIdInput {
  readonly flags: ReadonlyMap<string, string | true>;
  readonly definition: AgentDefinition;
  readonly state: PersistentState;
}

/**
 * Resolves saved model UUID for agent run: `--modelId` → agent `model` pin → workspace current model.
 * @throws when no source is available for dialogue model
 */
export async function resolveCliSavedModelId(
  input: ResolveCliSavedModelIdInput,
): Promise<{
  savedModelId: string;
  workspaceModelId: string;
  cliModelId?: string;
}> {
  const cliModelId = flagString(input.flags, "modelId");
  const workspaceModelId = (await input.state.getCurrentModelId()) ?? "";
  const resolved = resolveApplicationModelId({
    cliModelId,
    agentModelId: input.definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });
  if (resolved == null || resolved === "") {
    throw new Error(
      "No model selected. Use --modelId <uuid>, set model on the agent, or run: nm model use --modelId <uuid>",
    );
  }
  return {
    savedModelId: resolved,
    workspaceModelId,
    ...(cliModelId != null ? { cliModelId } : {}),
  };
}
