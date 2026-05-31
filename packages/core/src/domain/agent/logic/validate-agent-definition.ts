/**
 * Business validation for {@link AgentDefinition}.
 *
 * @module domain/agent/validate-agent-definition
 */

import type { AgentDefinition } from "./model/agent-definition.js";

export interface ValidateAgentDefinitionOptions {
  /** Ensures model pin refers to a saved model (CLI injects). */
  readonly assertSavedModel?: (
    applicationModelId: string,
  ) => void | Promise<void>;
}

/**
 * Validates optional model pin when host supplies saved-model lookup.
 */
export async function validateAgentDefinition(
  def: AgentDefinition,
  options: ValidateAgentDefinitionOptions = {},
): Promise<void> {
  const pin = def.model;
  if (pin == null || options.assertSavedModel == null) {
    return;
  }
  await options.assertSavedModel(pin);
}
