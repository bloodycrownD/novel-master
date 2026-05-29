/**
 * Agent definition validation errors.
 *
 * @module errors/agent-config-errors
 */

/** Discriminant codes for {@link AgentConfigError}. */
export type AgentConfigErrorCode =
  | "INVALID_SCHEMA"
  | "INVALID_COMPACT"
  | "INVALID_MODEL"
  | "PROTOCOL_MISMATCH";

/**
 * Unified error for agent definition parse and validation.
 */
export class AgentConfigError extends Error {
  readonly code: AgentConfigErrorCode;

  constructor(code: AgentConfigErrorCode, message: string) {
    super(message);
    this.name = "AgentConfigError";
    this.code = code;
  }
}
