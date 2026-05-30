/**
 * Global compaction policy domain errors.
 *
 * @module errors/compaction-policy-errors
 */

/** Discriminant codes for {@link CompactionPolicyError}. */
export type CompactionPolicyErrorCode =
  | "INVALID_SCHEMA"
  | "NOT_FOUND"
  | "AGENT_NOT_FOUND";

/**
 * Unified error for compaction policy parse, storage, and agent resolution.
 */
export class CompactionPolicyError extends Error {
  readonly code: CompactionPolicyErrorCode;
  readonly agentId?: string;

  constructor(
    code: CompactionPolicyErrorCode,
    message: string,
    options?: { agentId?: string },
  ) {
    super(message);
    this.name = "CompactionPolicyError";
    this.code = code;
    this.agentId = options?.agentId;
  }
}
