/**
 * Business validation for {@link AgentDefinition}.
 *
 * @module domain/agent/validate-agent-definition
 */

import { validateAgentToolPolicy } from "./validate-agent-tool-policy.js";
import type { AgentDefinition } from "../model/agent-definition.js";

export interface ValidateAgentDefinitionOptions {
  /** Ensures model pin refers to a saved model (CLI injects). */
  readonly assertSavedModel?: (
    applicationModelId: string,
  ) => void | Promise<void>;
  /** Registered tool names for tools policy validation (host injects after registerVfsTools). */
  readonly registeredToolNames?: readonly string[];
}

/**
 * Validates optional model pin when host supplies saved-model lookup.
 */
export async function validateAgentDefinition(
  def: AgentDefinition,
  options: ValidateAgentDefinitionOptions = {},
): Promise<void> {
  if (options.registeredToolNames != null) {
    validateAgentToolPolicy(
      def.tools,
      new Set(options.registeredToolNames),
    );
  }

  const pin = def.model;
  if (pin == null || options.assertSavedModel == null) {
    return;
  }
  await options.assertSavedModel(pin);
}
