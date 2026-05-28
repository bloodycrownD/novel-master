/**
 * Agent domain errors.
 *
 * @module domain/agent/agent-errors
 */

/** Discriminant codes for {@link AgentError}. */
export type AgentErrorCode =
  | "NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "DOOM_LOOP"
  | "MAX_STEPS"
  | "UNSUPPORTED_PROVIDER"
  | "FAILED";

/**
 * Unified error for agent session and runner operations.
 */
export class AgentError extends Error {
  readonly code: AgentErrorCode;

  constructor(code: AgentErrorCode, message: string) {
    super(message);
    this.name = "AgentError";
    this.code = code;
  }
}

/** Repeated identical tool invocations detected. */
export function agentDoomLoop(toolName: string): AgentError {
  return new AgentError(
    "DOOM_LOOP",
    `Doom loop: tool "${toolName}" invoked 3 times with identical input`,
  );
}

/** Provider does not support tools for this request. */
export function agentUnsupportedProvider(protocol: string): AgentError {
  return new AgentError(
    "UNSUPPORTED_PROVIDER",
    `Provider protocol "${protocol}" does not support tools`,
  );
}
