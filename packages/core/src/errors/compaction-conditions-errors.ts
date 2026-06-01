/**
 * Compaction conditions configuration errors.
 *
 * @module errors/compaction-conditions-errors
 */

export type CompactionConditionsErrorCode =
  | "INVALID_SCHEMA"
  | "NOT_FOUND";

export class CompactionConditionsError extends Error {
  readonly code: CompactionConditionsErrorCode;

  constructor(
    code: CompactionConditionsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CompactionConditionsError";
    this.code = code;
  }
}
