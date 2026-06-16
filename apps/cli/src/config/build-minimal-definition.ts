/**
 * Builds a minimal {@link AgentDefinition} for --prompt-path test shortcut.
 *
 * @module config/build-minimal-definition
 */

import { type AgentDefinition } from "@novel-master/core/agent";


import { type AgentPromptLayout } from "@novel-master/core/prompt";

export interface BuildMinimalDefinitionInput {
  readonly name?: string;
  readonly layout: AgentPromptLayout;
}

/**
 * Wraps prompt layout only; model id is resolved separately at run time.
 */
export function buildMinimalDefinition(
  input: BuildMinimalDefinitionInput,
): AgentDefinition {
  return {
    name: input.name ?? "cli-minimal",
    prompts: input.layout,
  };
}
