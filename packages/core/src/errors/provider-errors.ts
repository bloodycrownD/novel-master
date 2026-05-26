/**
 * Provider / model domain errors.
 *
 * @module errors/provider-errors
 */

/** Discriminant codes for {@link ProviderError}. */
export type ProviderErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_ARGUMENT"
  | "BUILTIN_PROVIDER"
  | "HTTP_ERROR"
  | "API_KEY_NOT_SET"
  | "MODEL_NOT_SAVED"
  | "UNSUPPORTED_CONTENT";

/**
 * Unified error for provider service and LLM HTTP operations.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly providerId?: string;
  readonly modelId?: string;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options?: { providerId?: string; modelId?: string },
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.providerId = options?.providerId;
    this.modelId = options?.modelId;
  }
}
