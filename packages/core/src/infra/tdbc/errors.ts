/**
 * TDBC error model: typed codes for protocol and driver failures.
 *
 * @module infra/tdbc/errors
 */

/** Discriminant codes for {@link TdbcError}. */
export type TdbcErrorCode =
  | "UNKNOWN_DRIVER"
  | "INVALID_URL"
  | "CONNECTION_CLOSED"
  | "SQLITE_ERROR"
  | "BATCH_FAILED"
  | "NESTED_TRANSACTION";

/**
 * Unified error for TDBC protocol, registry, and driver operations.
 */
export class TdbcError extends Error {
  readonly code: TdbcErrorCode;
  readonly driver?: string;
  readonly sqliteCode?: number;
  declare readonly cause?: unknown;

  constructor(
    code: TdbcErrorCode,
    message: string,
    options?: { driver?: string; sqliteCode?: number; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "TdbcError";
    this.code = code;
    this.driver = options?.driver;
    this.sqliteCode = options?.sqliteCode;
  }
}
