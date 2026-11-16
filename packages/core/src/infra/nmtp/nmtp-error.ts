/**
 * NMTP error types.
 *
 * @module infra/nmtp/nmtp-error
 */

/** Discriminant codes for {@link TokenizerError}. */
// nm-style: keep-public — @novel-master/core/nmtp 子入口再导出的公共类型契约（无生产直引）
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
