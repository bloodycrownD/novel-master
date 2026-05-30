/**
 * Regex configuration and application errors.
 *
 * @module errors/regex-errors
 */

/** Discriminant codes for {@link RegexError}. */
export type RegexErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_ARGUMENT"
  | "INVALID_PATTERN";

/**
 * Unified error for regex service and rule validation.
 */
export class RegexError extends Error {
  readonly code: RegexErrorCode;
  readonly groupId?: string;
  readonly ruleId?: string;

  constructor(
    code: RegexErrorCode,
    message: string,
    options?: { groupId?: string; ruleId?: string },
  ) {
    super(message);
    this.name = "RegexError";
    this.code = code;
    this.groupId = options?.groupId;
    this.ruleId = options?.ruleId;
  }
}
