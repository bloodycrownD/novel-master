/**
 * Typed errors for SQL template parsing and evaluation.
 */

/** Error codes for {@link SqlTemplateError}. */
export type SqlTemplateErrorCode =
  | "UNKNOWN_TAG"
  | "UNCLOSED_TAG"
  | "MALFORMED_TAG"
  | "EXPRESSION_ERROR"
  | "INVALID_COLLECTION";

/**
 * Thrown when template syntax or expression evaluation fails.
 */
export class SqlTemplateError extends Error {
  readonly code: SqlTemplateErrorCode;
  readonly offset?: number;
  readonly tagName?: string;

  constructor(
    code: SqlTemplateErrorCode,
    message: string,
    options?: { offset?: number; tagName?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "SqlTemplateError";
    this.code = code;
    this.offset = options?.offset;
    this.tagName = options?.tagName;
  }
}
