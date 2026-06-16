/**
 * CLI wrapper: resolves applicationModelId from flags, agent pin, and workspace state.
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

export interface ResolveCliApplicationModelIdInput {
  readonly flags: ReadonlyMap<string, string | true>;
  readonly definition: AgentDefinition;
  readonly state: PersistentState;
}

/**
 * Resolves model id for agent run: `--modelId` → agent `model` pin → workspace current model.
 * @throws when no source is available for dialogue model
 */
export async function resolveCliApplicationModelId(
  input: ResolveCliApplicationModelIdInput,
): Promise<{
  applicationModelId: string;
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
      "No model selected. Use --modelId <provider>/<vendor>, set model on the agent, or run: nm model use --modelId <id>",
    );
  }
  return {
    applicationModelId: resolved,
    workspaceModelId,
    ...(cliModelId != null ? { cliModelId } : {}),
  };
}
