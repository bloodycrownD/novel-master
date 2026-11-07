/**
 * Provider / model domain errors.
 *
 * message 通道放宽为 `string | CoreMessageDescriptor`（spec §5 G1.2）：descriptor
 * 时 `Error.message` 取 key 原文，`messageKey`/`messageParams` 供边界
 * `userMessageOf` + translator 翻译。
 *
 * @module errors/provider-errors
 */

import type { MessageParams } from "@/common/i18n.js";
import type { CoreMessageDescriptor, CoreMessageKey } from "@/i18n/keys.js";
import { resolveLocalizedMessage } from "@/i18n/localized-message.js";

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
  readonly messageKey?: CoreMessageKey;
  readonly messageParams?: MessageParams;

  constructor(
    code: ProviderErrorCode,
    message: string | CoreMessageDescriptor,
    options?: { providerId?: string; modelId?: string }
  ) {
    const localized = resolveLocalizedMessage(message);
    super(localized.text);
    this.name = "ProviderError";
    this.code = code;
    this.providerId = options?.providerId;
    this.modelId = options?.modelId;
    this.messageKey = localized.messageKey;
    this.messageParams = localized.messageParams;
  }
}

/** Platform-neutral copy for missing provider API key. */
export function providerApiKeyNotSetMessage(providerId: string): string {
  return `API key not set for provider ${providerId}. Configure it in provider settings.`;
}

/** Platform-neutral copy for unsaved application model id. */
export function providerModelNotSavedMessage(
  applicationModelId: string
): string {
  return `Model not saved: ${applicationModelId}. Fetch and save the model first.`;
}
