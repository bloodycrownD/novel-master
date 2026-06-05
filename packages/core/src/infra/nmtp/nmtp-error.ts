/**
 * NMTP error types.
 *
 * @module infra/nmtp/nmtp-error
 */

/** Discriminant codes for {@link TokenizerError}. */
export type TokenizerErrorCode = "NOT_REGISTERED" | "MULTIPLE_DRIVERS";

/**
 * Unified error for NMTP driver registry resolution.
 */
export class TokenizerError extends Error {
  readonly code: TokenizerErrorCode;

  constructor(code: TokenizerErrorCode, message: string) {
    super(message);
    this.name = "TokenizerError";
    this.code = code;
  }
}
