/**
 * Generic config decode errors (infra serialization; no domain names).
 *
 * @module errors/config-decode-errors
 */

/** Discriminant codes for {@link ConfigDecodeError}. */
export type ConfigDecodeErrorCode = "INVALID_SCHEMA" | "ENCODE_NOT_SUPPORTED";

/**
 * Thrown when {@link decode} or {@link encode} fails against a Zod schema.
 */
export class ConfigDecodeError extends Error {
  readonly code: ConfigDecodeErrorCode;

  constructor(code: ConfigDecodeErrorCode, message: string) {
    super(message);
    this.name = "ConfigDecodeError";
    this.code = code;
  }
}
