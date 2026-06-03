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

/** Type guard that works across duplicate module instances (e.g. src vs dist in tests). */
export function isKkvError(
  error: unknown,
  code?: KkvErrorCode,
): error is KkvError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== "KkvError" || typeof candidate.code !== "string") {
    return false;
  }
  return code === undefined || candidate.code === code;
}

/** Key does not exist in module. */
export function kkvNotFound(module: string, key: string): KkvError {
  return new KkvError("NOT_FOUND", `KKV key not found: ${module}/${key}`, {
    module,
    key,
  });
}
