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
  | "UNSUPPORTED_CONTENT"
  | "UNSUPPORTED"
  | "MALFORMED_SSE"
  | "INVALID_TOOL_ARGUMENTS"
  | "MIGRATION_ORPHAN_POINTER"
  | "SAVED_MODEL_IN_USE"
  | "INVALID_SAVED_MODEL_ID"
  | "INVALID_MODEL_NAME";

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

/** Platform-neutral copy for missing provider API key. */
export function providerApiKeyNotSetMessage(providerId: string): string {
  return `API key not set for provider ${providerId}. Configure it in provider settings.`;
}

/** Platform-neutral copy for unsaved application model id. */
export function providerModelNotSavedMessage(applicationModelId: string): string {
  return `Model not saved: ${applicationModelId}. Fetch and save the model first.`;
}
