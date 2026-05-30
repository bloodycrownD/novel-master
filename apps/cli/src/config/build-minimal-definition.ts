/**
 * Builds a minimal {@link AgentDefinition} for --prompt-path test shortcut.
 *
 * @module config/build-minimal-definition
 */

import type { AgentDefinition, PromptBlock } from "@novel-master/core";

export interface BuildMinimalDefinitionInput {
  readonly name?: string;
  readonly prompts: readonly PromptBlock[];
}

/**
 * Wraps prompt blocks only; model id is resolved separately at run time.
 */
export function buildMinimalDefinition(
  input: BuildMinimalDefinitionInput,
): AgentDefinition {
  return {
    schemaVersion: 1,
    name: input.name ?? "cli-minimal",
    prompts: input.prompts,
  };
}
