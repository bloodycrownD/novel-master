/**
 * Prompt engine errors (YAML, blocks, macros).
 *
 * @module errors/prompt-errors
 */

/** Discriminant codes for {@link PromptError}. */
export type PromptErrorCode =
  | "INVALID_YAML"
  | "INVALID_BLOCK"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_SYNTAX";

/**
 * Unified error for prompt parse, validation, and macro rendering.
 */
export class PromptError extends Error {
  readonly code: PromptErrorCode;
  readonly offset?: number;

  constructor(
    code: PromptErrorCode,
    message: string,
    options?: { offset?: number },
  ) {
    super(message);
    this.name = "PromptError";
    this.code = code;
    this.offset = options?.offset;
  }
}
