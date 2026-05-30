/**
 * CLI wrapper: resolves applicationModelId from flags, agent pin, and workspace state.
 *
 * @module agent/resolve-application-model-id
 */

import {
  resolveApplicationModelId,
  type AgentDefinition,
  type PersistentState,
} from "@novel-master/core";

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
 * Resolves model id for agent run: `--modelId` → preferredModelId → current workspace model.
 * @throws when no source is available
 */
export async function resolveCliApplicationModelId(
  input: ResolveCliApplicationModelIdInput,
): Promise<{ applicationModelId: string; cliModelId?: string }> {
  const cliModelId = flagString(input.flags, "modelId");
  const workspaceModelId = await input.state.getCurrentModelId();
  const resolved = resolveApplicationModelId({
    cliModelId,
    preferredModelId: input.definition.preferredModelId,
    workspaceModelId,
  });
  if (resolved == null || resolved === "") {
    throw new Error(
      "No model selected. Use --modelId <provider>/<vendor>, set preferredModelId on the agent, or run: nm model use --modelId <id>",
    );
  }
  return {
    applicationModelId: resolved,
    ...(cliModelId != null ? { cliModelId } : {}),
  };
}
