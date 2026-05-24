/**
 * SKSP error types.
 *
 * @module sksp-error
 */

/** Discriminant codes for {@link SkspError}. */
export type SkspErrorCode =
  | "NOT_REGISTERED"
  | "ENCRYPT_FAILED"
  | "DECRYPT_FAILED"
  | "DB_ERROR"
  | "INVALID_REF";

/**
 * Unified error for SKSP driver and composite operations.
 */
export class SkspError extends Error {
  readonly code: SkspErrorCode;
  readonly ref?: string;
  readonly cause?: unknown;

  constructor(
    code: SkspErrorCode,
    message: string,
    options?: { ref?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "SkspError";
    this.code = code;
    this.ref = options?.ref;
    this.cause = options?.cause;
  }
}

const MAX_REF_LENGTH = 512;

/** Validates opaque secret ref before DB / crypto operations. */
export function assertValidRef(ref: string): void {
  if (ref.length === 0 || ref.length > MAX_REF_LENGTH || ref.includes("\0")) {
    throw new SkspError("INVALID_REF", `Invalid secret ref: ${ref}`, { ref });
  }
}
