/**
 * KKV domain errors.
 *
 * @module errors/kkv-errors
 */

/** Discriminant codes for {@link KkvError}. */
export type KkvErrorCode = "NOT_FOUND" | "CONFLICT";

/**
 * Unified error for KKV service and repository operations.
 */
export class KkvError extends Error {
  readonly code: KkvErrorCode;
  readonly module?: string;
  readonly key?: string;

  constructor(
    code: KkvErrorCode,
    message: string,
    options?: { module?: string; key?: string },
  ) {
    super(message);
    this.name = "KkvError";
    this.code = code;
    this.module = options?.module;
    this.key = options?.key;
  }
}

/** Key does not exist in module. */
export function kkvNotFound(module: string, key: string): KkvError {
  return new KkvError("NOT_FOUND", `KKV key not found: ${module}/${key}`, {
    module,
    key,
  });
}
